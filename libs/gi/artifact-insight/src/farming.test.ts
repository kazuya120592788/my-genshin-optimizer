import type { FarmingCharacter } from './farming'
import {
  evaluateSets,
  getArtifactDomains,
  recommendDomains,
  sampleSubstats,
  toFarmingCharacters,
} from './farming'

const atkCrit = { keys: ['atk_', 'critRate_', 'critDMG_'] as const }
const profile = { keys: [...atkCrit.keys] }

describe('sampleSubstats', () => {
  it('メインと同じサブステは付かず、+20 の伸びの合計は 8〜9 回分', () => {
    let seed = 1
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (const sample of sampleSubstats('critRate_', 100, rand)) {
      expect(sample.map(([k]) => k)).not.toContain('critRate_')
      expect(new Set(sample.map(([k]) => k)).size).toBe(4)
      const total = sample.reduce((s, [, v]) => s + v, 0)
      expect(total).toBeGreaterThanOrEqual(8 * 0.7 - 1e-9)
      expect(total).toBeLessThanOrEqual(9 + 1e-9)
    }
  })
})

describe('getArtifactDomains', () => {
  it('ペアのわからないセットは1セットの秘境にし、秘境で出ないセットは除く', () => {
    const domains = getArtifactDomains([
      'ViridescentVenerer',
      'MaidenBeloved',
      'GladiatorsFinale',
      'ScarletProof',
    ])
    expect(domains.map((d) => d.sets)).toEqual([
      ['ViridescentVenerer', 'MaidenBeloved'],
      ['ScarletProof'],
    ])
  })
})

describe('toFarmingCharacters', () => {
  it('空いた部位は手持ちの予備で一番良いもので埋め、どのセットとも入れ替えられる部位にする', () => {
    const spare = {
      setKey: 'PaleFlame',
      slotKey: 'plume',
      mainStatKey: 'atk',
      rarity: 5,
      level: 20,
      lock: false,
      location: '',
      substats: [{ key: 'critRate_', value: 3.9 }],
    } as const
    const [char] = toFarmingCharacters(
      [{ key: 'Bennett', equipped: {}, profile, fromOptConfig: false }],
      [{ ...spare, substats: [...spare.substats] }]
    )
    expect(char.slots.plume).toEqual({
      score: expect.closeTo(1, 2),
      free: true,
    })
    expect(char.slots.flower).toEqual({ score: 0, free: true })
  })
})

describe('evaluateSets / recommendDomains', () => {
  // 4セット + 空き1つ
  const emblemChar: FarmingCharacter = {
    id: 'raiden',
    profile,
    slots: {
      flower: { setKey: 'EmblemOfSeveredFate', score: 5 },
      plume: { setKey: 'EmblemOfSeveredFate', score: 5 },
      sands: { setKey: 'EmblemOfSeveredFate', score: 5 },
      goblet: { setKey: 'EmblemOfSeveredFate', score: 5 },
    },
  }

  it('空いている部位はどのセットでも伸びる', () => {
    const res = evaluateSets(
      [emblemChar],
      ['EmblemOfSeveredFate', 'PaleFlame'],
      {
        samples: 200,
      }
    )
    expect(res['PaleFlame'].gainPerDrop).toBeGreaterThan(0)
    // 使っているセットなら他の部位も入れ替えられるので、もっと伸びる
    expect(res['EmblemOfSeveredFate'].gainPerDrop).toBeGreaterThan(
      res['PaleFlame'].gainPerDrop
    )
  })

  it('全部位が強ければ伸びない', () => {
    const strong: FarmingCharacter = {
      id: 'strong',
      profile,
      slots: Object.fromEntries(
        ['flower', 'plume', 'sands', 'goblet', 'circlet'].map((s) => [
          s,
          { setKey: 'EmblemOfSeveredFate', score: 99 },
        ])
      ),
    }
    const res = evaluateSets([strong], ['EmblemOfSeveredFate'], {
      samples: 50,
    })
    expect(res['EmblemOfSeveredFate'].gainPerDrop).toBe(0)
  })

  it('使っているセットの秘境が上位に来る', () => {
    // 4セット + 強いオフピース: 4セットの部位は同じセットでしか入れ替えられない
    const tight: FarmingCharacter = {
      ...emblemChar,
      slots: {
        ...emblemChar.slots,
        circlet: { setKey: 'GladiatorsFinale', score: 9 },
      },
    }
    const [top] = recommendDomains(
      [tight],
      [
        { id: 'tom', sets: ['TenacityOfTheMillelith', 'PaleFlame'] },
        {
          id: 'emblem',
          sets: ['EmblemOfSeveredFate', 'ShimenawasReminiscence'],
        },
      ],
      { samples: 100 }
    )
    expect(top.domain.id).toBe('emblem')
    expect(top.beneficiaries[0].id).toBe('raiden')
  })
})
