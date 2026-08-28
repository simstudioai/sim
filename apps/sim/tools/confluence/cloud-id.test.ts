/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as confluenceTools from '@/tools/confluence'

const toolEntries = Object.values(confluenceTools).map((tool) => [tool.id, tool] as const)

describe('Confluence cloudId', () => {
  it('covers every Confluence tool', () => {
    expect(toolEntries.length).toBeGreaterThanOrEqual(46)
  })

  it.each(toolEntries)('%s resolves cloudId instead of asking the user for it', (_id, tool) => {
    expect(tool.params.cloudId?.visibility).toBe('hidden')
  })

  it.each(toolEntries)('%s keeps domain user-settable', (_id, tool) => {
    expect(tool.params.domain?.visibility).toBe('user-only')
  })
})
