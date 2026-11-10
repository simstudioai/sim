import { describe, expect, it, vi } from 'vitest'
import {
  AWS_CREDENTIAL_OPERATION_TOOL_IDS,
  getInternalToolOperationHandler,
  getRegisteredInternalToolOperationIds,
  isInternalToolOperationRegistered,
} from '@/lib/internal/tool-operations/registry.server'
import { getToolMetadata } from '@/tools/metadata'
import { AWS_SESSION_SIGNED_TOOL_IDS } from '@/tools/shared/saved-credentials'
import { getToolIds } from '@/tools/tool-ids'

// The AWS routing check reads real tool policies.
vi.unmock('@/tools/metadata')

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

  /**
   * A tool that authorizes saved AWS credentials but neither runs in a wrapped
   * family nor signs with the session token would receive no keys and fail at
   * run time with AWS's signature error.
   */
  it('routes every AWS-credential tool through a path that resolves the credential', () => {
    const awsTools = getToolIds().filter(
      (toolId) => getToolMetadata(toolId)?.oauth?.provider === 'aws'
    )

    expect(awsTools.length).toBeGreaterThan(0)
    for (const toolId of awsTools) {
      expect(
        AWS_CREDENTIAL_OPERATION_TOOL_IDS.has(toolId) || AWS_SESSION_SIGNED_TOOL_IDS.has(toolId),
        toolId
      ).toBe(true)
    }
    for (const toolId of AWS_SESSION_SIGNED_TOOL_IDS) {
      expect(isInternalToolOperationRegistered(toolId), toolId).toBe(false)
    }
  })
})
