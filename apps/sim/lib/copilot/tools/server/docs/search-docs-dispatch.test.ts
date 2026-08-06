/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TOOL_CATALOG } from '@/lib/copilot/generated/tool-catalog-v1'
import { isKnownTool, isSimExecuted } from '@/lib/copilot/tool-executor/router'
import { getHiddenToolNames } from '@/lib/copilot/tools/client/hidden-tools'
import { getRegisteredServerToolNames } from '@/lib/copilot/tools/server/router'

/**
 * `executeTool` gates on `isKnownTool` (catalog membership) before it ever
 * consults the handler registry, so a sim-routed tool needs every link of this
 * chain or dispatch rejects it before the handler is reached. These assertions
 * pin that chain for search_docs.
 */
describe('search_docs dispatch chain', () => {
  it('is in the catalog, so dispatch does not reject it as unknown', () => {
    expect(isKnownTool('search_docs')).toBe(true)
  })

  it('routes to sim, so dispatch reaches the server tool registry', () => {
    expect(isSimExecuted('search_docs')).toBe(true)
  })

  it('has a registered server handler', () => {
    expect(getRegisteredServerToolNames()).toContain('search_docs')
  })
})

describe('removed docs-tool ids', () => {
  for (const removed of ['search_documentation', 'get_platform_actions']) {
    it(`${removed} is absent from the catalog, registries, and hidden-tool set`, () => {
      expect(TOOL_CATALOG[removed]).toBeUndefined()
      expect(isKnownTool(removed)).toBe(false)
      expect(getRegisteredServerToolNames()).not.toContain(removed)
      expect(getHiddenToolNames().has(removed)).toBe(false)
    })
  }
})
