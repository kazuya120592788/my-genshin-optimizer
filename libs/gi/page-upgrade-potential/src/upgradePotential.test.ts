import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import type { ISubstat } from '@genshin-optimizer/gi/schema'
import type { UpgradeArtifact, UpgradeTarget } from './upgradePotential'
import {
  analyzeUpgradePotential,
  defaultUpgradeConfig,
  expectedEfficiency,
  guessProfileId,
} from './upgradePotential'

function art(
  id: string,
  substats: ISubstat[],
  extra: Partial<UpgradeArtifact> = {}
): UpgradeArtifact {
  return {
    id,
    setKey: 'GladiatorsFinale',
    slotKey: 'flower',
    mainStatKey: 'hp',
    rarity: 5,
    level: 20,
    lock: false,
    location: '',
    substats: [
      ...substats,
      ...Array(4 - substats.length).fill({ key: '', value: 0 }),
    ],
    ...extra,
  } as UpgradeArtifact
}

const critKeys: SubstatKey[] = ['critRate_', 'critDMG_']

// 会心ロール 2 回分
const weak = art(
  'weak',
  [
    { key: 'critRate_', value: 3.9 },
    { key: 'critDMG_', value: 7.8 },
    { key: 'hp_', value: 5.8 },
    { key: 'def', value: 23 },
  ],
  { location: 'Diluc' }
)
// 会心ロール 6 回分
const strong = art('strong', [
  { key: 'critRate_', value: 11.7 },
  { key: 'critDMG_', value: 23.3 },
  { key: 'hp_', value: 5.8 },
  { key: 'def', value: 23 },
])

const diluc = (
  equipped: Partial<UpgradeTarget['equippedArtifacts']> = { flower: 'weak' }
): UpgradeTarget => ({
  characterKey: 'Diluc',
  location: 'Diluc',
  equippedArtifacts: equipped,
  keys: critKeys,
})

describe('guessProfileId', () => {
  it('冠が会心なら会心型', () => {
    expect(
      guessProfileId({
        sands: 'atk_',
        goblet: 'pyro_dmg_',
        circlet: 'critRate_',
      })
    ).toBe('atkCrit')
    expect(
      guessProfileId({ sands: 'hp_', goblet: 'hp_', circlet: 'critDMG_' })
    ).toBe('hpCrit')
    expect(
      guessProfileId({
        sands: 'enerRech_',
        goblet: 'atk_',
        circlet: 'critRate_',
      })
    ).toBe('atkCritEr')
  })
  it('冠が会心でなければサポート型', () => {
    expect(
      guessProfileId({ sands: 'hp_', goblet: 'hp_', circlet: 'heal_' })
    ).toBe('hpSupport')
    expect(
      guessProfileId({ sands: 'eleMas', goblet: 'eleMas', circlet: 'eleMas' })
    ).toBe('em')
  })
  it('聖遺物がなければ攻撃会心', () => {
    expect(guessProfileId({})).toBe('atkCrit')
  })
})

describe('expectedEfficiency', () => {
  it('+20 なら現在値と同じ', () => {
    const filter = new Set(critKeys)
    expect(expectedEfficiency(strong, filter)).toBeCloseTo(
      expectedEfficiency({ ...strong, level: 20 }, filter)
    )
  })
  it('有効サブステが多いほど期待値が高い', () => {
    const filter = new Set(critKeys)
    const twoGood = art(
      'a',
      [
        { key: 'critRate_', value: 3.9 },
        { key: 'critDMG_', value: 7.8 },
        { key: 'hp_', value: 5.8 },
        { key: 'def', value: 23 },
      ],
      { level: 0 }
    )
    const oneGood = art(
      'b',
      [
        { key: 'critRate_', value: 3.9 },
        { key: 'atk', value: 19 },
        { key: 'hp_', value: 5.8 },
        { key: 'def', value: 23 },
      ],
      { level: 0 }
    )
    // 有効ライン2本: 5回 × 2/4 × 0.85
    expect(expectedEfficiency(twoGood, filter)).toBeCloseTo(
      2 + 5 * 0.5 * 0.85,
      1
    )
    expect(expectedEfficiency(oneGood, filter)).toBeLessThan(
      expectedEfficiency(twoGood, filter)
    )
  })
})

describe('analyzeUpgradePotential', () => {
  it('同じセット・メインのより強い聖遺物を入れ替え候補にする', () => {
    const [res] = analyzeUpgradePotential(
      [weak, strong],
      [diluc()],
      defaultUpgradeConfig
    )
    const flower = res.slots.find((s) => s.slotKey === 'flower')!
    expect(flower.equipped?.id).toBe('weak')
    expect(flower.swap?.id).toBe('strong')
    expect(flower.swap?.gain).toBeCloseTo(4, 1)
    expect(res.totalGain).toBeCloseTo(4, 1)
    expect(res.emptySlots).toBe(4)
  })

  it('未装備の部位は既定では伸びしろに数えない', () => {
    const plume = {
      ...strong,
      id: 'plume',
      slotKey: 'plume',
    } as UpgradeArtifact
    const [res] = analyzeUpgradePotential(
      [weak, plume],
      [diluc()],
      defaultUpgradeConfig
    )
    const plumeSlot = res.slots.find((s) => s.slotKey === 'plume')!
    expect(plumeSlot.swap?.id).toBe('plume')
    expect(plumeSlot.gain).toBe(0)
    const [res2] = analyzeUpgradePotential([weak, plume], [diluc()], {
      ...defaultUpgradeConfig,
      countEmptySlots: true,
    })
    expect(res2.slots.find((s) => s.slotKey === 'plume')!.gain).toBeCloseTo(
      6,
      1
    )
  })

  it('セットが違う聖遺物は既定では候補にしない', () => {
    const other = { ...strong, setKey: 'WanderersTroupe' } as UpgradeArtifact
    const [res] = analyzeUpgradePotential(
      [weak, other],
      [diluc()],
      defaultUpgradeConfig
    )
    expect(res.slots[0].swap).toBeUndefined()
    const [res2] = analyzeUpgradePotential([weak, other], [diluc()], {
      ...defaultUpgradeConfig,
      allowOtherSets: true,
    })
    expect(res2.slots[0].swap?.id).toBe('strong')
  })

  it('ほかのキャラが装備中の聖遺物は既定では候補にしない', () => {
    const equippedByOther = {
      ...strong,
      location: 'Bennett',
    } as UpgradeArtifact
    const [res] = analyzeUpgradePotential(
      [weak, equippedByOther],
      [diluc()],
      defaultUpgradeConfig
    )
    expect(res.slots[0].swap).toBeUndefined()
    const [res2] = analyzeUpgradePotential([weak, equippedByOther], [diluc()], {
      ...defaultUpgradeConfig,
      includeEquippedByOthers: true,
    })
    expect(res2.slots[0].swap?.id).toBe('strong')
  })

  it('伸びが閾値未満なら提案しない', () => {
    const [res] = analyzeUpgradePotential([weak, strong], [diluc()], {
      ...defaultUpgradeConfig,
      minGain: 5,
    })
    expect(res.slots[0].swap).toBeUndefined()
    expect(res.slots[0].gain).toBe(0)
  })

  it('未強化の聖遺物を育成候補にする', () => {
    // サブステ3つの +0（会心2つ）: 期待値は 2 + 4回 × 2/4 × 0.85 = 3.7
    const promising = art(
      'promising',
      [
        { key: 'critRate_', value: 3.9 },
        { key: 'critDMG_', value: 7.8 },
        { key: 'hp_', value: 5.8 },
      ],
      { level: 0 }
    )
    const [res] = analyzeUpgradePotential(
      [{ ...weak, level: 20 } as UpgradeArtifact, promising],
      [diluc()],
      defaultUpgradeConfig
    )
    expect(res.slots[0].train?.id).toBe('promising')
    expect(res.slots[0].train!.gain).toBeCloseTo(1.7, 1)
  })

  it('装備中の聖遺物が未強化なら強化の伸びを数える', () => {
    const [res] = analyzeUpgradePotential(
      [{ ...weak, level: 0 } as UpgradeArtifact],
      [diluc()],
      defaultUpgradeConfig
    )
    expect(res.slots[0].levelUpGain).toBeCloseTo(5 * 0.5 * 0.85, 1)
    expect(res.slots[0].gain).toBeCloseTo(res.slots[0].levelUpGain)
  })
})
