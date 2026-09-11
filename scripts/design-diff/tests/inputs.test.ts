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

it('exempts valid file-loaded API documentation content', async () => {
  const report = await compareFiles(files, { [spec]: '{"description":"Second","enum":["a","b"]}' })
  expect(report.flagged).toBe(false)
  expect(report.findings).toEqual([])
})

it('exempts formatting and semantic API-reference data edits', async () => {
  expect(
    (await compareFiles(files, { [spec]: '{ "enum": ["a", "b"], "description": "First" }' }))
      .flagged
  ).toBe(false)
  expect(
    (await compareFiles(files, { [spec]: '{"description":"First","enum":["b","a"]}' })).flagged
  ).toBe(false)
})

it.each<Files>([
  { [spec]: 'broken' },
  { [spec]: null },
  { [list]: 'export const OPENAPI_SPEC_FILES=load()' },
  { [renderer]: null },
])('records unresolved configured inputs without designer notifications: %j', async (change) => {
  const report = await compareFiles(files, change, config)
  expect(report.flagged).toBe(false)
  expect(allChanges(report).some((change) => change.limitations.length)).toBe(true)
})

it('exempts file-loaded copy even without the documentation content setting', async () => {
  const report = await compareFiles(
    { ...files, [spec]: '{"properties":{"start":{"description":"First"},"end":{}}}' },
    { [spec]: '{"properties":{"start":{"description":"Second"},"end":{}}}' },
    { ...config, fileInputs: config.fileInputs?.map((input) => ({ ...input, contentOnly: false })) }
  )
  expect(report.flagged).toBe(false)
})
