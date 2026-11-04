import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import type { IArtifact } from '@genshin-optimizer/gi/schema'
import { getArtifactEfficiency } from '@genshin-optimizer/gi/util'

/** 不要候補と判定した理由 */
export type JunkReason = 'lowPotential' | 'dominated' | 'lowRarity'

export interface JunkProfile {
  id: string
  label: string
  keys: SubstatKey[]
}

/** キャラの型ごとの有効サブステ */
export const junkProfiles: JunkProfile[] = [
  { id: 'atkCrit', label: '攻撃会心', keys: ['atk_', 'critRate_', 'critDMG_'] },
  { id: 'hpCrit', label: 'HP会心', keys: ['hp_', 'critRate_', 'critDMG_'] },
  { id: 'defCrit', label: '防御会心', keys: ['def_', 'critRate_', 'critDMG_'] },
  {
    id: 'emCrit',
    label: '熟知会心',
    keys: ['eleMas', 'critRate_', 'critDMG_'],
  },
  { id: 'em', label: '熟知', keys: ['eleMas', 'enerRech_'] },
  { id: 'hpSupport', label: 'HPサポート', keys: ['hp_', 'enerRech_'] },
  { id: 'atkSupport', label: '攻撃サポート', keys: ['atk_', 'enerRech_'] },
  { id: 'crit', label: '会心のみ', keys: ['critRate_', 'critDMG_'] },
]

export interface JunkConfig {
  /**
   * single: 選んだ有効サブステ1組で判定する
   * allProfiles: 選んだすべての型で不要なものだけを候補にする（どのキャラでも不要）
   */
  mode: 'single' | 'allProfiles'
  /** allProfiles で使う型の ID */
  profileIds: string[]
  /** 有効とみなすサブステータス */
  usefulSubstats: SubstatKey[]
  /** 最大まで強化しても有効ロール数が閾値未満なら不要候補 */
  checkLowPotential: boolean
  /** 有効ロール数の閾値（星5の最大1回分 = 1.0） */
  minMaxEfficiency: number
  /** 上位互換が一定数以上あれば不要候補 */
  checkDominated: boolean
  /** 何個以上の上位互換があれば不要候補とするか */
  dominatedCount: number
  /** 星4以下は不要候補 */
  checkLowRarity: boolean
  /** ロック中の聖遺物は対象外 */
  excludeLocked: boolean
  /** 装備中の聖遺物は対象外 */
  excludeEquipped: boolean
  /** 保存済みビルドで使われている聖遺物は対象外 */
  excludeInBuilds: boolean
}

export const defaultJunkConfig: JunkConfig = {
  mode: 'allProfiles',
  // 「会心のみ」は他の会心型に含まれるので初期値では外す
  profileIds: junkProfiles
    .filter(({ id }) => id !== 'crit')
    .map(({ id }) => id),
  usefulSubstats: ['atk_', 'critRate_', 'critDMG_'],
  checkLowPotential: true,
  minMaxEfficiency: 4,
  checkDominated: true,
  dominatedCount: 1,
  checkLowRarity: true,
  excludeLocked: true,
  excludeEquipped: true,
  excludeInBuilds: true,
}

export type JunkArtifact = IArtifact & { id: string }

export interface JunkResult {
  id: string
  reasons: JunkReason[]
  /** 現在の有効ロール数 */
  currentEfficiency: number
  /** 最大まで強化した場合の有効ロール数（理論上の最大） */
  maxEfficiency: number
  /** この聖遺物の上位互換の ID */
  dominatedBy: string[]
  /** 最も伸びる型の番号（`findJunkArtifacts` に渡した `profiles` の添字） */
  bestProfileIndex: number
}

function substatValue(art: IArtifact, key: SubstatKey) {
  return art.substats.reduce(
    (sum, s) => (s.key === key ? sum + (s.value ?? 0) : sum),
    0
  )
}

/**
 * `b` が `a` の上位互換かどうか。
 * セット・部位・メインステータスが同じで、レア度とレベルが `a` 以上、
 * かつ有効サブステの値がすべて `a` 以上のとき上位互換とみなす。
 * 完全に同等な場合は `keepRank` が小さい方（残すべき方）を上位とする。
 */
function dominates(
  b: JunkArtifact,
  a: JunkArtifact,
  keys: readonly SubstatKey[],
  keepRank: (art: JunkArtifact) => number
) {
  if (a.id === b.id) return false
  if (
    a.setKey !== b.setKey ||
    a.slotKey !== b.slotKey ||
    a.mainStatKey !== b.mainStatKey ||
    b.rarity < a.rarity ||
    b.level < a.level
  )
    return false
  let strictlyBetter = b.rarity > a.rarity || b.level > a.level
  for (const key of keys) {
    const va = substatValue(a, key)
    const vb = substatValue(b, key)
    if (vb < va) return false
    if (vb > va) strictlyBetter = true
  }
  if (strictlyBetter) return true
  // 完全に同等: 残すべき方を上位として扱い、両方が不要と判定されるのを防ぐ
  const ra = keepRank(a)
  const rb = keepRank(b)
  return rb !== ra ? rb < ra : b.id < a.id
}

/**
 * 不要候補の聖遺物を探す。
 * 判定の対象外（ロック中・装備中など）の聖遺物も、上位互換の比較相手としては使う。
 *
 * `profiles` を複数渡すと「どのキャラ型でも不要」な聖遺物だけを返す。
 * つまり、すべての型で「伸びしろ不足」か「上位互換あり」に当てはまるものが対象になる
 * （星4以下は型に関係なく不要候補）。
 */
export function findJunkArtifacts(
  arts: readonly JunkArtifact[],
  usedInBuildIds: ReadonlySet<string>,
  config: JunkConfig,
  profiles: readonly SubstatKey[][] = [config.usefulSubstats]
): JunkResult[] {
  const profileKeys = (profiles.length ? profiles : [[]]).map((keys) =>
    keys.length ? keys : [...allSubstatKeys]
  )
  const profileFilters = profileKeys.map((keys) => new Set<SubstatKey>(keys))

  const isProtected = (art: JunkArtifact) =>
    (config.excludeLocked && art.lock) ||
    (config.excludeEquipped && !!art.location) ||
    (config.excludeInBuilds && usedInBuildIds.has(art.id))
  // 0: 残す理由がある, 1: ない
  const keepRank = (art: JunkArtifact) =>
    art.lock || art.location || usedInBuildIds.has(art.id) ? 0 : 1

  const groups = new Map<string, JunkArtifact[]>()
  if (config.checkDominated)
    for (const art of arts) {
      const groupKey = `${art.setKey}|${art.slotKey}|${art.mainStatKey}`
      const group = groups.get(groupKey)
      if (group) group.push(art)
      else groups.set(groupKey, [art])
    }

  const results: JunkResult[] = []
  for (const art of arts) {
    if (isProtected(art)) continue
    const group = groups.get(`${art.setKey}|${art.slotKey}|${art.mainStatKey}`)

    // 型ごとに判定する
    const perProfile = profileKeys.map((keys, i) => {
      const reasons: JunkReason[] = []
      const { currentEfficiency, maxEfficiency } = getArtifactEfficiency(
        art,
        profileFilters[i]
      )
      if (config.checkLowPotential && maxEfficiency < config.minMaxEfficiency)
        reasons.push('lowPotential')
      let dominatedBy: string[] = []
      if (config.checkDominated && group) {
        dominatedBy = group
          .filter((other) => dominates(other, art, keys, keepRank))
          .map((other) => other.id)
        if (dominatedBy.length >= Math.max(1, config.dominatedCount))
          reasons.push('dominated')
      }
      return { reasons, currentEfficiency, maxEfficiency, dominatedBy }
    })

    // 一番伸びる型（＝この聖遺物を使うなら一番向いている型）
    let bestProfileIndex = 0
    perProfile.forEach((p, i) => {
      const best = perProfile[bestProfileIndex]
      if (
        p.maxEfficiency > best.maxEfficiency ||
        (p.maxEfficiency === best.maxEfficiency &&
          p.currentEfficiency > best.currentEfficiency)
      )
        bestProfileIndex = i
    })
    const best = perProfile[bestProfileIndex]

    const lowRarity = config.checkLowRarity && art.rarity <= 4
    const junkForAll = perProfile.every((p) => p.reasons.length)
    if (!lowRarity && !junkForAll) continue

    const reasons: JunkReason[] = []
    if (lowRarity) reasons.push('lowRarity')
    if (junkForAll)
      for (const reason of ['lowPotential', 'dominated'] as const)
        if (perProfile.some((p) => p.reasons.includes(reason)))
          reasons.push(reason)

    results.push({
      id: art.id,
      reasons,
      currentEfficiency: best.currentEfficiency,
      maxEfficiency: best.maxEfficiency,
      bestProfileIndex,
      // 上位互換の数は、上位互換ありと判定された型のうち一番少ない数を表示する
      dominatedBy:
        perProfile
          .filter((p) => p.reasons.includes('dominated'))
          .reduce<string[] | undefined>(
            (min, p) =>
              !min || p.dominatedBy.length < min.length ? p.dominatedBy : min,
            undefined
          ) ?? best.dominatedBy,
    })
  }
  return results.sort(
    (a, b) =>
      a.maxEfficiency - b.maxEfficiency ||
      a.currentEfficiency - b.currentEfficiency ||
      b.reasons.length - a.reasons.length
  )
}
