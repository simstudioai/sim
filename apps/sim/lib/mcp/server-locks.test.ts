/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isWorkflowMcpServerLockTimeout } from '@/lib/mcp/server-locks'

describe('MCP server locks', () => {
  it('detects Postgres lock timeout errors', () => {
    const error = Object.assign(new Error('canceling statement due to lock timeout'), {
      code: '55P03',
    })

    expect(isWorkflowMcpServerLockTimeout(error)).toBe(true)
  })
})
