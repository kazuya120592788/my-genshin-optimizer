import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
} from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, ICachedArtifact } from '@genshin-optimizer/gi/db'
import type { ArtifactProfile } from './profiles'
import { inferProfile } from './profiles'

/** キャラごとの装備と、推定した型 */
export interface CharacterInsight {
  key: CharacterKey
  equipped: Partial<Record<ArtifactSlotKey, ICachedArtifact>>
  profile: ArtifactProfile
  /** 最適化設定のメインステータス絞り込みを型の推定に使ったか */
  fromOptConfig: boolean
}

/**
 * 所持キャラごとに、装備中の聖遺物と最適化設定から型を推定する。
 * 聖遺物を何も装備しておらず、最適化設定でメインステータスも絞り込んでいないキャラは含めない。
 */
export function getCharacterInsights(
  database: ArtCharDatabase
): CharacterInsight[] {
  const insights: CharacterInsight[] = []
  for (const char of database.chars.values) {
    const equipped: CharacterInsight['equipped'] = {}
    for (const [slot, id] of Object.entries(char.equippedArtifacts)) {
      const art = id ? database.arts.get(id) : undefined
      if (art) equipped[slot as ArtifactSlotKey] = art
    }
    // チームごとの最適化設定のうち、メインステータスを絞り込んでいるもの
    const optMainStatKeys = database.teamChars.values
      .filter((tc) => tc.key === char.key)
      .map((tc) => database.optConfigs.get(tc.optConfigId)?.mainStatKeys)
      .find((keys) => keys && inferProfile([], keys) !== undefined)
    const profile = inferProfile(Object.values(equipped), optMainStatKeys)
    if (!profile) continue
    insights.push({
      key: char.key,
      equipped,
      profile,
      fromOptConfig: !!optMainStatKeys,
    })
  }
  return insights
}

/**
 * 使っているセット。キャラが2つ以上装備しているセットと、
 * 保存済みビルドで2つ以上使っているセット。
 */
export function getUsedSetKeys(
  insights: readonly CharacterInsight[],
  buildArtifacts: ReadonlyArray<ReadonlyArray<ICachedArtifact>> = []
): Set<ArtifactSetKey> {
  const used = new Set<ArtifactSetKey>()
  const add = (arts: ReadonlyArray<ICachedArtifact>) => {
    const counts = new Map<ArtifactSetKey, number>()
    for (const { setKey } of arts)
      counts.set(setKey, (counts.get(setKey) ?? 0) + 1)
    for (const [setKey, count] of counts) if (count >= 2) used.add(setKey)
  }
  for (const { equipped } of insights) add(Object.values(equipped))
  for (const arts of buildArtifacts) add(arts)
  return used
}
