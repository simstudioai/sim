/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetInternalApiBaseUrl } = vi.hoisted(() => ({
  mockGetInternalApiBaseUrl: vi.fn(),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getInternalApiBaseUrl: mockGetInternalApiBaseUrl,
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn().mockResolvedValue('token'),
}))

import { internalApiUrl } from '@/executor/utils/http'

describe('internalApiUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetInternalApiBaseUrl.mockReturnValue('http://internal.sim.local')
  })

  it('resolves an internal route against the internal base URL', () => {
    const url = internalApiUrl`/api/workflows/${'wf-1'}`

    expect(url.toString()).toBe('http://internal.sim.local/api/workflows/wf-1')
  })

  it('encodes an interpolated id so it cannot widen the path', () => {
    const url = internalApiUrl`/api/table/${'../../admin/secrets'}/rows`

    expect(url.pathname).toBe('/api/table/..%2F..%2Fadmin%2Fsecrets/rows')
  })

  it('encodes a query-shaped id rather than letting it add params', () => {
    const url = internalApiUrl`/api/table/${'t-1?workspaceId=other'}`

    expect(url.searchParams.get('workspaceId')).toBeNull()
    expect(url.pathname).toBe('/api/table/t-1%3FworkspaceId%3Dother')
  })

  it('rejects a route that is not an internal API path', () => {
    expect(() => internalApiUrl`/health`).toThrow(/must start with \/api\//)
  })

  it('rejects an interpolated absolute URL, which would escape the internal base', () => {
    expect(() => internalApiUrl`${'https://attacker.example/api/x'}`).toThrow(
      /must start with \/api\//
    )
  })
})
