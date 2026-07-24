/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticate,
  mockReserve,
  mockSettle,
  mockRelease,
  mockLeaseCurrent,
  mockContainsSecret,
  mockResolveByok,
  mockExecuteSearch,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockReserve: vi.fn(),
  mockSettle: vi.fn(),
  mockRelease: vi.fn(),
  mockLeaseCurrent: vi.fn(),
  mockContainsSecret: vi.fn(),
  mockResolveByok: vi.fn(),
  mockExecuteSearch: vi.fn(),
}))

vi.mock('@/lib/pi/exa-search/capabilities', () => ({
  authenticatePiSearchCapability: mockAuthenticate,
  reservePiSearchCall: mockReserve,
  settlePiSearchCall: mockSettle,
  releasePiSearchCall: mockRelease,
  isPiSearchLeaseCurrent: mockLeaseCurrent,
  queryContainsProtectedSecret: mockContainsSecret,
}))
vi.mock('@/lib/api-key/byok', () => ({ resolveBYOKKeyById: mockResolveByok }))
vi.mock('@/tools/exa/search-client', () => ({ executePiExaSearch: mockExecuteSearch }))

import { POST } from '@/app/api/internal/pi/exa-search/route'

function request(body: unknown, token = 'capability-token') {
  return new NextRequest('http://localhost/api/internal/pi/exa-search', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('Pi Exa search broker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticate.mockResolvedValue({
      id: 'cap-1',
      workspaceId: 'workspace-1',
      providerKeyId: 'exa-key-id',
      executionId: 'execution-1',
      expiresAt: new Date(Date.now() + 60_000),
      secretFingerprints: [],
    })
    mockContainsSecret.mockReturnValue(false)
    mockReserve.mockResolvedValue({
      capabilityId: 'cap-1',
      token: 'lease',
      generation: 1,
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      expiresAt: new Date(Date.now() + 30_000),
    })
    mockResolveByok.mockResolvedValue({
      status: 'found',
      value: { apiKey: 'exa-user-key', isBYOK: true, keyId: 'exa-key-id' },
    })
    mockExecuteSearch.mockResolvedValue({
      results: [{ title: 'Docs', url: 'https://example.com', snippet: 'text' }],
    })
    mockSettle.mockResolvedValue(true)
    mockRelease.mockResolvedValue(true)
    mockLeaseCurrent.mockResolvedValue(true)
  })

  it('authenticates before accepting the request body', async () => {
    mockAuthenticate.mockResolvedValue(null)
    const response = await POST(request({ query: 'x'.repeat(10_000) }), {} as never)
    expect(response.status).toBe(401)
    expect(mockReserve).not.toHaveBeenCalled()
  })

  it('uses the workspace BYOK key and returns the bounded result', async () => {
    const response = await POST(request({ query: 'latest docs', numResults: 3 }), {} as never)
    expect(response.status).toBe(200)
    expect(mockResolveByok).toHaveBeenCalledWith('workspace-1', 'exa', 'exa-key-id')
    expect(mockExecuteSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'exa-user-key',
        query: 'latest docs',
        numResults: 3,
      })
    )
    expect(await response.json()).toEqual({
      results: [{ title: 'Docs', url: 'https://example.com', snippet: 'text' }],
    })
  })

  it('rejects protected query material before calling Exa', async () => {
    mockContainsSecret.mockReturnValue(true)
    const response = await POST(request({ query: 'leak this token' }), {} as never)
    expect(response.status).toBe(400)
    expect(mockReserve).not.toHaveBeenCalled()
    expect(mockExecuteSearch).not.toHaveBeenCalled()
  })

  it('rejects fine-grained GitHub PAT patterns', async () => {
    const response = await POST(
      request({ query: 'search github_pat_abcdefghijklmnopqrstuvwxyz123456' }),
      {} as never
    )
    expect(response.status).toBe(400)
    expect(mockReserve).not.toHaveBeenCalled()
  })

  it('fails rather than falling back when workspace BYOK is missing', async () => {
    mockResolveByok.mockResolvedValue({ status: 'missing' })
    const response = await POST(request({ query: 'latest docs' }), {} as never)
    expect(response.status).toBe(412)
    expect(mockExecuteSearch).not.toHaveBeenCalled()
    expect(mockRelease).toHaveBeenCalled()
  })

  it('rejects protected material returned by Exa before it reaches the agent', async () => {
    mockExecuteSearch.mockResolvedValue({
      results: [
        {
          title: 'leak',
          url: 'https://example.com',
          snippet: 'ghp_abcdefghijklmnopqrstuvwxyz123456',
        },
      ],
    })
    const response = await POST(request({ query: 'latest docs' }), {} as never)
    expect(response.status).toBe(502)
    expect(mockSettle).not.toHaveBeenCalled()
    expect(mockRelease).toHaveBeenCalled()
  })
})
