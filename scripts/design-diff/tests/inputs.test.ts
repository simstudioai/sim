import { expect, it } from 'vitest'
import { allChanges, compareFiles, config, type Files } from '#design-diff/tests/helpers'

const list = 'apps/docs/lib/openapi-specs.ts'
const renderer = 'apps/docs/lib/openapi.ts'
const spec = 'apps/docs/openapi.json'
const files = {
  [list]: 'export const OPENAPI_SPEC_FILES=["openapi.json"] as const',
  [renderer]: 'export const renderer = 1',
  [spec]: '{"description":"First","enum":["a","b"]}',
}

it('flags file-loaded documentation with spec and renderer attribution', async () => {
  const report = await compareFiles(files, { [spec]: '{"description":"Second","enum":["a","b"]}' })
  expect(report.flagged).toBe(true)
  expect(report.findings[0].source.after?.file).toBe(spec)
  expect(allChanges(report)[0].dependencies).toContain(renderer)
})

it('ignores JSON formatting and key order, but preserves array order', async () => {
  expect(
    (await compareFiles(files, { [spec]: '{ "enum": ["a", "b"], "description": "First" }' }))
      .flagged
  ).toBe(false)
  expect(
    (await compareFiles(files, { [spec]: '{"description":"First","enum":["b","a"]}' })).flagged
  ).toBe(true)
})

it.each<Files>([
  { [spec]: 'broken' },
  { [spec]: null },
  { [list]: 'export const OPENAPI_SPEC_FILES=load()' },
  { [renderer]: null },
])('flags unresolved configured input %j', async (change) => {
  const report = await compareFiles(files, change, config)
  expect(report.flagged).toBe(true)
  expect(allChanges(report).some((change) => change.limitations.length)).toBe(true)
})

it('retains JSON keys whose names resemble erased AST fields', async () => {
  const report = await compareFiles(
    { ...files, [spec]: '{"properties":{"start":{"description":"First"},"end":{}}}' },
    { [spec]: '{"properties":{"start":{"description":"Second"},"end":{}}}' }
  )
  expect(report.flagged).toBe(true)
})
