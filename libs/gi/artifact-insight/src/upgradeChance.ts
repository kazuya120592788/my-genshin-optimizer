import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import type { IArtifact } from '@genshin-optimizer/gi/schema'
import {
  getArtifactEfficiency,
  getArtifactMeta,
  getRollsRemaining,
} from '@genshin-optimizer/gi/util'

/** 新しいサブステが付くときの重み（ゲーム内の確率） */
export const substatWeights: Record<SubstatKey, number> = {
  hp: 6,
  atk: 6,
  def: 6,
  hp_: 4,
  atk_: 4,
  def_: 4,
  eleMas: 4,
  enerRech_: 4,
  critRate_: 3,
  critDMG_: 3,
}

/** 星5の1回の伸び幅（最大値に対する割合）。4段階が等確率 */
export const rollTiers = [0.7, 0.8, 0.9, 1] as const

/** 0.1 刻みの分布。index * 0.1 が値 */
type Dist = number[]

function addRolls(dist: Dist, rolls: number, hitChance: number): Dist {
  let cur = dist
  for (let r = 0; r < rolls; r++) {
    const next = new Array<number>(cur.length + 10).fill(0)
    cur.forEach((p, i) => {
      if (!p) return
      next[i] += p * (1 - hitChance)
      for (const tier of rollTiers)
        next[i + Math.round(tier * 10)] += (p * hitChance) / rollTiers.length
    })
    cur = next
  }
  return cur
}

export interface UpgradeOutlook {
  /** 今の Roll Value（有効サブステのみ） */
  current: number
  /** +20 まで強化したときの Roll Value の期待値 */
  expected: number
  /** +20 まで強化したときに Roll Value が `x` 以上になる確率 */
  chanceAtLeast: (x: number) => number
}

/**
 * 星5の聖遺物を +20 まで強化したときの Roll Value（有効サブステの伸び）の分布を求める。
 * ゲームと同じく、強化のたびに4つのサブステから等確率で1つが伸び、
 * サブステが3つしかなければ最初の強化で重みつきで4つ目が付く。
 * 星5以外は `undefined`。
 */
export function getUpgradeOutlook(
  art: IArtifact,
  usefulKeys: readonly SubstatKey[]
): UpgradeOutlook | undefined {
  if (art.rarity !== 5) return undefined
  const filter = new Set<SubstatKey>(
    usefulKeys.length ? usefulKeys : allSubstatKeys
  )
  const { currentEfficiency: current } = getArtifactEfficiency(art, filter)
  let rolls = getRollsRemaining(art.level, art.rarity)

  const lineKeys = art.substats
    .map((s) => s.key)
    .filter(Boolean) as SubstatKey[]
  const unactivated = art.unactivatedSubstats?.find((s) => s.key)
  let base = current
  if (unactivated?.key) {
    // 4つ目のサブステは +4 で有効になる。その強化は伸びに使われない
    lineKeys.push(unactivated.key as SubstatKey)
    if (filter.has(unactivated.key as SubstatKey))
      base +=
        getArtifactMeta(art).artifactMeta.unactivatedSubstats[0]?.efficiency ??
        0
    if (rolls) rolls--
  }
  if (!rolls)
    return {
      current,
      expected: base,
      chanceAtLeast: (x) => (base >= x - 1e-9 ? 1 : 0),
    }

  const useful = lineKeys.filter((k) => filter.has(k)).length
  let dist: Dist
  if (lineKeys.length >= 4) {
    dist = addRolls([1], rolls, useful / 4)
  } else {
    // 空きが1つ: 最初の強化で新しいサブステが付く
    const candidates = allSubstatKeys.filter(
      (k) => k !== art.mainStatKey && !lineKeys.includes(k)
    )
    const total = candidates.reduce((s, k) => s + substatWeights[k], 0)
    const pUseful =
      candidates
        .filter((k) => filter.has(k))
        .reduce((s, k) => s + substatWeights[k], 0) / total
    const afterHit = addRolls(addRolls([1], 1, 1), rolls - 1, (useful + 1) / 4)
    const afterMiss = addRolls([1], rolls - 1, useful / 4)
    dist = new Array(Math.max(afterHit.length, afterMiss.length)).fill(0)
    afterHit.forEach((p, i) => (dist[i] += p * pUseful))
    afterMiss.forEach((p, i) => (dist[i] += p * (1 - pUseful)))
  }

  const expected = base + dist.reduce((s, p, i) => s + (p * i) / 10, 0)
  return {
    current,
    expected,
    chanceAtLeast: (x) =>
      dist.reduce(
        // 0.1 刻みの丸め誤差を吸収する
        (s, p, i) => (base + i / 10 >= x - 1e-9 ? s + p : s),
        0
      ),
  }
}
