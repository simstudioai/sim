import { describe, expect, it } from 'vitest'
import { type McpQueryReadiness, resolveMcpReadinessState } from './mcp-readiness-state'

const readyState = {
  serversSuccess: true,
  serversError: false,
  serversPlaceholder: false,
  allowedDomainsSuccess: true,
  allowedDomainsError: false,
  allowedDomainsPlaceholder: false,
} satisfies McpQueryReadiness

describe('resolveMcpReadinessState', () => {
  it('requires both successful non-placeholder queries', () => {
    expect(resolveMcpReadinessState({ ...readyState, serversSuccess: false })).toBe('loading')
    expect(resolveMcpReadinessState({ ...readyState, serversPlaceholder: true })).toBe('loading')
    expect(resolveMcpReadinessState({ ...readyState, allowedDomainsSuccess: false })).toBe(
      'loading'
    )
    expect(resolveMcpReadinessState({ ...readyState, allowedDomainsPlaceholder: true })).toBe(
      'loading'
    )
  })

  it('gives either query error priority over stale data', () => {
    expect(
      resolveMcpReadinessState({
        ...readyState,
        serversSuccess: false,
        serversPlaceholder: true,
        allowedDomainsError: true,
      })
    ).toBe('error')
  })

  it('reports ready only when both boundaries are usable', () => {
    expect(resolveMcpReadinessState(readyState)).toBe('ready')
  })
})
