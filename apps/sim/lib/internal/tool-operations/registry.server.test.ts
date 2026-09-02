/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getInternalToolOperationHandler,
  getRegisteredInternalToolOperationIds,
  isInternalToolOperationRegistered,
} from '@/lib/internal/tool-operations/registry.server'
import { getToolIds } from '@/tools/tool-ids'

/**
 * Registration is checked against the generated tool ids rather than the
 * executable registry, whose import costs more than every handler load below
 * combined. The converse — that every operation-backed tool in the registry has
 * a handler here — is the in-process half of the transport partition sweep in
 * `tools/request-transport.test.ts`, which already pays for that registry.
 */
describe('internal tool operation registry', () => {
  it('registers only canonical internal tool definitions with loadable handlers', async () => {
    const registeredIds = getRegisteredInternalToolOperationIds()
    const canonicalIds = new Set(getToolIds())

    expect(new Set(registeredIds).size).toBe(registeredIds.length)

    for (const toolId of registeredIds) {
      expect(canonicalIds.has(toolId), `Missing canonical tool definition for ${toolId}`).toBe(true)
    }
    const handlers = await Promise.all(registeredIds.map(getInternalToolOperationHandler))
    for (const [index, handler] of handlers.entries()) {
      expect(handler, `${registeredIds[index]} has no loadable handler`).toBeTypeOf('function')
    }
    // Cost scales with the number of registered internal tools, so this budget has to grow
    // with the registry rather than sit just above the current total.
  }, 90_000)

  it('loads dynamic MCP operations without an HTTP route', async () => {
    expect(isInternalToolOperationRegistered('mcp-server-id-tool-name')).toBe(true)
    expect(await getInternalToolOperationHandler('mcp-server-id-tool-name')).toBeTypeOf('function')
  })
})
