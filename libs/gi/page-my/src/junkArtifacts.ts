import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import type { IArtifact } from '@genshin-optimizer/gi/schema'
import { getArtifactEfficiency } from '@genshin-optimizer/gi/util'

/** 不要候補と判定した理由 */
export type JunkReason = 'lowPotential' | 'dominated' | 'lowRarity'

export interface JunkConfig {
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
 */
export function findJunkArtifacts(
  arts: readonly JunkArtifact[],
  usedInBuildIds: ReadonlySet<string>,
  config: JunkConfig
): JunkResult[] {
  const usefulKeys = config.usefulSubstats.length
    ? config.usefulSubstats
    : [...allSubstatKeys]
  const filter = new Set<SubstatKey>(usefulKeys)

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
    const reasons: JunkReason[] = []

    const { currentEfficiency, maxEfficiency } = getArtifactEfficiency(
      art,
      filter
    )
    if (config.checkLowRarity && art.rarity <= 4) reasons.push('lowRarity')
    if (config.checkLowPotential && maxEfficiency < config.minMaxEfficiency)
      reasons.push('lowPotential')

    let dominatedBy: string[] = []
    if (config.checkDominated) {
      const group =
        groups.get(`${art.setKey}|${art.slotKey}|${art.mainStatKey}`) ?? []
      dominatedBy = group
        .filter((other) => dominates(other, art, usefulKeys, keepRank))
        .map((other) => other.id)
      if (dominatedBy.length >= Math.max(1, config.dominatedCount))
        reasons.push('dominated')
    }

    if (reasons.length)
      results.push({
        id: art.id,
        reasons,
        currentEfficiency,
        maxEfficiency,
        dominatedBy,
      })
  }
  return results.sort(
    (a, b) =>
      a.maxEfficiency - b.maxEfficiency ||
      a.currentEfficiency - b.currentEfficiency ||
      b.reasons.length - a.reasons.length
  )
}
