import type { ISubstat } from '@genshin-optimizer/gi/schema'
import type { JunkArtifact, JunkConfig } from './junkArtifacts'
import { defaultJunkConfig, findJunkArtifacts } from './junkArtifacts'

function art(
  id: string,
  substats: ISubstat[],
  extra: Partial<JunkArtifact> = {}
): JunkArtifact {
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
  } as JunkArtifact
}

// 会心系だけの判定にして、レア度判定と伸びしろ判定はテストごとに切り替える
const config: JunkConfig = {
  ...defaultJunkConfig,
  usefulSubstats: ['critRate_', 'critDMG_'],
  checkLowPotential: false,
  checkLowRarity: false,
}

const good = art('good', [
  { key: 'critRate_', value: 10.5 },
  { key: 'critDMG_', value: 21 },
  { key: 'hp_', value: 5.8 },
  { key: 'def', value: 23 },
])
const worse = art('worse', [
  { key: 'critRate_', value: 3.9 },
  { key: 'critDMG_', value: 14 },
  { key: 'atk', value: 19 },
  { key: 'def', value: 23 },
])

describe('findJunkArtifacts', () => {
  it('上位互換がある聖遺物を不要候補にする', () => {
    const res = findJunkArtifacts([good, worse], new Set(), config)
    expect(res.map((r) => r.id)).toEqual(['worse'])
    expect(res[0].reasons).toEqual(['dominated'])
    expect(res[0].dominatedBy).toEqual(['good'])
  })

  it('セット・部位・メインが違えば比較しない', () => {
    const other = {
      ...worse,
      slotKey: 'plume',
      mainStatKey: 'atk',
    } as JunkArtifact
    expect(findJunkArtifacts([good, other], new Set(), config)).toEqual([])
  })

  it('上位互換の必要数を満たさなければ不要候補にしない', () => {
    const res = findJunkArtifacts([good, worse], new Set(), {
      ...config,
      dominatedCount: 2,
    })
    expect(res).toEqual([])
  })

  it('完全に同等な2つは片方だけ不要候補にし、ロック中の方を残す', () => {
    const twin = { ...good, id: 'twin', lock: true }
    const res = findJunkArtifacts([good, twin], new Set(), config)
    expect(res.map((r) => r.id)).toEqual(['good'])
  })

  it('ロック中・装備中・ビルド使用中は対象外', () => {
    const arts = [
      good,
      { ...worse, id: 'locked', lock: true },
      { ...worse, id: 'equipped', location: 'Furina' } as JunkArtifact,
      { ...worse, id: 'inBuild' },
    ]
    const res = findJunkArtifacts(arts, new Set(['inBuild']), config)
    expect(res.map((r) => r.id)).toEqual([])
  })

  it('伸びしろ不足と星4以下を判定する', () => {
    const res = findJunkArtifacts([good, { ...worse, rarity: 4 }], new Set(), {
      ...config,
      checkDominated: false,
      checkLowPotential: true,
      minMaxEfficiency: 3,
      checkLowRarity: true,
    })
    expect(res.map((r) => r.id)).toEqual(['worse'])
    expect(res[0].reasons).toEqual(['lowRarity', 'lowPotential'])
  })

  it('未強化の聖遺物は残りの強化回数を伸びしろとして考慮する', () => {
    const fresh = art(
      'fresh',
      [
        { key: 'critRate_', value: 3.9 },
        { key: 'hp', value: 299 },
        { key: 'def', value: 23 },
      ],
      { level: 0 }
    )
    const res = findJunkArtifacts([fresh], new Set(), {
      ...config,
      checkDominated: false,
      checkLowPotential: true,
      minMaxEfficiency: 4,
    })
    expect(res).toEqual([])
  })
})
