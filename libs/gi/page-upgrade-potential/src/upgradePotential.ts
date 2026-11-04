import type {
  ArtifactRarity,
  ArtifactSlotKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  allSubstatKeys,
  artMaxLevel,
} from '@genshin-optimizer/gi/consts'
import type { IArtifact } from '@genshin-optimizer/gi/schema'
import {
  getArtifactEfficiency,
  getRollsRemaining,
  getSubstatValue,
} from '@genshin-optimizer/gi/util'

export interface UpgradeProfile {
  id: string
  label: string
  keys: SubstatKey[]
}

/** キャラの型ごとの有効サブステ */
export const upgradeProfiles: UpgradeProfile[] = [
  { id: 'atkCrit', label: '攻撃会心', keys: ['atk_', 'critRate_', 'critDMG_'] },
  {
    id: 'atkCritEr',
    label: '攻撃会心チャージ',
    keys: ['atk_', 'critRate_', 'critDMG_', 'enerRech_'],
  },
  { id: 'hpCrit', label: 'HP会心', keys: ['hp_', 'critRate_', 'critDMG_'] },
  {
    id: 'hpCritEr',
    label: 'HP会心チャージ',
    keys: ['hp_', 'critRate_', 'critDMG_', 'enerRech_'],
  },
  { id: 'defCrit', label: '防御会心', keys: ['def_', 'critRate_', 'critDMG_'] },
  {
    id: 'emCrit',
    label: '熟知会心',
    keys: ['eleMas', 'critRate_', 'critDMG_'],
  },
  { id: 'em', label: '熟知', keys: ['eleMas', 'enerRech_'] },
  { id: 'hpSupport', label: 'HPサポート', keys: ['hp_', 'enerRech_'] },
  { id: 'atkSupport', label: '攻撃サポート', keys: ['atk_', 'enerRech_'] },
  { id: 'defSupport', label: '防御サポート', keys: ['def_', 'enerRech_'] },
  { id: 'crit', label: '会心のみ', keys: ['critRate_', 'critDMG_'] },
]

export const defaultProfileId = 'atkCrit'

const scalingStats = ['hp_', 'atk_', 'def_', 'eleMas'] as const
type ScalingStat = (typeof scalingStats)[number]
const isScalingStat = (key: MainStatKey | undefined): key is ScalingStat =>
  !!key && (scalingStats as readonly string[]).includes(key)

/**
 * 装備中の聖遺物のメインステータスから、キャラの型を推測する。
 * - 時計 → 杯 → 冠 の順に HP%/攻撃%/防御%/熟知 を探して、伸ばしたいステータスとみなす
 * - 冠が会心系なら会心型、時計が元素チャージ効率なら「チャージ」も有効とみなす
 */
export function guessProfileId(
  mainStats: Partial<Record<ArtifactSlotKey, MainStatKey>>
): string {
  const { sands, goblet, circlet } = mainStats
  const base = [sands, goblet, circlet].find(isScalingStat)
  const crit = circlet === 'critRate_' || circlet === 'critDMG_'
  const erSands = sands === 'enerRech_'
  if (crit || (!base && !erSands)) {
    switch (base) {
      case 'hp_':
        return erSands ? 'hpCritEr' : 'hpCrit'
      case 'def_':
        return 'defCrit'
      case 'eleMas':
        return 'emCrit'
      default:
        return erSands ? 'atkCritEr' : 'atkCrit'
    }
  }
  switch (base) {
    case 'hp_':
      return 'hpSupport'
    case 'def_':
      return 'defSupport'
    case 'eleMas':
      return 'em'
    default:
      return 'atkSupport'
  }
}

export type UpgradeArtifact = IArtifact & { id: string }

export interface UpgradeConfig {
  /** この Roll Value 以上伸びるときだけ提案する（星5の最大1回分 = 1.0） */
  minGain: number
  /** セットが違う聖遺物も入れ替え・育成候補にする（セット効果が崩れる可能性あり） */
  allowOtherSets: boolean
  /** ほかのキャラが装備中の聖遺物も候補にする */
  includeEquippedByOthers: boolean
  /** 未装備の部位に聖遺物を付けたときの伸びも伸びしろに数える */
  countEmptySlots: boolean
}

export const defaultUpgradeConfig: UpgradeConfig = {
  minGain: 1,
  allowOtherSets: false,
  includeEquippedByOthers: false,
  countEmptySlots: false,
}

export interface ArtifactScore {
  id: string
  /** 現在の Roll Value */
  current: number
  /** +20 まで強化したときの Roll Value の見込み（期待値） */
  expected: number
  /** +20 まで強化したときの Roll Value の最大値 */
  max: number
  /** 残りの強化回数 */
  rollsRemaining: number
}

export interface SlotAnalysis {
  slotKey: ArtifactSlotKey
  equipped?: ArtifactScore
  /** 強化済みの聖遺物と入れ替えると伸びる */
  swap?: ArtifactScore & { gain: number }
  /** 未強化の聖遺物を強化して入れ替えると伸びる見込み */
  train?: ArtifactScore & { gain: number }
  /** 装備中の聖遺物を強化したときの伸び（期待値） */
  levelUpGain: number
  /**
   * この部位で見込める伸び（どの方法でも一番大きいもの）。
   * 未装備の部位は `countEmptySlots` のときだけ数える。
   */
  gain: number
}

export interface CharacterAnalysis {
  characterKey: string
  slots: SlotAnalysis[]
  /** 装備中の聖遺物の Roll Value の合計 */
  totalCurrent: number
  /** 見込める伸びの合計 */
  totalGain: number
  emptySlots: number
}

export interface UpgradeTarget {
  characterKey: string
  /** 聖遺物の location と同じ値（旅人は 'Traveler'） */
  location: string
  equippedArtifacts: Partial<Record<ArtifactSlotKey, string>>
  keys: readonly SubstatKey[]
}

/** 1回の強化で伸びるサブステの平均値（星5の最大値 = 1） */
function averageRoll(rarity: ArtifactRarity) {
  return (
    getSubstatValue('critRate_', rarity, 'mid') / getSubstatValue('critRate_')
  )
}

/**
 * +20 まで強化したときの Roll Value の期待値。
 * 強化はサブステ4つに均等に入るとみなす。
 * サブステが3つしかない聖遺物は、空きに入るサブステがランダムに決まるとみなす。
 */
export function expectedEfficiency(
  art: IArtifact,
  filter: ReadonlySet<SubstatKey>,
  current = getArtifactEfficiency(
    art,
    filter as Set<SubstatKey>
  ).currentEfficiency
) {
  let rolls = getRollsRemaining(art.level, art.rarity)
  if (rolls <= 0) return current
  const avg = averageRoll(art.rarity)
  const known = art.substats.map(({ key }) => key).filter(Boolean)
  let usefulLines = known.filter((key) => filter.has(key as SubstatKey)).length
  let expected = current

  const unactivated = art.unactivatedSubstats?.find(({ key }) => key)?.key
  if (unactivated) {
    // 最初の強化で未発動のサブステが発動する
    rolls--
    known.push(unactivated)
    if (filter.has(unactivated)) {
      usefulLines++
      expected += avg
    }
  }

  let emptyLines = Math.max(0, 4 - known.length)
  if (emptyLines) {
    const pool = allSubstatKeys.filter(
      (key) => key !== art.mainStatKey && !known.includes(key)
    )
    let usefulPool = pool.filter((key) => filter.has(key)).length
    let poolSize = pool.length
    while (emptyLines > 0 && rolls > 0 && poolSize > 0) {
      const p = usefulPool / poolSize
      expected += p * avg
      usefulLines += p
      usefulPool -= p
      poolSize--
      emptyLines--
      rolls--
    }
  }

  return expected + rolls * (usefulLines / 4) * avg
}

export function scoreArtifact(
  art: UpgradeArtifact,
  filter: ReadonlySet<SubstatKey>
): ArtifactScore {
  const { currentEfficiency, maxEfficiency } = getArtifactEfficiency(
    art,
    filter as Set<SubstatKey>
  )
  return {
    id: art.id,
    current: currentEfficiency,
    expected: expectedEfficiency(art, filter, currentEfficiency),
    max: maxEfficiency,
    rollsRemaining: Math.max(0, getRollsRemaining(art.level, art.rarity)),
  }
}

function better(
  a: ArtifactScore | undefined,
  b: ArtifactScore,
  key: 'current' | 'expected'
) {
  return !a || b[key] > a[key] || (b[key] === a[key] && b.id < a.id)
}

/**
 * キャラごとに、聖遺物の入れ替え・強化でどれくらい伸びるかを調べる。
 * 伸びは有効サブステの Roll Value（星5の最大1回分 = 1.0）で表す。
 */
export function analyzeUpgradePotential(
  arts: readonly UpgradeArtifact[],
  targets: readonly UpgradeTarget[],
  config: UpgradeConfig
): CharacterAnalysis[] {
  const artsById = new Map(arts.map((art) => [art.id, art]))
  const artsBySlot = new Map<ArtifactSlotKey, UpgradeArtifact[]>(
    allArtifactSlotKeys.map((slotKey) => [slotKey, []])
  )
  for (const art of arts) artsBySlot.get(art.slotKey)?.push(art)

  // 同じ型のキャラが多いので、型ごとに点数をキャッシュする
  const scoreCache = new Map<string, Map<string, ArtifactScore>>()
  const getScorer = (keys: readonly SubstatKey[]) => {
    const effectiveKeys = keys.length ? keys : allSubstatKeys
    const cacheKey = [...effectiveKeys].sort().join(',')
    let cache = scoreCache.get(cacheKey)
    if (!cache) {
      cache = new Map()
      scoreCache.set(cacheKey, cache)
    }
    const filter = new Set<SubstatKey>(effectiveKeys)
    const scores = cache
    return (art: UpgradeArtifact) => {
      let score = scores.get(art.id)
      if (!score) {
        score = scoreArtifact(art, filter)
        scores.set(art.id, score)
      }
      return score
    }
  }

  return targets.map(({ characterKey, location, equippedArtifacts, keys }) => {
    const score = getScorer(keys)
    const slots = allArtifactSlotKeys.map((slotKey): SlotAnalysis => {
      const equippedArt = equippedArtifacts[slotKey]
        ? artsById.get(equippedArtifacts[slotKey]!)
        : undefined
      const equipped = equippedArt && score(equippedArt)

      let bestSwap: ArtifactScore | undefined
      let bestTrain: ArtifactScore | undefined
      for (const art of artsBySlot.get(slotKey) ?? []) {
        if (art.id === equippedArt?.id) continue
        if (
          !config.includeEquippedByOthers &&
          art.location &&
          art.location !== location
        )
          continue
        if (equippedArt) {
          if (art.mainStatKey !== equippedArt.mainStatKey) continue
          if (art.rarity < equippedArt.rarity) continue
          if (!config.allowOtherSets && art.setKey !== equippedArt.setKey)
            continue
        } else if (art.rarity < 5) continue
        const s = score(art)
        if (art.level >= artMaxLevel[art.rarity]) {
          if (better(bestSwap, s, 'current')) bestSwap = s
        } else if (better(bestTrain, s, 'expected')) bestTrain = s
      }

      const current = equipped?.current ?? 0
      const levelUpGain = equipped ? equipped.expected - equipped.current : 0
      const swapGain = bestSwap ? bestSwap.current - current : 0
      // 未強化の聖遺物は、ほかの方法で届く値を上回るときだけ提案する
      const baseline = Math.max(equipped?.expected ?? 0, bestSwap?.current ?? 0)
      const trainGain = bestTrain ? bestTrain.expected - baseline : 0

      return {
        slotKey,
        equipped,
        swap:
          bestSwap && swapGain >= config.minGain
            ? { ...bestSwap, gain: swapGain }
            : undefined,
        train:
          bestTrain && trainGain >= config.minGain
            ? { ...bestTrain, gain: trainGain }
            : undefined,
        levelUpGain,
        gain:
          !equipped && !config.countEmptySlots
            ? 0
            : Math.max(
                0,
                levelUpGain,
                swapGain >= config.minGain ? swapGain : 0,
                trainGain >= config.minGain ? baseline + trainGain - current : 0
              ),
      }
    })
    return {
      characterKey,
      slots,
      totalCurrent: slots.reduce(
        (sum, s) => sum + (s.equipped?.current ?? 0),
        0
      ),
      totalGain: slots.reduce((sum, s) => sum + s.gain, 0),
      emptySlots: slots.filter((s) => !s.equipped).length,
    }
  })
}
