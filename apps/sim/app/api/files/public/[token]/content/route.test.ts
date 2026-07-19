/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveActiveShareByToken,
  mockEnforcePerIp,
  mockEnforcePerShare,
  mockValidateDeploymentAuth,
  mockDownloadFile,
  mockResolveServableDoc,
} = vi.hoisted(() => ({
  mockResolveActiveShareByToken: vi.fn(),
  mockEnforcePerIp: vi.fn(),
  mockEnforcePerShare: vi.fn(),
  mockValidateDeploymentAuth: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockResolveServableDoc: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveShareByToken: mockResolveActiveShareByToken,
}))

vi.mock('@/lib/public-shares/rate-limit', () => ({
  enforcePerIpRateLimit: mockEnforcePerIp,
  enforcePerShareRateLimit: mockEnforcePerShare,
}))

vi.mock('@/lib/core/security/deployment-auth', () => ({
  validateDeploymentAuth: mockValidateDeploymentAuth,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
}))

vi.mock('@/lib/copilot/tools/server/files/doc-compile', () => ({
  resolveServableDoc: mockResolveServableDoc,
}))

import { NextResponse } from 'next/server'
import { GET } from '@/app/api/files/public/[token]/content/route'

const params = (token = 'tok_1') => ({ params: Promise.resolve({ token }) })
const request = (token = 'tok_1') =>
  new NextRequest(`http://localhost/api/files/public/${token}/content`)

const passwordShare = {
  share: { id: 'sh_1', token: 'tok_1', authType: 'password', password: 'enc:secret' },
  file: {
    id: 'wf_1',
    key: 'workspace/ws/secret-key.pdf',
    workspaceId: 'ws-1',
    originalName: 'report.pdf',
    contentType: 'application/pdf',
    size: 4,
  },
  workspaceName: 'Acme',
  ownerName: 'Jane',
}

describe('GET /api/files/public/[token]/content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforcePerIp.mockResolvedValue(null)
    mockEnforcePerShare.mockResolvedValue(null)
    mockResolveActiveShareByToken.mockResolvedValue(passwordShare)
    mockDownloadFile.mockResolvedValue(Buffer.from('data'))
    mockResolveServableDoc.mockResolvedValue({ kind: 'passthrough' })
  })

  it('returns 401 and never reads storage when a password share is unauthorized', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({
      authorized: false,
      error: 'auth_required_password',
    })
    const res = await GET(request(), params())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('auth_required_password')
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('serves the bytes once authorized', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({ authorized: true })
    const res = await GET(request(), params())
    expect(res.status).toBe(200)
    expect(mockDownloadFile).toHaveBeenCalledWith({
      key: passwordShare.file.key,
      context: 'workspace',
    })
  })

  it('charges the per-IP content bucket exactly once', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({ authorized: true })
    await GET(request(), params())
    expect(mockEnforcePerIp).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerIp).toHaveBeenCalledWith(expect.anything(), 'content')
  })

  /**
   * S3 egress is what the `content` scope exists to bound, and the per-IP bucket
   * alone does not bound a link that is passed around — so the aggregate
   * per-share ceiling applies here too, charged after the auth gate so a caller
   * failing the gate cannot drain it for everyone else.
   */
  it('enforces the per-share content bucket with the resolved share id', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({ authorized: true })
    await GET(request(), params())
    expect(mockEnforcePerShare).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerShare).toHaveBeenCalledWith('content', 'sh_1')
  })

  it('never charges the per-share bucket for a request that fails the auth gate', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({
      authorized: false,
      error: 'auth_required_password',
    })
    await GET(request(), params())
    expect(mockEnforcePerShare).not.toHaveBeenCalled()
  })

  it('stops on the per-share bucket before any storage read', async () => {
    mockValidateDeploymentAuth.mockResolvedValueOnce({ authorized: true })
    mockEnforcePerShare.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await GET(request(), params())
    expect(res.status).toBe(429)
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })
})
