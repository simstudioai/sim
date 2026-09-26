import { expect, test } from 'vitest'
import { classifyLayout } from '#control-analysis/layout-allowances'
import { ConformanceLinter } from '#design-conformance/conformance'
import { type Finding, hash, TOKEN_FILE } from '#design-conformance/model'
import { snapshotHash } from '#design-conformance/system-snapshot'
import { testComponents } from '#design-conformance/test-source'

const file = 'apps/sim/components/example.tsx'
const source = 'import {ChipModalField as Field,ChipModal,ChipInput} from "@sim/emcn";'
const entry = (path: string, text: string) => ({
  path,
  blob: hash(text).slice(0, 40),
  mode: '100644',
})
async function inspect(body: string) {
  const code = source + body
  const css = '@theme { --spacing: .25rem; --text-sm: .875rem; }'
  const texts: Record<string, string> = { ...testComponents, [TOKEN_FILE]: css }
  const entries = Object.entries(texts).map(([file, source]) => entry(file, source))
  const raw = await new ConformanceLinter().analyze(
    [{ status: 'A', before: null, after: entry(file, code) }],
    () => code,
    { base: 'a'.repeat(40), head: 'b'.repeat(40), mergeBase: 'a'.repeat(40) },
    {
      snapshot: {
        version: '1.0.0',
        commit: 'a'.repeat(40),
        hash: snapshotHash(entries),
        entries,
      },
      read: (e) => texts[e.path],
    }
  )
  return { raw, ...classifyLayout(raw.findings) }
}

test('resolved aliases allow only external wrapper growth and bounded modal viewport heights', async () => {
  const result = await inspect(
    'export const View=()=> <><Field className="flex-1 min-h-0 shrink-0"/><ChipModal className="h-[90vh]"/><ChipModal className="h-[76dvh]"/></>'
  )
  expect(result.allowances).toHaveLength(5)
  expect(result.findings.filter((f) => f.rule === 'component-chrome')).toEqual([])
})

test('internal chrome, field direction, other targets and non-viewport heights remain flagged', async () => {
  const result = await inspect(
    'export const View=()=> <><Field className="flex-1 flex-row gap-2 p-2 border text-sm bg-red-500 h-9"/><ChipInput className="h-[90vh]"/><ChipModal className="h-[101vh] h-[40px]"/></>'
  )
  expect(result.allowances).toHaveLength(1)
  for (const value of [
    'flex-row',
    'gap-2',
    'p-2',
    'border',
    'text-sm',
    'bg-red-500',
    'h-9',
    'h-[90vh]',
    'h-[101vh]',
    'h-[40px]',
  ])
    expect(result.findings.some((f) => f.value === value)).toBe(true)
})

test('unknown spreads and dynamic styling remain analysis gaps beside a resolved layout declaration', async () => {
  const result = await inspect(
    'export const View=({props,classes})=> <><Field className="flex-1" {...props}/><Field className={classes}/></>'
  )
  expect(result.raw.unchecked.length).toBeGreaterThan(0)
  expect(result.raw.unchecked.some((n) => /spread|unresolved|dynamic/i.test(n.reason))).toBe(true)
})

test('descendant selectors, alternate slots, important and state variants do not gain permission', async () => {
  const result = await inspect(
    'export const View=()=> <><Field className="hover:flex-1 !flex-1 [&_input]:flex-1"/><ChipModal className="hover:h-[90vh] !h-[90vh]"/></>'
  )
  expect(result.allowances).toEqual([])
})

test('only source-resolved usage findings qualify; unrelated properties and lookalike symbols survive', async () => {
  const valid = (
    await inspect('export const View=()=> <Field className="flex-1"/>')
  ).raw.findings.find((f) => f.property === 'flex') as Finding
  expect(valid).toBeDefined()
  const invalid: Finding[] = [
    { ...valid, kind: 'system-change' },
    { ...valid, rule: 'central-colour' },
    { ...valid, property: 'padding' },
    { ...valid, context: valid.context.replace('@sim/emcn#', 'local#') },
    { ...valid, context: valid.context.replace('className', 'inputClassName') },
    { ...valid, provenance: undefined },
    { ...valid, reason: `${valid.reason}; styling forwarded through a wrapper` },
    { ...valid, value: 'flex-1 p-4' },
  ]
  expect(classifyLayout(invalid).findings).toEqual(invalid)
})
