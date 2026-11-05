import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { setKeysByRarities } from '@genshin-optimizer/gi/util'
import { useEffect, useState } from 'react'
import type { CharacterInsight } from './characters'
import type { DomainFarmingResult, FarmingOptions } from './farming'
import {
  getArtifactDomains,
  recommendDomains,
  toFarmingCharacters,
} from './farming'

/**
 * 秘境のおすすめ順。計算に少し時間がかかるので、描画のあとで計算する。
 * 計算中は `undefined`。
 */
export function useDomainRecommendations(
  insights: readonly CharacterInsight[],
  options?: FarmingOptions
): DomainFarmingResult[] | undefined {
  const database = useDatabase()
  const arts = useDataManagerValues(database.arts)
  const [results, setResults] = useState<DomainFarmingResult[]>()
  const samples = options?.samples
  const seed = options?.seed
  useEffect(() => {
    setResults(undefined)
    const timer = setTimeout(() => {
      setResults(
        recommendDomains(
          toFarmingCharacters(
            insights,
            arts.filter((a) => !a.location)
          ),
          getArtifactDomains(setKeysByRarities[5]),
          { samples, seed }
        )
      )
    }, 0)
    return () => clearTimeout(timer)
  }, [insights, arts, samples, seed])
  return results
}
