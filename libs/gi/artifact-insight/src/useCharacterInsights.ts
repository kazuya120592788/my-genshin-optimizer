import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { useMemo } from 'react'
import type { CharacterInsight } from './characters'
import { getCharacterInsights } from './characters'

/** 所持キャラごとの装備と推定した型。DB が変わると作り直す */
export function useCharacterInsights(): CharacterInsight[] {
  const database = useDatabase()
  const arts = useDataManagerValues(database.arts)
  const chars = useDataManagerValues(database.chars)
  const teamChars = useDataManagerValues(database.teamChars)
  const optConfigs = useDataManagerValues(database.optConfigs)
  // arts などは中身を使わないが、DB が変わったときに作り直すために依存に入れる
  return useMemo(
    () => getCharacterInsights(database),
    [database, arts, chars, teamChars, optConfigs]
  )
}
