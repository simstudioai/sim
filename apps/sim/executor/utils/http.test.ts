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

import { buildInternalApiUrl } from '@/executor/utils/http'

describe('buildInternalApiUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetInternalApiBaseUrl.mockReturnValue('http://internal.sim.local')
  })

  it('resolves an internal path against the internal base URL', () => {
    const url = buildInternalApiUrl('/api/workflows/wf-1')

    expect(url.toString()).toBe('http://internal.sim.local/api/workflows/wf-1')
  })

  it('appends query params', () => {
    const url = buildInternalApiUrl('/api/table/t-1', { workspaceId: 'ws-1' })

    expect(url.searchParams.get('workspaceId')).toBe('ws-1')
  })

  it('rejects a path that is not an internal API route', () => {
    expect(() => buildInternalApiUrl('/health')).toThrow(/must start with \/api\//)
  })

  it('rejects an absolute URL, which would escape the internal base', () => {
    expect(() => buildInternalApiUrl('https://attacker.example/api/x')).toThrow(
      /must start with \/api\//
    )
  })

  it('keeps a traversal-shaped id inside its own path segment when encoded by the caller', () => {
    const id = '../../admin/secrets'
    const url = buildInternalApiUrl(`/api/table/${encodeURIComponent(id)}`)

    expect(url.pathname).toBe('/api/table/..%2F..%2Fadmin%2Fsecrets')
  })
})
