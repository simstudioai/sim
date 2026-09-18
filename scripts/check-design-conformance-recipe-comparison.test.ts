import { expect, test } from 'vitest'
import { extractCentralRecipes } from '#design-conformance/central-recipes'
import { ConformanceLinter } from '#design-conformance/conformance'
import { registry } from '#design-conformance/contracts'
import { type Change, type Entry, hash, TOKEN_FILE } from '#design-conformance/model'
import { recipeDiff } from '#design-conformance/recipe-diff'
import { snapshotHash } from '#design-conformance/system-snapshot'

const recipes = registry.centralRecipes ?? {}
const file = Object.keys(recipes)[0]
const name = Object.keys(recipes[file].exports)[0]
const source = (value: string) => `export const ${name} = ${value}`
const parse = (text: string) => extractCentralRecipes(file, text)

test('registered recipe comparison separates edits, removals and unresolved replacements', () => {
  const before = parse(source('10'))
  expect(recipeDiff(file, before, parse(source('11')))).toHaveLength(1)
  expect(recipeDiff(file, before, parse(`const local=10;export {local as ${name}}`))).toEqual([])
  expect(recipeDiff(file, before, parse(source('unknown()')))).toEqual([])
  expect(recipeDiff(file, before, parse(''))[0].value).toBe('(registered export removed)')
  expect(recipeDiff(file, undefined, before)[0].reason).toContain('added')
  expect(recipeDiff(file, parse(source('unknown()')), before)[0].reason).toContain(
    'previous output was unresolved'
  )
  expect(recipeDiff('apps/sim/components/metadata.ts', before, parse(source('11')))).toEqual([])
})

test('one unresolved recipe does not conceal another explicit recipe edit', () => {
  const second = Object.keys(recipes[file].exports)[1]
  const before = parse(`${source('10')};export const ${second}=20`)
  const after = parse(`${source('unknown()')};export const ${second}=21`)
  expect(recipeDiff(file, before, after)).toHaveLength(1)
  expect(recipeDiff(file, before, after)[0].context).toBe(`central-recipe:${second}`)
})

async function compare(before: string | undefined, after: string | undefined) {
  const blobs = new Map<string, string>()
  const entry = (path: string, text: string | undefined): Entry | null => {
    if (text === undefined) return null
    const blob = hash(text).slice(0, 40)
    blobs.set(blob, text)
    return { path, blob, mode: '100644' }
  }
  const b = entry(file, before)
  const a = entry(file, after)
  const entries = [entry(TOKEN_FILE, ':root {--ink:#123456}'), b].filter(
    (e): e is Entry => e !== null
  )
  const changes: Change[] = [{ status: b && a ? 'M' : b ? 'D' : 'A', before: b, after: a }]
  const base = 'a'.repeat(40)
  const read = (e: Entry) => blobs.get(e.blob) as string
  const recipeInventory = Object.keys(recipes).sort()
  return new ConformanceLinter().analyze(
    changes,
    read,
    { base, head: 'b'.repeat(40), mergeBase: base },
    {
      snapshot: {
        version: '1.0.0',
        commit: base,
        entries,
        recipeInventory,
        hash: snapshotHash(entries, recipeInventory),
      },
      read,
    }
  )
}

test('registered source definitions integrate with snapshots and system-change reports', async () => {
  const report = await compare(source('10'), source('11'))
  expect(report.status).toBe('completed')
  expect(report.findings).toHaveLength(1)
  expect(report.findings[0]).toMatchObject({
    kind: 'system-change',
    value: '11',
    before: '10',
    file,
    line: 1,
    provenance: { source: `${file}#${name}` },
  })
  expect((await compare(source('10'), source('10 as const'))).flagged).toBe(false)
  expect((await compare(undefined, source('10'))).flagged).toBe(true)
  expect((await compare(source('10'), undefined)).flagged).toBe(true)
  const unresolved = await compare(source('10'), source('unknown()'))
  expect(unresolved.flagged).toBe(false)
  expect(unresolved.unchecked.some((n) => n.reason.includes(name))).toBe(true)
})
