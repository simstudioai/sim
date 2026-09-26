/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Proposed source fixtures. */

import { expect, test } from 'vitest'
import { ConformanceLinter } from '#design-conformance/conformance'
import { type Change, type Entry, hash, TOKEN_FILE } from '#design-conformance/model'
import { snapshotHash } from '#design-conformance/system-snapshot'
import { testComponents } from '#design-conformance/test-source'

const root = 'apps/sim/components/'
const base = 'a'.repeat(40)
const central: Record<string, string> = {
  ...testComponents,
  [TOKEN_FILE]:
    '@theme {--text-small:13px;--radius-lg:8px;--shadow-card:0 1px 2px #000;} :root {--ink:#123456}',
  'packages/emcn/src/components/wizard/wizard.tsx': `export const Wizard=({children})=><ChipModalBody>{children}</ChipModalBody>`,
}
async function compare(
  before: Record<string, string>,
  after: Record<string, string>,
  inventory: Record<string, string> = {},
  rename?: [string, string]
) {
  const blobs = new Map<string, string>()
  const entry = (path: string, text: string | undefined) => {
    if (text === undefined) return null
    const blob = hash(text).slice(0, 40)
    blobs.set(blob, text)
    return { path, blob, mode: '100644' }
  }
  const changes: Change[] = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .map((path) => ({
      status: 'M',
      before: entry(path, before[path]),
      after: entry(path, after[path]),
    }))
  if (rename) {
    changes.splice(0, changes.length, {
      status: 'R100',
      before: entry(rename[0], before[rename[0]]),
      after: entry(rename[1], after[rename[1]]),
    })
  }
  const sources = {
    ...central,
    ...inventory,
    'packages/emcn/src/index.ts': `${central['packages/emcn/src/index.ts']}\n${inventory['packages/emcn/src/index.ts'] ?? ''}`,
    ...Object.fromEntries(Object.entries(before).filter(([p]) => p.startsWith('packages/emcn/'))),
  }
  const entries = Object.entries(sources)
    .flatMap(([p, value]) => {
      const e = entry(p, value)
      return e ? [e] : []
    })
    .sort((a, b) => a.path.localeCompare(b.path))
  return new ConformanceLinter().analyze(
    changes,
    (e: Entry) => {
      const text = blobs.get(e.blob)
      if (text === undefined) throw new Error('Missing fixture blob')
      return text
    },
    { base, head: 'b'.repeat(40), mergeBase: base },
    {
      snapshot: { version: '1.0.0', commit: base, hash: snapshotHash(entries), entries },
      read: (e: Entry) => {
        const text = blobs.get(e.blob)
        if (text === undefined) throw new Error('Missing fixture blob')
        return text
      },
    }
  )
}

const p = `${root}screen.tsx`
const q = `${root}content.tsx`
const debt = '<h1 className="text-[40px]">Heading</h1>'
test('a nested imported delegate surfaces moved debt once regardless of reuse', async () => {
  const before = { [p]: `export const Screen=()=> <main>${debt}</main>` }
  const after = {
    [p]: 'import {Content} from "./content";export const Screen=()=> <main><Content/></main>;export const Other=()=> <Content/>',
    [q]: `export const Content=()=> ${debt}`,
  }
  expect((await compare(before, after)).flagged).toBe(true)
  expect(
    (await compare(before, { ...after, [q]: `export const Content=()=> <>${debt}${debt}</>` }))
      .findings
  ).toHaveLength(2)
  expect((await compare(before, { ...after, [q]: after[q].replace('40px', '41px') })).flagged).toBe(
    true
  )
})
test('ambiguous new delegates and unrelated deleted owners cannot cancel new debt', async () => {
  const before = { [p]: `export const Screen=()=> ${debt}` }
  const after = {
    [p]: 'import {Content} from "./content";import {Other} from "./other";export const Screen=()=> <main><Content/><Other/></main>',
    [q]: `export const Content=()=> ${debt}`,
    [`${root}other.tsx`]: 'export const Other=()=> <aside/>',
  }
  expect((await compare(before, after)).flagged).toBe(true)
  expect((await compare(before, { [q]: `export const Screen=()=> ${debt}` })).flagged).toBe(true)
})
test('Git paired rename and a unique imported React wrapper surface renamed debt with owner multiplicity', async () => {
  const old = `import {memo as cache} from 'react';import {Button} from '@sim/emcn';export const Before=cache(function Before(){return <><Button className="size-6"/><Button className="size-6"/></>});const Helper=()=> <div className="font-bold"/>`
  const next = old.replaceAll('Before', 'After')
  expect((await compare({ [p]: old }, { [q]: next }, {}, [p, q])).flagged).toBe(true)
  expect(
    (
      await compare(
        { [p]: old },
        { [q]: next.replace('</>', '<Button className="size-6"/></>') },
        {},
        [p, q]
      )
    ).findings
  ).toHaveLength(4)
  expect(
    (await compare({ [p]: old }, { [q]: next.replace('size-6', 'size-7') }, {}, [p, q])).flagged
  ).toBe(true)
  expect((await compare({ [p]: old }, { [q]: next })).flagged).toBe(true)
  expect(
    (
      await compare(
        { [p]: old.replace("'react'", "'unknown'") },
        { [q]: next.replace("'react'", "'unknown'") },
        {},
        [p, q]
      )
    ).flagged
  ).toBe(true)
})

test('inserting a nested central helper does not relocate the existing owner chrome', async () => {
  const parent = 'packages/emcn/src/components/frame/frame.tsx'
  const helper = 'packages/emcn/src/components/frame/helper.tsx'
  const before = {
    [parent]:
      'export const Frame=()=> <div className="rounded-lg"><button className="text-small">Pick</button></div>',
  }
  const inserted = {
    [parent]:
      'import {Helper} from "./helper";export const Frame=()=> <div className="rounded-lg"><button className="text-small">Pick</button><Helper/></div>',
    [helper]: 'export const Helper=()=> <span/>',
  }
  expect((await compare(before, inserted)).findings).toHaveLength(0)
  const styled = { ...inserted, [helper]: 'export const Helper=()=> <span className="font-bold"/>' }
  const added = await compare(before, styled)
  expect(added.findings.length).toBeGreaterThan(0)
  expect(
    added.findings.every((finding) => finding.file === helper && finding.kind === 'system-change')
  ).toBe(true)
  const changed = await compare(before, {
    ...styled,
    [parent]: inserted[parent].replace('rounded-lg', 'rounded-full'),
  })
  expect(
    changed.findings.some(
      (finding) => finding.file === parent && finding.property === 'border-radius'
    )
  ).toBe(true)
  expect(changed.findings.some((finding) => finding.file === helper)).toBe(true)
})
