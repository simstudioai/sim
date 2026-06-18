/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveActiveShareByToken } = vi.hoisted(() => ({
  mockResolveActiveShareByToken: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveShareByToken: mockResolveActiveShareByToken,
}))

import { GET } from '@/app/api/files/public/[token]/route'

const params = (token = 'tok_1') => ({ params: Promise.resolve({ token }) })
const request = (token = 'tok_1') => new NextRequest(`http://localhost/api/files/public/${token}`)

describe('GET /api/files/public/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 for an unknown or inactive token', async () => {
    mockResolveActiveShareByToken.mockResolvedValueOnce(null)
    const res = await GET(request(), params())
    expect(res.status).toBe(404)
  })

  it('returns public-safe metadata (name/type/size + provenance) without leaking the key or workspace id', async () => {
    mockResolveActiveShareByToken.mockResolvedValueOnce({
      share: { id: 'sh_1', token: 'tok_1' },
      file: {
        id: 'wf_1',
        key: 'workspace/ws/secret-key.pdf',
        workspaceId: 'ws-secret',
        originalName: 'report.pdf',
        contentType: 'application/pdf',
        size: 2048,
      },
      workspaceName: 'Acme Workspace',
      ownerName: 'Jane Doe',
    })
    const res = await GET(request(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      token: 'tok_1',
      name: 'report.pdf',
      type: 'application/pdf',
      size: 2048,
      workspaceName: 'Acme Workspace',
      ownerName: 'Jane Doe',
    })
    expect(JSON.stringify(body)).not.toContain('secret-key')
    expect(JSON.stringify(body)).not.toContain('ws-secret')
  })
})
