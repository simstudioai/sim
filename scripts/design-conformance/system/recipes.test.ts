/** @vitest-environment node */
import { expect, test } from 'vitest'
import { type Entry, TOKEN_FILE } from '#design-conformance/shared/model'
import { extractCentralRecipes } from '#design-conformance/system/central-recipes'
import { centralFile, registry } from '#design-conformance/system/contracts'
import { assertRecipeSnapshot, snapshotHash } from '#design-conformance/system/system-snapshot'

const file = 'packages/presentation/src/layers.ts'
const other = 'packages/visual-tokens/src/elevation.ts'
const contracts = Object.fromEntries(
  [file, other].map((path) => [
    path,
    {
      exports: {
        tier: { property: 'z-index', source: `${path}#tier` },
        choose: { property: 'z-index', source: `${path}#choose` },
      },
    },
  ])
)
const extract = (source: string, path = file) => extractCentralRecipes(path, source, contracts)
const values = (source: string, path = file) =>
  extract(source, path).definitions.map((a) => [a.context, a.value])
for (const path of [file, other]) {
  test(`registered literal and derived recipe changes are visible: ${path}`, () => {
    const before =
      'export const tier = 7; const CAP = 12; export function choose(depth:number) { return Math.min(tier + depth, CAP) }'
    expect(values(before, path)).not.toEqual(values(before.replace('tier = 7', 'tier = 8'), path))
    expect(values(before, path)).not.toEqual(values(before.replace('CAP = 12', 'CAP = 13'), path))
    expect(values(before, path)).not.toEqual(
      values(before.replace('tier + depth', 'tier - depth'), path)
    )
    expect(extract(before, path).unchecked).toEqual([])
  })
  test(`types, formatting, export aliases and local aliases are quiet: ${path}`, () => {
    const before =
      'export const tier = 7; const CAP = 12; export function choose(depth:number) { const offset = depth + tier; return Math.min(offset, CAP) }'
    const after =
      '/** revised docs */ const layer:number = 7 as const; export {layer as tier}; const ceiling=12; const renamed=(input:number):number => { return Math.min(input + layer, ceiling) }; export {renamed as choose}'
    expect(values(before, path)).toEqual(values(after, path))
    expect(extract(after, path).unchecked).toEqual([])
  })
  test(`unregistered helpers and application metadata are quiet: ${path}`, () => {
    const recipe = 'export const tier = 7; export const choose=(x:number)=>x+1;'
    expect(
      values(`${recipe}export const title="One"; export function help(){ return 5 }`, path)
    ).toEqual(
      values(
        `${recipe}export const title="Two"; export function help(){ throw Error("different") }`,
        path
      )
    )
    expect(extract(recipe, 'apps/dashboard/metadata.ts').definitions).toEqual([])
  })
}
test('conditional return recipes normalize parameter names and local aliases', () => {
  const before =
    'export function choose(depth:number,state:{selected?:boolean}={}) { if(state.selected) return 19; const n=depth===undefined?0:depth+1; return Math.min(10+n,18) }'
  const after =
    'export const choose=(n:number,s:any={}) => {if(s.selected){return 19}; return Math.min(10+(n===undefined?0:n+1),18)}'
  expect(values(before)).toEqual(values(after))
  expect(values(before)).not.toEqual(values(before.replace('return 19', 'return 20')))
})
test('nested recipe parameters stay distinct from captured outer parameters', () => {
  const outer = 'export const choose=(outer:number)=>(inner:number)=>outer'
  const inner = 'export const choose=(outer:number)=>(inner:number)=>inner'
  expect(values(outer)).not.toEqual(values(inner))
  expect(extract(outer).unchecked).toEqual([])
})
test('cycles and unknown helpers preserve uncertainty and never execute source', () => {
  const unresolved = extract(
    'const a=b;const b=a;export const tier=a;export const choose=()=>unknown(5);throw new Error("never execute")'
  )
  expect(unresolved.definitions).toEqual([])
  expect(unresolved.unchecked).toHaveLength(2)
  expect(extract('throw new Error("never execute"); export const tier=8').definitions).toHaveLength(
    1
  )
  expect(extract('export const choose=()=>{for(;;){};return 8}').unchecked).toHaveLength(1)
  expect(
    extract('import Math from "unknown"; export const choose=()=>Math.min(1,2)').unchecked
  ).toHaveLength(1)
  const aliases = Array.from({ length: 15 }, (_, i) => `const a${i}=a${i + 1};`).join('')
  expect(extract(`${aliases}const a15=8;export const tier=a0`).unresolvedExports).toEqual(['tier'])
  expect(
    extract('export const choose=()=>{ const Math={min:evil};return Math.min(1,2) }').unchecked
  ).toHaveLength(1)
})
test('registered shared recipes participate in inventory and incomplete old snapshots fail when existence is proven', () => {
  const file = Object.keys(registry.centralRecipes ?? {})[0]
  expect(centralFile(file)).toBe(true)
  expect(centralFile('packages/workflow-renderer/src/application-metadata.ts')).toBe(false)
  const entries: Entry[] = [{ path: TOKEN_FILE, mode: '100644', blob: 'a'.repeat(40) }]
  const snapshot = {
    version: '1.0.0' as const,
    commit: 'b'.repeat(40),
    entries,
    hash: snapshotHash(entries),
  }
  expect(() => assertRecipeSnapshot(snapshot, [])).not.toThrow()
  expect(() =>
    assertRecipeSnapshot(snapshot, [{ path: file, mode: '100644', blob: 'c'.repeat(40) }])
  ).toThrow('known to exist')
})

test('block-local recipe aliases cannot shadow the following outer return', () => {
  const first =
    'const tier=7; export function choose(enabled:boolean){if(enabled){const tier=12;}return tier}'
  expect(values(first)).not.toEqual(values(first.replace('tier=7', 'tier=8')))
  expect(values(first)).toEqual(values(first.replace('tier=12', 'tier=13')))
})

test('returned closures retain captured lexical recipe values', () => {
  const code = 'export function choose(){const local=7;return ()=>local}'
  expect(values(code)).not.toEqual(values(code.replace('local=7', 'local=8')))
  expect(extract(code).unchecked).toEqual([])
})

test('a closure before a local const cannot capture the outer binding of that name', () => {
  const code =
    'const tier=7; export function choose(){const capture=()=>tier; const tier=12; return capture}'
  expect(extract(code).unresolvedExports).toContain('choose')
  expect(extract(code).unchecked).not.toEqual([])
})
