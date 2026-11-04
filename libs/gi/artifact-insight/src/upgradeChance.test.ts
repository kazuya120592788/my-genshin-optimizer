import type { IArtifact, ISubstat } from '@genshin-optimizer/gi/schema'
import { getUpgradeOutlook } from './upgradeChance'

function art(substats: ISubstat[], extra: Partial<IArtifact> = {}): IArtifact {
  return {
    setKey: 'GladiatorsFinale',
    slotKey: 'flower',
    mainStatKey: 'hp',
    rarity: 5,
    level: 0,
    lock: false,
    location: '',
    substats: [
      ...substats,
      ...Array(4 - substats.length).fill({ key: '', value: 0 }),
    ],
    ...extra,
  } as IArtifact
}

describe('getUpgradeOutlook', () => {
  it('+20 なら今の値で確定', () => {
    const o = getUpgradeOutlook(
      art([{ key: 'critRate_', value: 3.9 }], { level: 20 }),
      ['critRate_']
    )!
    expect(o.expected).toBeCloseTo(o.current)
    expect(o.chanceAtLeast(o.current)).toBe(1)
  })

  it('有効サブステが2つある4行の聖遺物: 5回の強化で半分ずつ当たる', () => {
    const o = getUpgradeOutlook(
      art([
        { key: 'critRate_', value: 3.9 },
        { key: 'critDMG_', value: 7.8 },
        { key: 'hp', value: 299 },
        { key: 'def', value: 23 },
      ]),
      ['critRate_', 'critDMG_']
    )!
    // 1回あたり 0.5 * 0.85 の伸び
    expect(o.expected - o.current).toBeCloseTo(5 * 0.5 * 0.85)
    // 全部当たって最大値なら +5
    expect(o.chanceAtLeast(o.current + 5)).toBeCloseTo(1 / 2 ** 5 / 4 ** 5)
    expect(o.chanceAtLeast(0)).toBeCloseTo(1)
  })

  it('有効サブステがない4行の聖遺物は伸びない', () => {
    const o = getUpgradeOutlook(
      art([
        { key: 'hp', value: 299 },
        { key: 'def', value: 23 },
        { key: 'atk', value: 19 },
        { key: 'def_', value: 7.3 },
      ]),
      ['critRate_', 'critDMG_']
    )!
    expect(o.expected).toBe(0)
    expect(o.chanceAtLeast(0.7)).toBe(0)
  })

  it('3行なら最初の強化で4つ目が重みつきで付く', () => {
    const o = getUpgradeOutlook(
      art([
        { key: 'hp', value: 299 },
        { key: 'def', value: 23 },
        { key: 'atk', value: 19 },
      ]),
      ['critRate_']
    )!
    // 候補: hp_ atk_ def_ eleMas enerRech_ (4 ずつ) と critRate_ critDMG_ (3 ずつ)
    const pHit = 3 / (5 * 4 + 2 * 3)
    // 当たれば 0.85 + 残り4回で 1/4 ずつ伸びる
    expect(o.expected).toBeCloseTo(pHit * (0.85 + 4 * 0.25 * 0.85))
  })

  it('星5以外は undefined', () => {
    expect(getUpgradeOutlook(art([], { rarity: 4 }), [])).toBe(undefined)
  })
})
