/** @vitest-environment node */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { extractCentralRecipes } from '#design-conformance/central-recipes'
import { centralFile, registry } from '#design-conformance/contracts'
import { git, writeJson } from '#design-conformance/io'
import { type Entry, TOKEN_FILE } from '#design-conformance/model'
import {
  assertRecipeSnapshot,
  gitSnapshot,
  loadSnapshot,
  snapshotHash,
} from '#design-conformance/system-snapshot'

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

test('merge-base snapshots include registered recipes and support historical absence', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'central-recipe-snapshot-'))
  try {
    git(root, ['init', '-q'])
    const commit = () => {
      git(root, ['add', '.'])
      git(root, [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        'fixture',
      ])
      return git(root, ['rev-parse', 'HEAD']).toString().trim()
    }
    mkdirSync(path.join(root, path.dirname(TOKEN_FILE)), { recursive: true })
    writeFileSync(path.join(root, TOKEN_FILE), ':root {--ink:#123456}')
    const absent = commit()
    const file = Object.keys(registry.centralRecipes ?? {})[0]
    mkdirSync(path.join(root, path.dirname(file)), { recursive: true })
    writeFileSync(path.join(root, file), 'export const EDGE_Z_BASE=10')
    const present = commit()
    const old = gitSnapshot(root, absent)
    const next = gitSnapshot(root, present)
    expect(old.snapshot.entries.some((e) => e.path === file)).toBe(false)
    expect(next.snapshot.entries.some((e) => e.path === file)).toBe(true)
    const incomplete = {
      ...next.snapshot,
      recipeInventory: undefined,
      entries: old.snapshot.entries,
      hash: snapshotHash(old.snapshot.entries),
    }
    const frozen = path.join(root, 'frozen')
    mkdirSync(path.join(frozen, 'commits'), { recursive: true })
    writeJson(path.join(frozen, 'commits', `${present}.json`), incomplete)
    writeJson(path.join(frozen, 'commits', `${absent}.json`), old.snapshot)
    writeJson(path.join(frozen, 'manifest.json'), {
      version: '1.0.0',
      snapshots: { [present]: incomplete.hash, [absent]: old.snapshot.hash },
    })
    expect(() => loadSnapshot(frozen, present, root)).toThrow('known to exist')
    expect(loadSnapshot(frozen, present).unchecked).toHaveLength(1)
    expect(loadSnapshot(frozen, absent).unchecked).toEqual([])
    expect(old.snapshot.recipeInventory).toContain(file)
    expect(snapshotHash(old.snapshot.entries)).not.toBe(old.snapshot.hash)
    writeJson(path.join(frozen, 'commits', `${absent}.json`), {
      ...old.snapshot,
      recipeInventory: [],
    })
    expect(() => loadSnapshot(frozen, absent)).toThrow('incompatible')
    writeJson(path.join(frozen, 'commits', `${absent}.json`), old.snapshot)
    expect(() => loadSnapshot(frozen, absent, root)).not.toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
