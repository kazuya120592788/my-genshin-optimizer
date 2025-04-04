import { type DedupTag, DedupTags, type Tag } from '../tag'
import { assertUnreachable, customOps } from '../util'
import type { Calculator } from './calc'
import { constant, read } from './construction'
import { arithmetic, branching } from './formula'
import type {
  AnyNode,
  BaseRead,
  Const,
  NumNode,
  StrNode,
  OP as TaggedOP,
} from './type'

/**
 * Most of functions here cache the calculation/traversal, and will skip any nodes
 * that they visit more than once. This caching will not work on nodes containing
 * `Tag`-related nodes. So they are disallowed by default here, as reflected in
 * this `OP` redeclaration.
 */
type OP = Exclude<TaggedOP, 'tag' | 'dtag' | 'vtag'>
export type NumTagFree = NumNode<OP>
type StrTagFree = StrNode<OP>
type AnyTagFree = AnyNode<OP>

/**
 * Apply all tag-related nodes from `n` calculation and replace `Read` nodes where
 * `dynTag(tag)` is not truthy. The replaced `Read` nodes are not evaluated further.
 *
 * The resulting nodes becomes "Tag"-free and can be evaluated without the need for
 * a calculator, given appropriate values for the replaced `Read` nodes.
 */
export function detach(
  n: NumNode[],
  calc: Calculator,
  dynTag: (_: Tag) => Tag | undefined
): NumTagFree[]
export function detach(
  n: StrNode[],
  calc: Calculator,
  dynTag: (_: Tag) => Tag | undefined
): StrTagFree[]
export function detach(
  n: AnyNode[],
  calc: Calculator,
  dynTag: (_: Tag) => Tag | undefined
): AnyTagFree[]
export function detach(
  n: AnyNode[],
  calc: Calculator,
  dynTag: (_: Tag) => Tag | undefined
): AnyTagFree[] {
  type Cache = DedupTag<AnyTagFree[]>
  function detachRead(cache: Cache, ex: BaseRead['ex']): AnyTagFree[] {
    if (cache.val) return cache.val
    const dyn = dynTag(cache.tag)
    cache.val = dyn
      ? [read(dyn, ex)]
      : calc.nodes.subset(cache.id).flatMap((n) => {
          return n.op !== 'reread'
            ? map(n, cache)
            : detachRead(cache.with(n.tag), ex)
        })
    return cache.val
  }
  function fold(
    x: NumTagFree[],
    op: Exclude<keyof typeof arithmetic, 'unique'>,
    ex: any
  ): NumTagFree {
    if (x.every((x) => x.op === 'const'))
      return constant(
        arithmetic[op](
          x.map((x) => x.ex),
          ex
        )
      )
    return { op, x, br: [] }
  }

  function map(n: NumNode, cache: Cache): NumTagFree
  function map(n: StrNode, cache: Cache): StrTagFree
  function map(n: AnyNode, cache: Cache): AnyTagFree
  function map(n: AnyNode, cache: Cache): AnyTagFree {
    const { op } = n
    switch (op) {
      case 'const':
        return n
      case 'read': {
        const x = detachRead(cache.with(n.tag), n.ex)
        if (n.ex === undefined) return x[0] ?? constant(undefined as any)
        return fold(x as NumTagFree[], n.ex, n.ex)
      }
      case 'sum':
      case 'prod':
      case 'min':
      case 'max':
      case 'sumfrac': {
        const x = n.x.map((x) => map(x, cache))
        return fold(x, op, n.ex)
      }
      case 'thres':
      case 'match':
      case 'lookup': {
        // We don't eagerly fold `x`. If all `br` can be folded,
        // we can short-circuit and fold only the chosen branch.
        const br = n.br.map((br) =>
          map(br, cache)
        ) as unknown as Const<string>[]
        if (br.every((n) => n.op === 'const')) {
          const branchID = branching[n.op](
            br.map((br) => br.ex),
            n.ex
          )
          return map(n.x[branchID]!, cache)
        }
        return { ...n, x: n.x.map((x) => map(x, cache)), br } as AnyTagFree
      }
      case 'subscript': {
        const index = map(n.br[0]!, cache)
        if (index.op === 'const') return constant(n.ex[index.ex]!)
        return { ...n, br: [index] }
      }
      case 'vtag':
        return constant(cache.tag[n.ex] ?? '')
      case 'tag':
        return map(n.x[0]!, cache.with(n.tag))
      case 'dtag': {
        const tags = n.br.map((br) => map(br, cache)) as Const<string>[]
        if (tags.some((x) => x.op !== 'const'))
          throw new Error('Dynamic tag must be resolvable during detachment')
        const newCache = cache.with(
          Object.fromEntries(tags.map((tag, i) => [n.ex[i], tag.ex]))
        )
        return map(n.x[0]!, newCache)
      }
      case 'custom':
        return { ...n, x: n.x.map((x) => map(x, cache)) }
      default:
        assertUnreachable(op)
    }
  }
  return n.map((n) => map(n, new DedupTags(calc.cache.keys).at({})))
}

export function mapBottomUp<I extends OP, O extends OP>(
  n: NumNode<I>[],
  map: (_: AnyNode<I>, old: AnyNode<I>) => AnyNode<O>
): NumNode<O>[]
export function mapBottomUp<I extends OP, O extends OP>(
  n: StrNode<I>[],
  map: (_: AnyNode<I>, old: AnyNode<I>) => AnyNode<O>
): StrNode<O>[]
export function mapBottomUp<I extends OP, O extends OP>(
  n: AnyNode<I>[],
  map: (_: AnyNode<I>, old: AnyNode<I>) => AnyNode<O>
): AnyNode<O>[]
export function mapBottomUp<I extends OP, O extends OP>(
  n: AnyNode<I>[],
  map: (_: AnyNode<I>, old: AnyNode<I>) => AnyNode<O>
): AnyNode<O>[] {
  const cache = new Map<AnyNode<I>, AnyNode<O>>()

  function internal(n: AnyNode<I>): AnyNode<O> {
    const old = cache.get(n)
    if (old) return old

    const prev = n
    const x = dedupMapArray(n.x, internal)
    const br = dedupMapArray(n.br, internal)
    if (n.x !== x || n.br !== br) n = { ...n, x, br } as any

    const result = map(n, prev)
    cache.set(n, result)
    return result
  }
  return dedupMapArray(n, internal)
}

export function map<I extends TaggedOP, O>(
  n: AnyNode<I>[],
  map: (n: AnyNode<I>, map: (n: AnyNode<I>) => O) => O
): O[] {
  const cache = new Map<AnyNode<I>, O>()

  function internal(n: AnyNode<I>): O {
    const old = cache.get(n)
    if (old) return old

    const result = map(n, internal)
    cache.set(n, result)
    return result
  }

  return dedupMapArray(n, internal)
}

export function traverse<P extends TaggedOP>(
  n: AnyNode<P>[],
  visit: (n: AnyNode<P>, visit: (n: AnyNode<P>) => void) => void
) {
  const visited = new Set<AnyNode<P>>()

  function internal(n: AnyNode<P>) {
    if (visited.has(n)) return
    visit(n, internal)
    visited.add(n)
  }
  n.forEach(internal)
}

function dedupMapArray<I, O>(x: I[], map: (_: I) => O): O[] {
  const newX = x.map(map)
  return x.every((x, i) => (x as any) === newX[i]) ? (x as any) : newX
}

/**
 * Generates a custom function, "cuz speed".
 *
 * @param n
 * @param dynTagCategory
 * @param slotCount
 * @param initial
 * @param header
 * @returns a custom function that accepts an array `_` of data.
 *
 * NOTE: `slotCount` === `_.length` for optimization reasons.
 */
export function compile(
  n: NumTagFree[],
  dynTagCategory: string,
  slotCount: number,
  initial: Record<string, number>
): (_: Record<string, number>[]) => number[]
export function compile(
  n: StrTagFree[],
  dynTagCategory: string,
  slotCount: number,
  initial: Record<string, string>
): (_: Record<string, string>[]) => string[]
export function compile(
  n: AnyTagFree[],
  dynTagCategory: string,
  slotCount: number,
  initial: Record<string, any>
): (_: Record<string, any>[]) => any[]
export function compile(
  n: AnyTagFree[],
  dynTagCategory: string,
  slotCount: number,
  initial: Record<string, any>
): (_: Record<string, any>[]) => any[] {
  let i = 1,
    body = `'use strict';const x0=0` // making sure `const` has at least one entry
  for (const [name, f] of Object.entries(customOps))
    body += `,${name}=${f.calc.toString()}`
  const names = new Map<AnyNode, string>()
  traverse(n, (n, visit) => {
    const name = `x${i++}`
    names.set(n, name)

    const { op, x, br } = n
    x.forEach(visit)
    br.forEach(visit)
    const argNames = x.map((x) => names.get(x)!),
      brNames = br.map((n) => names.get(n)!)

    switch (op) {
      case 'const':
        names.set(n, typeof n.ex !== 'string' ? `(${n.ex})` : `('${n.ex}')`)
        break
      case 'sum':
      case 'prod':
        body += `,${name}=`
        if (argNames.length) body += argNames.join(op == 'sum' ? '+' : '*')
        else body += op == 'sum' ? 0 : 1
        break
      case 'min':
      case 'max':
        body += `,${name}=Math.${op}(${argNames})`
        break
      case 'sumfrac':
        body += `,${name}=${argNames[0]}/(${argNames[0]} + ${argNames[1]})`
        break
      case 'match':
        body += `,${name}=${brNames[0]}===${brNames[1]}?${argNames[0]}:${argNames[1]}`
        break
      case 'thres':
        body += `,${name}=${brNames[0]}>=${brNames[1]}?${argNames[0]}:${argNames[1]}`
        break
      case 'subscript':
        // `JSON.stringify` on `number[] | string[]`
        body += `,${name}=${JSON.stringify(n.ex)}[${brNames[0]}]`
        break
      case 'read': {
        const key = n.tag[dynTagCategory]!
        let arr = [...new Array(slotCount)].map(
          (_, i) => `(b[${i}]['${key}'] ?? 0)`
        )
        if (initial[key]) arr = [initial[key]!.toString(), ...arr]
        body += `,${name}=${arr.join('+')}`
        break
      }
      case 'custom':
        body += `,${name}=${n.ex}([${argNames}])`
        break
      case 'lookup':
        // `JSON.stringify` on `Record<string, number>`
        body += `,${name}=([${argNames}])[(${JSON.stringify(n.ex)})[${
          brNames[0]
        }] ?? 0]`
        break
      default:
        assertUnreachable(op)
    }
  })
  body += `;return [${n.map((n) => names.get(n)!)}]`
  return new Function(`b`, body) as any
}
