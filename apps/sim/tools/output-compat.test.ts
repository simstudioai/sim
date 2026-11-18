import { describe, expect, it } from 'vitest'
import { isPathInSchema } from '@/executor/utils/block-reference'
import { getConsentTool } from '@/tools/ketch/get_consent'
import { mapTool } from '@/tools/tavily/map'
import type { ToolConfig } from '@/tools/types'

/** References that validated against the production output schemas must keep validating. */
const SAVED_REFERENCES: Array<[string, string[], ToolConfig['outputs']]> = [
  ['Tavily Map', ['results[0]', 'url'], mapTool.outputs],
  ['Tavily Map', ['results', '0', 'url'], mapTool.outputs],
  ['Ketch Get Consent', ['vendors', 'someVendor'], getConsentTool.outputs],
  ['Ketch Get Consent', ['vendors', 'someVendor', 'status'], getConsentTool.outputs],
]

describe('saved references into reshaped tool outputs', () => {
  it.each(SAVED_REFERENCES)('%s still accepts %j', (_name, path, outputs) => {
    expect(isPathInSchema(outputs, path)).toBe(true)
  })
})
