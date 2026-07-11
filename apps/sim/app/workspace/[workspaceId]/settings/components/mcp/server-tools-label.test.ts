import { describe, expect, it } from 'vitest'
import { getServerToolsLabel } from './server-tools-label'

describe('getServerToolsLabel', () => {
  it('shows the persisted server error for errored connections', () => {
    expect(getServerToolsLabel([], 'error', 'MCP error -32001: Request timed out')).toBe(
      'MCP error -32001: Request timed out'
    )
  })

  it('falls back when an errored connection has no persisted error', () => {
    expect(getServerToolsLabel([], 'error', null)).toBe('Unable to connect')
  })

  it('continues showing discovered tools for healthy connections', () => {
    expect(getServerToolsLabel([{ name: 'search' }], 'connected', null)).toBe('1 tool: search')
  })
})
