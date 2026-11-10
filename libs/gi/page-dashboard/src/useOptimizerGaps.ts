import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { objPathValue } from '@genshin-optimizer/common/util'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { ICachedArtifact } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getTeamDataCalc } from '@genshin-optimizer/gi/ui'
import { useEffect, useState } from 'react'

/** 今の装備と、保存されている最適化結果（1位）とのダメージの差 */
export interface OptimizerGap {
  teamId: string
  charKey: CharacterKey
  /** 今の装備での最適化ターゲットの値 */
  current: number
  /** 最適化結果1位の装備での値 */
  best: number
  /** 最適化した日時 */
  buildDate: number
  /**
   * 最適化結果が今も使えるか。
   * - ok: 使える
   * - outdated: 今の装備のほうが良い（最適化したあとに装備を良くした）
   * - missing: 最適化結果の聖遺物が削除されていて比べられない（best は current と同じ値にしている）
   */
  status: 'ok' | 'outdated' | 'missing'
}

/**
 * チームごとに、先頭のキャラの「今の装備」と「最適化結果1位」の最適化ターゲットの値を計算する。
 * 最適化ターゲットと最適化結果が保存されているチームだけが対象。
 * 計算が重いので、チームごとに少しずつ計算する。計算が終わるまで `done` は false。
 */
export function useOptimizerGaps() {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const teams = useDataManagerValues(database.teams)
  const arts = useDataManagerValues(database.arts)
  const optConfigs = useDataManagerValues(database.optConfigs)
  const buildLists = useDataManagerValues(database.generatedBuildList)
  const [state, setState] = useState<{ gaps: OptimizerGap[]; done: boolean }>({
    gaps: [],
    done: false,
  })

  // arts などは中身を使わないが、DB が変わったときに計算し直すために依存に入れる
  useEffect(() => {
    let cancelled = false
    const gaps: OptimizerGap[] = []
    const teamIds = database.teams.keys
    setState({ gaps: [], done: !teamIds.length })
    let i = 0
    const step = () => {
      if (cancelled) return
      const teamId = teamIds[i++]
      if (teamId) {
        try {
          const gap = computeGap(teamId)
          if (gap) gaps.push(gap)
        } catch {
          // 計算できないチームは飛ばす
        }
      }
      if (i < teamIds.length) setTimeout(step, 0)
      else setState({ gaps: [...gaps], done: true })
    }
    const computeGap = (teamId: string): OptimizerGap | undefined => {
      const team = database.teams.get(teamId)
      const loadout = team?.loadoutData[0]
      if (!loadout || loadout.buildType === 'tc') return undefined
      const teamChar = database.teamChars.get(loadout.teamCharId)
      if (!teamChar) return undefined
      const optConfig = database.optConfigs.get(teamChar.optConfigId)
      const target = optConfig?.optimizationTarget
      if (!optConfig || !target || !optConfig.generatedBuildListId)
        return undefined
      const list = database.generatedBuildList.get(
        optConfig.generatedBuildListId
      )
      const build = list?.builds[0]
      if (!list || !build) return undefined

      const value = (overrideArts?: ICachedArtifact[]) => {
        const data = getTeamDataCalc(
          database,
          teamId,
          gender,
          loadout.teamCharId,
          optConfig.mainStatAssumptionLevel,
          overrideArts,
          overrideArts && build.weaponId
            ? database.weapons.get(build.weaponId)
            : undefined
        )?.[teamChar.key]?.target
        const node = data && objPathValue(data.getDisplay(), target)
        return typeof node?.value === 'number'
          ? (node.value as number)
          : Number.NaN
      }
      const current = value()
      if (!Number.isFinite(current) || current <= 0) return undefined
      const base = {
        teamId,
        charKey: teamChar.key,
        current,
        buildDate: list.buildDate,
      }
      // 削除された聖遺物は最適化結果から消えるので、部位が欠けた結果とは比べない
      if (
        !optConfig.allowPartial &&
        allArtifactSlotKeys.some((slot) => !build.artifactIds[slot])
      )
        return { ...base, best: current, status: 'missing' }
      const best = value(
        Object.values(build.artifactIds)
          .map((id) => (id ? database.arts.get(id) : undefined))
          .filter((a): a is ICachedArtifact => !!a)
      )
      if (!Number.isFinite(best)) return undefined
      return { ...base, best, status: best < current ? 'outdated' : 'ok' }
    }
    const timer = setTimeout(step, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [database, gender, teams, arts, optConfigs, buildLists])

  return state
}
