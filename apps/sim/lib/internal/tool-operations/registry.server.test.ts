/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  getInternalToolOperationHandler,
  getRegisteredInternalToolOperationIds,
  isInternalToolOperationRegistered,
} from '@/lib/internal/tool-operations/registry.server'
import { tools } from '@/tools/registry'
import { getToolIds } from '@/tools/tool-ids'
import { isInternalToolConfig } from '@/tools/types'

vi.unmock('@/tools/registry')

describe('internal tool operation registry', () => {
  it('registers only canonical internal tool definitions with loadable handlers', async () => {
    const registeredIds = getRegisteredInternalToolOperationIds()
    const canonicalIds = new Set(getToolIds())

    expect(new Set(registeredIds).size).toBe(registeredIds.length)

    for (const toolId of registeredIds) {
      expect(canonicalIds.has(toolId), `Missing canonical tool definition for ${toolId}`).toBe(true)
      expect(await getInternalToolOperationHandler(toolId)).toBeTypeOf('function')
    }
    // Cost scales with the number of registered internal tools, so this budget has to grow
    // with the registry rather than sit just above the current total.
  }, 90_000)

  it('registers every operation-backed tool and keeps it free of HTTP request metadata', async () => {
    const operationTools = Object.entries(tools).filter(([, tool]) => isInternalToolConfig(tool))

    expect(operationTools.length).toBeGreaterThan(0)
    for (const [toolId, tool] of operationTools) {
      expect(tool.request, `${toolId} must not declare an HTTP request`).toBeUndefined()
      expect(tool.operation.input, `${toolId} must materialize its operation input`).toBeTypeOf(
        'function'
      )
      if (toolId === 'function_execute' || toolId === 'workflow_executor') continue
      expect(
        isInternalToolOperationRegistered(toolId),
        `${toolId} is missing its in-process operation handler`
      ).toBe(true)
    }
  })

  it('loads dynamic MCP operations without an HTTP route', async () => {
    expect(isInternalToolOperationRegistered('mcp-server-id-tool-name')).toBe(true)
    expect(await getInternalToolOperationHandler('mcp-server-id-tool-name')).toBeTypeOf('function')
  })
})
