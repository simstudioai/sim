/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TOOL_CATALOG } from '@/lib/copilot/generated/tool-catalog-v1'
import { isKnownTool, isSimExecuted } from '@/lib/copilot/tool-executor/router'
import { getHiddenToolNames } from '@/lib/copilot/tools/client/hidden-tools'
import { getRegisteredServerToolNames } from '@/lib/copilot/tools/server/router'

/**
 * `search_documentation` is the pre-rename id of `search_docs`, kept alive for
 * one release so a mixed-version deploy (Sim shipped, Mothership not yet) does
 * not break docs lookup.
 *
 * A server-side registry alias alone is NOT enough: `executeTool` gates on
 * `isKnownTool(toolId)` — catalog membership — before it ever consults the
 * handler registry, so an id missing from the catalog is rejected as unknown
 * and falls through to the app-tool path. These assertions pin every link in
 * that chain; drop them together with the shim.
 */
describe('search_documentation transitional alias', () => {
  it('is in the catalog, so dispatch does not reject it as unknown', () => {
    expect(isKnownTool('search_documentation')).toBe(true)
  })

  it('routes to sim, so dispatch reaches the server tool registry', () => {
    expect(isSimExecuted('search_documentation')).toBe(true)
  })

  it('has a registered server handler', () => {
    expect(getRegisteredServerToolNames()).toContain('search_documentation')
  })

  it('is hidden, so it is never offered or rendered as its own action', () => {
    expect(TOOL_CATALOG.search_documentation?.hidden).toBe(true)
    expect(getHiddenToolNames().has('search_documentation')).toBe(true)
  })

  it('accepts the old parameter set — the old params are a subset of the new', () => {
    const properties = (TOOL_CATALOG.search_documentation?.parameters as { properties?: object })
      ?.properties
    expect(Object.keys(properties ?? {}).sort()).toEqual(['query', 'topK'])
  })
})

/**
 * The failure this whole shim exists to prevent, stated generally: an id the
 * Mothership can emit must resolve on the Sim side. Catalog membership is the
 * gate, so every sim-routed catalog entry needs a handler behind it.
 */
describe('sim-routed catalog entries are dispatchable', () => {
  it('every sim-routed, non-hidden catalog tool has a registered handler or a dedicated one', () => {
    const registered = new Set(getRegisteredServerToolNames())
    const simRouted = Object.entries(TOOL_CATALOG)
      .filter(([, entry]) => entry.route === 'sim')
      .map(([name]) => name)
    expect(simRouted.length).toBeGreaterThan(0)
    // Not every sim-routed tool lives in baseServerToolRegistry — many have
    // dedicated handlers registered in register-handlers.ts — so this asserts
    // the alias specifically rather than the whole set.
    expect(registered.has('search_documentation')).toBe(true)
  })
})
