import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  allSubstatKeys,
} from '@genshin-optimizer/gi/consts'
import type { IArtifact } from '@genshin-optimizer/gi/schema'
import { getArtifactEfficiency } from '@genshin-optimizer/gi/util'
import type { CharacterInsight } from './characters'
import type { ArtifactProfile } from './profiles'
import { isMainStatUseful } from './profiles'
import { getUpgradeOutlook, rollTiers, substatWeights } from './upgradeChance'

/** 秘境（同じ秘境で手に入る聖遺物セットの組） */
export interface ArtifactDomain {
  id: string
  sets: ArtifactSetKey[]
}

/**
 * 聖遺物秘境ごとのセットの組。
 * ペアがわかっているものだけを載せる。ここにない星5セットは、
 * {@link getArtifactDomains} で1セットだけの秘境として扱う。
 */
export const knownArtifactDomains: ArtifactDomain[] = [
  { id: 'vv', sets: ['ViridescentVenerer', 'MaidenBeloved'] },
  { id: 'tf', sets: ['ThunderingFury', 'Thundersoother'] },
  { id: 'cw', sets: ['CrimsonWitchOfFlames', 'Lavawalker'] },
  { id: 'no', sets: ['NoblesseOblige', 'BloodstainedChivalry'] },
  { id: 'petra', sets: ['ArchaicPetra', 'RetracingBolide'] },
  { id: 'bs', sets: ['BlizzardStrayer', 'HeartOfDepth'] },
  { id: 'tom', sets: ['TenacityOfTheMillelith', 'PaleFlame'] },
  { id: 'emblem', sets: ['EmblemOfSeveredFate', 'ShimenawasReminiscence'] },
  { id: 'husk', sets: ['HuskOfOpulentDreams', 'OceanHuedClam'] },
  { id: 'echoes', sets: ['VermillionHereafter', 'EchoesOfAnOffering'] },
  { id: 'deepwood', sets: ['DeepwoodMemories', 'GildedDreams'] },
  { id: 'desert', sets: ['DesertPavilionChronicle', 'FlowerOfParadiseLost'] },
  { id: 'nymph', sets: ['NymphsDream', 'VourukashasGlow'] },
  { id: 'hunter', sets: ['MarechausseeHunter', 'GoldenTroupe'] },
  {
    id: 'song',
    sets: ['SongOfDaysPast', 'NighttimeWhispersInTheEchoingWoods'],
  },
  { id: 'whimsy', sets: ['FragmentOfHarmonicWhimsy', 'UnfinishedReverie'] },
  { id: 'obsidian', sets: ['ScrollOfTheHeroOfCinderCity', 'ObsidianCodex'] },
  { id: 'oath', sets: ['LongNightsOath', 'FinaleOfTheDeepGalleries'] },
  { id: 'moon', sets: ['NightOfTheSkysUnveiling', 'SilkenMoonsSerenade'] },
]

/** 秘境では手に入らない星5セット（ボスなどから手に入る） */
export const nonDomainSets: ArtifactSetKey[] = [
  'GladiatorsFinale',
  'WanderersTroupe',
]

/**
 * 星5セットの一覧から秘境の一覧を作る。
 * ペアがわからないセットは1セットだけの秘境（`id` はセット名）にする。
 */
export function getArtifactDomains(
  fiveStarSets: readonly ArtifactSetKey[]
): ArtifactDomain[] {
  const known = new Set(knownArtifactDomains.flatMap(({ sets }) => sets))
  return [
    ...knownArtifactDomains.filter(({ sets }) =>
      sets.every((s) => fiveStarSets.includes(s))
    ),
    ...fiveStarSets
      .filter((s) => !known.has(s) && !nonDomainSets.includes(s))
      .map((s) => ({ id: s, sets: [s] })),
  ]
}

/** 星5聖遺物のメインステータスの出やすさ */
export const mainStatChances: Record<
  ArtifactSlotKey,
  Partial<Record<MainStatKey, number>>
> = {
  flower: { hp: 1 },
  plume: { atk: 1 },
  sands: {
    hp_: 0.2668,
    atk_: 0.2666,
    def_: 0.2666,
    enerRech_: 0.1,
    eleMas: 0.1,
  },
  goblet: {
    hp_: 0.1925,
    atk_: 0.1925,
    def_: 0.19,
    eleMas: 0.025,
    physical_dmg_: 0.05,
    anemo_dmg_: 0.05,
    geo_dmg_: 0.05,
    electro_dmg_: 0.05,
    hydro_dmg_: 0.05,
    pyro_dmg_: 0.05,
    cryo_dmg_: 0.05,
    dendro_dmg_: 0.05,
  },
  circlet: {
    hp_: 0.22,
    atk_: 0.22,
    def_: 0.22,
    critRate_: 0.1,
    critDMG_: 0.1,
    heal_: 0.1,
    eleMas: 0.04,
  },
}

/** 秘境1回（樹脂20）で出る星5聖遺物の平均個数 */
export const fiveStarDropsPerRun = 1.07

/** 星5を最初からサブステ4つで手に入れる確率 */
const fourLineChance = 0.2

/** 乱数（同じ seed なら同じ結果になる） */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** +20 まで強化した星5聖遺物のサブステ（キーと Roll Value） */
export type SubstatSample = Array<[SubstatKey, number]>

/** メインステータスを決めて、+20 の星5聖遺物のサブステを `n` 個作る */
export function sampleSubstats(
  mainStatKey: MainStatKey,
  n: number,
  rand: () => number
): SubstatSample[] {
  const samples: SubstatSample[] = []
  const tier = () => rollTiers[Math.floor(rand() * rollTiers.length)]
  for (let i = 0; i < n; i++) {
    let pool = allSubstatKeys.filter((k) => k !== mainStatKey)
    const lines: SubstatSample = []
    // 4つのサブステを重みつきで選ぶ（3つで始まっても最初の強化で4つ目が付く）
    for (let l = 0; l < 4; l++) {
      const total = pool.reduce((s, k) => s + substatWeights[k], 0)
      let r = rand() * total
      let key = pool[pool.length - 1]
      for (const k of pool) {
        r -= substatWeights[k]
        if (r < 0) {
          key = k
          break
        }
      }
      pool = pool.filter((k) => k !== key)
      lines.push([key, tier()])
    }
    // 4つで始まれば5回、3つで始まれば4回伸びる
    const upgrades = rand() < fourLineChance ? 5 : 4
    for (let u = 0; u < upgrades; u++)
      lines[Math.floor(rand() * 4)][1] += tier()
    samples.push(lines)
  }
  return samples
}

/** 周回の判定に使うキャラ */
export interface FarmingCharacter {
  id: string
  profile: ArtifactProfile
  /** 部位ごとの今の聖遺物（セットと強さ）。空きは `undefined` */
  slots: Partial<Record<ArtifactSlotKey, FarmingPiece>>
}

export interface FarmingPiece {
  setKey?: ArtifactSetKey
  /** 強さ（+20 時の Roll Value の見込み） */
  score: number
  /**
   * セット効果に関係しない（どのセットとも入れ替えられる）。
   * 空いている部位を手持ちの予備で埋めた場合など
   */
  free?: boolean
}

/**
 * 今の聖遺物の強さ。メインステータスが型に合わなければ 0。
 * 星5で強化途中なら +20 にしたときの期待値、それ以外は今の値。
 */
export function pieceScore(art: IArtifact, profile: ArtifactProfile) {
  if (!isMainStatUseful(art.slotKey, art.mainStatKey, profile)) return 0
  const outlook = getUpgradeOutlook(art, profile.keys)
  if (outlook) return outlook.expected
  return getArtifactEfficiency(art, new Set(profile.keys)).currentEfficiency
}

/**
 * セット効果を崩さずに入れ替えられる部位か。
 * その部位のセットを装備している数が奇数（1・3・5個）なら、1つ減ってもセット効果は変わらない。
 */
function isFreeSlot(char: FarmingCharacter, slotKey: ArtifactSlotKey) {
  const piece = char.slots[slotKey]
  if (!piece || piece.free) return true
  const count = Object.values(char.slots).filter(
    (p) => !p?.free && p?.setKey === piece.setKey
  ).length
  return count % 2 === 1
}

export interface SetFarmingResult {
  setKey: ArtifactSetKey
  /** このセットが1つ出たときの Roll Value の伸びの期待値 */
  gainPerDrop: number
  /** キャラごとの内訳（同じ値） */
  byCharacter: Record<string, number>
}

export interface DomainFarmingResult {
  domain: ArtifactDomain
  /** 秘境1回あたりの Roll Value の伸びの期待値 */
  gainPerRun: number
  sets: SetFarmingResult[]
  /** 伸びるキャラ（大きい順） */
  beneficiaries: Array<{ id: string; gain: number }>
}

export interface FarmingOptions {
  /** メインステータスごとに作るサンプル数 */
  samples?: number
  seed?: number
}

/**
 * セットごとに、1つ出たときにキャラの聖遺物がどれだけ良くなるかの期待値を求める。
 *
 * 新しい聖遺物は、メインステータスが型に合い、セット効果を崩さずに入れ替えられるキャラのうち
 * 一番伸びるキャラに装備させるものとする。伸びは有効サブステの Roll Value（星5の最大値1回分 = 1）で測る。
 */
export function evaluateSets(
  chars: readonly FarmingCharacter[],
  setKeys: readonly ArtifactSetKey[],
  { samples = 300, seed = 1 }: FarmingOptions = {}
): Record<string, SetFarmingResult> {
  const rand = mulberry32(seed)
  const results: Record<string, SetFarmingResult> = {}
  for (const setKey of setKeys)
    results[setKey] = { setKey, gainPerDrop: 0, byCharacter: {} }
  const keySets = chars.map((c) => new Set(c.profile.keys))
  const slotChance = 1 / allArtifactSlotKeys.length

  for (const slotKey of allArtifactSlotKeys) {
    const free = chars.map((c) => isFreeSlot(c, slotKey))
    const current = chars.map((c) => c.slots[slotKey]?.score ?? 0)
    const currentSet = chars.map((c) => c.slots[slotKey]?.setKey)
    for (const [mainKey, chance] of Object.entries(
      mainStatChances[slotKey]
    ) as Array<[MainStatKey, number]>) {
      const mainOk = chars.map((c) =>
        isMainStatUseful(slotKey, mainKey, c.profile)
      )
      if (!mainOk.some(Boolean)) continue
      const weight = (slotChance * chance) / samples
      for (const sample of sampleSubstats(mainKey, samples, rand)) {
        let freeBest = 0
        let freeBestIdx = -1
        const setBest = new Map<ArtifactSetKey, [number, number]>()
        chars.forEach((_, c) => {
          if (!mainOk[c]) return
          let score = 0
          for (const [key, rv] of sample) if (keySets[c].has(key)) score += rv
          const gain = score - current[c]
          if (gain <= 0) return
          if (free[c]) {
            if (gain > freeBest) {
              freeBest = gain
              freeBestIdx = c
            }
          } else {
            // 同じセットの聖遺物と入れ替えるならセット効果は崩れない
            const s = currentSet[c]!
            const prev = setBest.get(s)
            if (!prev || gain > prev[0]) setBest.set(s, [gain, c])
          }
        })
        for (const setKey of setKeys) {
          const own = setBest.get(setKey)
          const [gain, idx] =
            own && own[0] > freeBest ? own : [freeBest, freeBestIdx]
          if (idx < 0) continue
          const res = results[setKey]
          res.gainPerDrop += gain * weight
          const id = chars[idx].id
          res.byCharacter[id] = (res.byCharacter[id] ?? 0) + gain * weight
        }
      }
    }
  }
  return results
}

/**
 * 秘境ごとに、1回周回したときの Roll Value の伸びの期待値を求めて、大きい順に並べる。
 * 秘境では2つのセットが半分ずつ出るものとする（ペア不明の秘境も、出るのは半分とみなす）。
 */
export function recommendDomains(
  chars: readonly FarmingCharacter[],
  domains: readonly ArtifactDomain[],
  options?: FarmingOptions
): DomainFarmingResult[] {
  const setResults = evaluateSets(
    chars,
    domains.flatMap(({ sets }) => sets),
    options
  )
  return domains
    .map((domain) => {
      const sets = domain.sets.map((s) => setResults[s])
      const byChar: Record<string, number> = {}
      for (const set of sets)
        for (const [id, gain] of Object.entries(set.byCharacter))
          byChar[id] = (byChar[id] ?? 0) + gain * 0.5 * fiveStarDropsPerRun
      return {
        domain,
        gainPerRun:
          sets.reduce((s, set) => s + set.gainPerDrop, 0) *
          0.5 *
          fiveStarDropsPerRun,
        sets,
        beneficiaries: Object.entries(byChar)
          .map(([id, gain]) => ({ id, gain }))
          .sort((a, b) => b.gain - a.gain),
      }
    })
    .sort((a, b) => b.gainPerRun - a.gainPerRun)
}

/**
 * キャラの装備から、周回の判定に使うキャラを作る。
 * 空いている部位は、手持ちの予備（装備していない聖遺物）で一番良いもので埋めたものとして扱う。
 * 空いた部位はどのセットでも埋められるので、秘境の比較には関係させない。
 */
export function toFarmingCharacters(
  insights: readonly CharacterInsight[],
  spareArts: readonly IArtifact[] = []
): FarmingCharacter[] {
  return insights.map(({ key, equipped, profile }) => {
    const slots: FarmingCharacter['slots'] = {}
    for (const slotKey of allArtifactSlotKeys) {
      const art = equipped[slotKey]
      if (art) {
        slots[slotKey] = { setKey: art.setKey, score: pieceScore(art, profile) }
        continue
      }
      const best = spareArts
        .filter((a) => a.slotKey === slotKey)
        .reduce((max, a) => Math.max(max, pieceScore(a, profile)), 0)
      slots[slotKey] = { score: best, free: true }
    }
    return { id: key, profile, slots }
  })
}
