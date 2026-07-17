import { describe, expect, it } from 'vitest'
import { getServerToolsLabel } from '@/app/workspace/[workspaceId]/settings/components/mcp/server-tools-label'

describe('getServerToolsLabel', () => {
  it('shows the persisted server error for errored connections', () => {
    expect(getServerToolsLabel([], 'error', 'MCP error -32001: Request timed out')).toBe(
      'MCP error -32001: Request timed out'
    )
  })

  it('falls back when an errored connection has no persisted error', () => {
    expect(getServerToolsLabel([], 'error', null)).toBe('Unable to connect')
  })

  it('shows a disconnected state when OAuth was not completed', () => {
    expect(getServerToolsLabel([], 'disconnected', null)).toBe('Not Connected')
  })

  it('shows the persisted error for disconnected connections', () => {
    expect(getServerToolsLabel([], 'disconnected', 'Request timed out')).toBe('Request timed out')
  })

  it('continues showing discovered tools for healthy connections', () => {
    expect(getServerToolsLabel([{ name: 'search' }], 'connected', null)).toBe('1 tool: search')
  })
})
