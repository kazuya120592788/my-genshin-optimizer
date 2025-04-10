import { cmpGE } from '@genshin-optimizer/pando/engine'
import type { DiscSetKey } from '@genshin-optimizer/zzz/consts'
import { allBoolConditionals, own, percent, registerBuff } from '../../util'
import { entriesForDisc, registerDisc } from '../util'

const key: DiscSetKey = 'ChaosJazz'

const discCount = own.common.count.sheet(key)
const showCond4Set = cmpGE(discCount, 4, 'infer', '')

const { while_off_field } = allBoolConditionals(key)

const sheet = registerDisc(
  key,
  // Handle 2-set effects
  entriesForDisc(key),
  registerBuff(
    'set4_passive_fire_dmg_',
    own.combat.dmg_.fire.add(cmpGE(discCount, 4, percent(0.15))),
    showCond4Set
  ),
  registerBuff(
    'set4_passive_electric_dmg_',
    own.combat.dmg_.electric.add(cmpGE(discCount, 4, percent(0.15))),
    showCond4Set
  ),
  // Conditional buffs
  registerBuff(
    'set4_off_field_special_dmg_',
    own.combat.dmg_.addWithDmgType(
      'special',
      cmpGE(discCount, 4, while_off_field.ifOn(percent(0.2)))
    ),
    showCond4Set
  ),
  registerBuff(
    'set4_off_field_assist_dmg_',
    own.combat.dmg_.assistSkill.add(
      cmpGE(discCount, 4, while_off_field.ifOn(percent(0.2)))
    ),
    showCond4Set
  )
)
export default sheet
