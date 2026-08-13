/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/tools/registry')

import * as netsuiteExports from '@/tools/netsuite'
import { tools } from '@/tools/registry'
import type { ToolConfig } from '@/tools/types'

function isNetSuiteTool(value: unknown): value is ToolConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.startsWith('netsuite_')
  )
}

describe('NetSuite registry', () => {
  it('registers every NetSuite operation with the exported implementation', () => {
    const exportedTools = Object.values(netsuiteExports).filter(isNetSuiteTool)
    expect(exportedTools).toHaveLength(27)
    for (const tool of exportedTools) {
      expect(tools[tool.id], tool.id).toBe(tool)
    }
  })
})
