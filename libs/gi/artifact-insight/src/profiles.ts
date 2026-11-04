import type {
  ArtifactSlotKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import { artSlotMainKeys } from '@genshin-optimizer/gi/consts'
import type { IArtifact } from '@genshin-optimizer/gi/schema'
import { getSubstatValue } from '@genshin-optimizer/gi/util'

/** メインステータスを選べる部位 */
export const mainStatSlotKeys = ['sands', 'goblet', 'circlet'] as const
export type MainStatSlotKey = (typeof mainStatSlotKeys)[number]

/** 部位ごとに「使える」メインステータス */
export type MainStatsBySlot = Record<MainStatSlotKey, readonly MainStatKey[]>

/** キャラの型（有効サブステと、使えるメインステータス） */
export interface ArtifactProfile {
  keys: readonly SubstatKey[]
  /** 省略時は `keys` から {@link defaultMainStats} で決める */
  mainStats?: MainStatsBySlot
}

export interface JunkProfile extends ArtifactProfile {
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

/** 伸ばすステータス（攻撃力%・HP%・防御力%・元素熟知） */
const scalingKeys = ['hp_', 'atk_', 'def_', 'eleMas'] as const
const dmgBonusKeys = artSlotMainKeys.goblet.filter((k) => k.endsWith('_dmg_'))
const critKeys = ['critRate_', 'critDMG_'] as const

/**
 * 有効サブステから、部位ごとに使えるメインステータスを決める。
 * - 時計: 伸ばすステータスか元素チャージ効率
 * - 杯: 伸ばすステータス。会心を使う型なら元素・物理ダメージも
 * - 冠: 伸ばすステータスと会心。会心を使わない型（サポート）なら与える治療効果も
 *
 * 伸ばすステータスが1つもない型（会心のみなど）は、どの伸ばすステータスでも使えるとみなす。
 * 有効サブステが空なら、どのメインステータスでも使えるとみなす。
 */
export function defaultMainStats(keys: readonly SubstatKey[]): MainStatsBySlot {
  if (!keys.length)
    return {
      sands: artSlotMainKeys.sands,
      goblet: artSlotMainKeys.goblet,
      circlet: artSlotMainKeys.circlet,
    }
  const ownScaling = scalingKeys.filter((k) => keys.includes(k))
  const scaling: MainStatKey[] = ownScaling.length
    ? ownScaling
    : [...scalingKeys]
  const usesCrit = critKeys.some((k) => keys.includes(k))
  return {
    sands: [...scaling, 'enerRech_'],
    goblet: usesCrit ? [...scaling, ...dmgBonusKeys] : scaling,
    circlet: usesCrit
      ? [...scaling, ...critKeys]
      : [...scaling, ...critKeys.filter((k) => keys.includes(k)), 'heal_'],
  }
}

export function isMainStatSlot(
  slotKey: ArtifactSlotKey
): slotKey is MainStatSlotKey {
  return (mainStatSlotKeys as readonly string[]).includes(slotKey)
}

/** その型でメインステータスが使えるか（花・羽は常に使える） */
export function isMainStatUseful(
  slotKey: ArtifactSlotKey,
  mainStatKey: MainStatKey,
  profile: ArtifactProfile
) {
  if (!isMainStatSlot(slotKey)) return true
  const mainStats = profile.mainStats ?? defaultMainStats(profile.keys)
  return mainStats[slotKey].includes(mainStatKey)
}

/**
 * キャラの装備中の聖遺物（と最適化設定のメインステータス絞り込み）から、
 * そのキャラの型を推定する。
 *
 * - 伸ばすステータス（攻撃力%・HP%・防御力%・元素熟知）は、時計・杯・冠のメインに一番多く出てくるもの。
 *   同数ならサブステの合計ロール数が多いもの。2部位以上のメインに出てくるものはすべて含める。
 *   メインにもサブステにも出てこなければ攻撃力%
 * - 冠が会心か、杯が元素・物理ダメージなら会心を有効にする
 * - 時計が元素チャージ効率ならチャージを有効にする
 * - 最適化設定でメインステータスを絞り込んでいれば、その設定を優先する
 *
 * 型に合わないメインステータス（攻撃会心型の防御% 時計など）は、装備していても「使える」とはみなさない。
 * 推定の材料が何もなければ `undefined` を返す。
 */
export function inferProfile(
  equipped: readonly (Pick<IArtifact, 'slotKey' | 'mainStatKey'> &
    Partial<Pick<IArtifact, 'substats'>>)[],
  /** 最適化設定で絞り込んだメインステータス（全部選んでいる部位は無視する） */
  optMainStatKeys?: Partial<Record<MainStatSlotKey, readonly MainStatKey[]>>
): ArtifactProfile | undefined {
  const narrowed: Partial<Record<MainStatSlotKey, readonly MainStatKey[]>> = {}
  for (const slot of mainStatSlotKeys) {
    const keys = optMainStatKeys?.[slot]
    if (keys?.length && keys.length < artSlotMainKeys[slot].length)
      narrowed[slot] = keys
  }
  const narrowedMains = Object.values(narrowed).flat()
  const equippedMains = equipped
    .filter(({ slotKey }) => isMainStatSlot(slotKey))
    .map(({ mainStatKey }) => mainStatKey)
  const mains = [...equippedMains, ...narrowedMains]
  if (!mains.length) return undefined

  const keys = new Set<SubstatKey>()
  const has = (list: readonly string[]) => mains.some((m) => list.includes(m))
  if (has(critKeys) || has(dmgBonusKeys)) for (const k of critKeys) keys.add(k)
  if (mains.includes('enerRech_')) keys.add('enerRech_')

  const isScaling = (k: string): k is (typeof scalingKeys)[number] =>
    (scalingKeys as readonly string[]).includes(k)
  if (narrowedMains.some(isScaling)) {
    // 最適化設定で選んだ伸ばすステータスはすべて使う
    for (const k of narrowedMains) if (isScaling(k)) keys.add(k)
  } else {
    const mainCount = (k: string) => equippedMains.filter((m) => m === k).length
    const subRolls = (k: SubstatKey) =>
      equipped.reduce(
        (sum, { substats }) =>
          sum +
          (substats ?? []).reduce(
            (s, sub) =>
              sub.key === k && sub.value
                ? s + sub.value / getSubstatValue(k)
                : s,
            0
          ),
        0
      )
    const scored = scalingKeys
      .map((k) => ({ k, mains: mainCount(k), rolls: subRolls(k) }))
      .sort((a, b) => b.mains - a.mains || b.rolls - a.rolls)
    const top = scored[0]
    keys.add(top.mains || top.rolls ? top.k : 'atk_')
    for (const { k, mains } of scored) if (mains >= 2) keys.add(k)
  }

  const sortedKeys = (
    [...scalingKeys, 'enerRech_', ...critKeys] as SubstatKey[]
  ).filter((k) => keys.has(k))
  const mainStats = defaultMainStats(sortedKeys)
  for (const slot of mainStatSlotKeys) {
    const own = narrowed[slot]
    if (own) mainStats[slot] = own
  }
  return { keys: sortedKeys, mainStats }
}

/** 有効サブステの短い表示名 */
export const substatShortNames: Record<SubstatKey, string> = {
  hp: 'HP',
  hp_: 'HP%',
  atk: '攻撃',
  atk_: '攻撃%',
  def: '防御',
  def_: '防御%',
  eleMas: '熟知',
  enerRech_: 'チャージ',
  critRate_: '会心率',
  critDMG_: '会心ダメ',
}
