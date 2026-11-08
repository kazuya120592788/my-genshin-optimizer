import { defaultMainStats, inferProfile, isMainStatUseful } from './profiles'

describe('defaultMainStats', () => {
  it('攻撃会心型: 攻撃%・チャージの時計、攻撃%・元素ダメの杯、会心の冠', () => {
    const m = defaultMainStats(['atk_', 'critRate_', 'critDMG_'])
    expect(m.sands).toEqual(['atk_', 'enerRech_'])
    expect(m.goblet).toContain('pyro_dmg_')
    expect(m.goblet).not.toContain('def_')
    expect(m.circlet).toEqual(['atk_', 'critRate_', 'critDMG_'])
  })

  it('サポート型: 杯に元素ダメは入らず、冠に治療効果が入る', () => {
    const m = defaultMainStats(['hp_', 'enerRech_'])
    expect(m.goblet).toEqual(['hp_'])
    expect(m.circlet).toEqual(['hp_', 'heal_'])
  })

  it('伸ばすステータスがない型は、どの伸ばすステータスでも使える', () => {
    const m = defaultMainStats(['critRate_', 'critDMG_'])
    expect(m.sands).toEqual(['hp_', 'atk_', 'def_', 'eleMas', 'enerRech_'])
  })
})

describe('isMainStatUseful', () => {
  const profile = { keys: ['atk_', 'critRate_', 'critDMG_'] as const }
  it('花・羽は常に使える', () => {
    expect(isMainStatUseful('flower', 'hp', { keys: [...profile.keys] })).toBe(
      true
    )
  })
  it('攻撃会心型の防御% 時計は使えない', () => {
    expect(isMainStatUseful('sands', 'def_', { keys: [...profile.keys] })).toBe(
      false
    )
  })
})

describe('inferProfile', () => {
  it('装備のメインステータスから型を推定する', () => {
    const p = inferProfile([
      { slotKey: 'flower', mainStatKey: 'hp' },
      { slotKey: 'sands', mainStatKey: 'hp_' },
      { slotKey: 'goblet', mainStatKey: 'hydro_dmg_' },
      { slotKey: 'circlet', mainStatKey: 'critRate_' },
    ])!
    expect(p.keys).toEqual(['hp_', 'critRate_', 'critDMG_'])
    expect(p.mainStats!.sands).toEqual(['hp_', 'enerRech_'])
  })

  it('伸ばすステータスがわからなければ攻撃% にする', () => {
    const p = inferProfile([
      { slotKey: 'sands', mainStatKey: 'enerRech_' },
      { slotKey: 'circlet', mainStatKey: 'critDMG_' },
    ])!
    expect(p.keys).toEqual(['atk_', 'enerRech_', 'critRate_', 'critDMG_'])
  })

  it('最適化設定で絞り込んだメインステータスを優先する', () => {
    const p = inferProfile([], {
      sands: ['eleMas'],
      goblet: ['eleMas'],
      circlet: ['eleMas'],
    })!
    expect(p.keys).toEqual(['eleMas'])
    expect(p.mainStats!.sands).toEqual(['eleMas'])
  })

  it('伸ばすステータスを全部残した絞り込み（ほかの元素の杯を外しただけ）では、装備から推定する', () => {
    const p = inferProfile(
      [
        { slotKey: 'sands', mainStatKey: 'atk_' },
        { slotKey: 'goblet', mainStatKey: 'anemo_dmg_' },
        { slotKey: 'circlet', mainStatKey: 'critDMG_' },
      ],
      {
        goblet: [
          'hp_',
          'eleMas',
          'physical_dmg_',
          'def_',
          'atk_',
          'anemo_dmg_',
        ],
      }
    )!
    expect(p.keys).toEqual(['atk_', 'critRate_', 'critDMG_'])
    // 絞り込みそのものは、使えるメインステータスとして残す
    expect(p.mainStats!.goblet).toContain('physical_dmg_')
  })

  it('メインが割れたら、サブステの多い方を伸ばすステータスにし、合わないメインは使えないとみなす', () => {
    const p = inferProfile([
      {
        slotKey: 'sands',
        mainStatKey: 'def_',
        substats: [{ key: 'atk_', value: 5.8 }],
      },
      {
        slotKey: 'goblet',
        mainStatKey: 'atk_',
        substats: [{ key: 'atk_', value: 9.9 }],
      },
      { slotKey: 'circlet', mainStatKey: 'critRate_' },
    ])!
    expect(p.keys).toEqual(['atk_', 'critRate_', 'critDMG_'])
    expect(isMainStatUseful('sands', 'def_', p)).toBe(false)
  })

  it('2部位以上のメインに出てくる伸ばすステータスはすべて含める', () => {
    const p = inferProfile([
      { slotKey: 'sands', mainStatKey: 'hp_' },
      { slotKey: 'goblet', mainStatKey: 'eleMas' },
      { slotKey: 'circlet', mainStatKey: 'eleMas' },
    ])!
    expect(p.keys).toEqual(['eleMas'])
    expect(isMainStatUseful('sands', 'hp_', p)).toBe(false)
  })

  it('材料がなければ undefined', () => {
    expect(inferProfile([{ slotKey: 'flower', mainStatKey: 'hp' }])).toBe(
      undefined
    )
  })
})
