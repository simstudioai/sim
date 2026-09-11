import { expect, it } from 'vitest'
import { analyze, emptyReport } from '#design-diff/analyze'
import { previewValue, REPORT_BYTES, serializeReport } from '#design-diff/report'
import { compareFiles, config, FixtureRepo } from '#design-diff/tests/helpers'
import type { Data } from '#design-diff/types'

it('preserves small literal values and hashes changes beyond the retained preview', () => {
  expect(previewValue('red')).toBe('red')
  const a = previewValue(`${'x'.repeat(10000)}a`)
  const b = previewValue(`${'x'.repeat(10000)}b`)
  expect(a).toMatchObject({ $truncated: true, originalBytes: 10003, previewBytes: 4096 })
  expect(a).not.toEqual(b)
  expect(JSON.stringify(a)).not.toContain('x'.repeat(5000))
})

it('detects changes after a preview and produces byte-identical bounded reports', async () => {
  const file = 'apps/sim/page.tsx'
  const source = (ending: string) =>
    `export const Page=()=> <p style={{fontFamily:"${'x'.repeat(9000)}${ending}"}}/>`
  const report = await compareFiles(
    { [file]: source('a') },
    { [file]: source('b') },
    { ...config, themes: [] }
  )
  expect(report.flagged).toBe(true)
  const serialized = serializeReport(report)
  expect(serializeReport(report)).toBe(serialized)
  expect(Buffer.byteLength(serialized)).toBeLessThan(REPORT_BYTES)
  const finding = report.findings[0]
  const large = {
    ...report,
    findings: Array.from({ length: 1000 }, (_, index) => ({ ...finding, id: String(index) })),
  }
  const bounded = serializeReport(large, 64 * 1024)
  expect(Buffer.byteLength(bounded)).toBeLessThanOrEqual(64 * 1024)
  expect(serializeReport(large, 64 * 1024)).toBe(bounded)
  expect(JSON.parse(bounded)).toMatchObject({ flagged: true, truncation: { findingsTotal: 1000 } })
  expect(JSON.parse(bounded).truncation.omittedFindings).toBeGreaterThan(0)
})

it('keeps failures distinguishable after serialization', () => {
  expect(JSON.parse(serializeReport(emptyReport()))).toMatchObject({
    schemaVersion: '3.0.0',
    engineVersion: '0.5.2',
    policyVersion: '5.0.0',
    status: 'failed',
    flagged: null,
  })
})

it('repeats the analysis itself byte-identically with shortened values and sampled findings', async () => {
  const repo = new FixtureRepo()
  try {
    const source = (ending: string) =>
      `export const Page=()=> <p style={{fontFamily:"${'x'.repeat(9000)}${ending}"}}/>`
    const base = repo.commit({ 'apps/sim/page.tsx': source('a') })
    const head = repo.commit({ 'apps/sim/page.tsx': source('b') })
    const first = serializeReport(
      await analyze(repo.cwd, base, head, { ...config, themes: [] }),
      8192
    )
    const second = serializeReport(
      await analyze(repo.cwd, base, head, { ...config, themes: [] }),
      8192
    )
    expect(first).toBe(second)
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(8192)
    expect(JSON.parse(first).flagged).toBe(true)
  } finally {
    repo.close()
  }
})

it('hashes a large shared symbolic tree without expanding its repeated JSON', () => {
  let value: Data = 'x'.repeat(1024)
  for (let level = 0; level < 30; level++) value = [value, value]
  const first = previewValue(value)
  expect(first).toMatchObject({ $truncated: true, hashAlgorithm: 'sha256-merkle-v1' })
  expect(JSON.stringify(first).length).toBeLessThan(6000)
  expect(previewValue(value)).toEqual(first)
  expect(previewValue(first)).toBe(first)
  expect(previewValue([value, 'changed'])).not.toEqual(previewValue([value, 'original']))
})

it('gives shared and independently constructed equivalent trees the same full identity', () => {
  const part = { copy: 'x'.repeat(5000), styles: ['red', 'p-2'] }
  const shared = [part, part]
  expect(previewValue(shared)).toEqual(previewValue(JSON.parse(JSON.stringify(shared))))
  expect(previewValue([part, 'a', 'b'])).not.toEqual(previewValue([part, 'b', 'a']))
})
