import { describe, expect, it } from 'vitest'
import { isPathInSchema } from '@/executor/utils/block-reference'
import { getConsentTool } from '@/tools/ketch/get_consent'
import { mapTool } from '@/tools/tavily/map'
import type { ToolConfig } from '@/tools/types'

/** References that validated against the production output schemas must keep validating. */
const SAVED_REFERENCES: Array<[string, ToolConfig['outputs'], string[]]> = [
  ['Tavily Map', mapTool.outputs, ['results[0]', 'url']],
  ['Tavily Map', mapTool.outputs, ['results', '0', 'url']],
  ['Ketch Get Consent', getConsentTool.outputs, ['vendors', 'someVendor']],
  ['Ketch Get Consent', getConsentTool.outputs, ['vendors', 'someVendor', 'status']],
]

describe('saved references into reshaped tool outputs', () => {
  it.each(SAVED_REFERENCES)('%s still accepts %j', (_name, outputs, path) => {
    expect(isPathInSchema(outputs, path)).toBe(true)
  })
})
