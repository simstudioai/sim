/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({
  mockFetchWithRetry: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: { maxRetries: 0 },
}))

import { linearConnector } from '@/connectors/linear/linear'

describe('linearConnector authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchWithRetry.mockResolvedValue(
      new Response(JSON.stringify({ data: { teams: { nodes: [{ id: 'team-1' }] } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  })

  it.each([
    ['personal API key', 'lin_api_example', 'lin_api_example'],
    ['OAuth access token', 'opaque-oauth-token', 'Bearer opaque-oauth-token'],
  ])('sends a %s with the documented authorization shape', async (_kind, token, expected) => {
    await expect(linearConnector.validateConfig(token, {})).resolves.toEqual({ valid: true })

    const request = mockFetchWithRetry.mock.calls[0]?.[1] as RequestInit | undefined
    expect(new Headers(request?.headers).get('Authorization')).toBe(expected)
  })
})
