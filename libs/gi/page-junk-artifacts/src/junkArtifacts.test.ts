import type { SubstatKey } from '@genshin-optimizer/gi/consts'
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

describe('findJunkArtifacts（どのキャラでも不要）', () => {
  const atkCrit: SubstatKey[] = ['atk_', 'critRate_', 'critDMG_']
  const hpSupport: SubstatKey[] = ['hp_', 'enerRech_']
  const allConfig: JunkConfig = {
    ...config,
    checkDominated: false,
    checkLowPotential: true,
    minMaxEfficiency: 3,
  }
  // 攻撃会心では弱いが、HPサポートなら使える
  const hpEr = art('hpEr', [
    { key: 'hp_', value: 15.2 },
    { key: 'enerRech_', value: 16.8 },
    { key: 'def', value: 23 },
    { key: 'eleMas', value: 19 },
  ])
  // どの型でも弱い
  const trash = art('trash', [
    { key: 'hp', value: 568 },
    { key: 'def', value: 42 },
    { key: 'eleMas', value: 19 },
    { key: 'critRate_', value: 3.1 },
  ])

  it('どれか1つの型で使い道があれば候補にしない', () => {
    const res = findJunkArtifacts([hpEr, trash], new Set(), allConfig, [
      atkCrit,
      hpSupport,
    ])
    expect(res.map((r) => r.id)).toEqual(['trash'])
  })

  it('型を1つだけ指定すれば、その型で不要なものを候補にする', () => {
    const res = findJunkArtifacts([hpEr, trash], new Set(), allConfig, [
      atkCrit,
    ])
    expect(res.map((r) => r.id).sort()).toEqual(['hpEr', 'trash'])
  })

  it('一番向いている型を返す', () => {
    const res = findJunkArtifacts(
      [hpEr],
      new Set(),
      { ...allConfig, minMaxEfficiency: 9 },
      [atkCrit, hpSupport]
    )
    expect(res[0].bestProfileIndex).toBe(1)
  })

  it('型ごとに理由が違っても、すべての型で不要なら候補にする', () => {
    // 攻撃会心では上位互換あり、HPサポートでは伸びしろ不足
    const better = art('better', [
      { key: 'critRate_', value: 10.5 },
      { key: 'critDMG_', value: 21 },
      { key: 'atk_', value: 5.8 },
      { key: 'def', value: 23 },
    ])
    const target = art('target', [
      { key: 'critRate_', value: 10.1 },
      { key: 'critDMG_', value: 20.2 },
      { key: 'atk_', value: 5.3 },
      { key: 'def', value: 23 },
    ])
    const res = findJunkArtifacts(
      [better, target],
      new Set(),
      { ...allConfig, checkDominated: true },
      [atkCrit, hpSupport]
    )
    expect(res.map((r) => r.id)).toEqual(['target'])
    expect(res[0].reasons).toEqual(['lowPotential', 'dominated'])
  })
})
