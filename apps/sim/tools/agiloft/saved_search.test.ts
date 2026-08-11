/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { agiloftSavedSearchTool } from '@/tools/agiloft/saved_search'
import toolIds from '@/tools/generated/tool-ids'

describe('retired agiloft_saved_search', () => {
  it('keeps its id registered so workflows saved with that operation still resolve a tool', () => {
    expect(toolIds).toContain('agiloft_saved_search')
    expect(agiloftSavedSearchTool.id).toBe('agiloft_saved_search')
  })

  it('fails with a migration hint instead of calling an undocumented endpoint', async () => {
    const result = await agiloftSavedSearchTool.directExecution?.({})

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('Search Records')
  })
})
