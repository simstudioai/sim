/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveActiveShareByToken,
  mockEnforceRateLimit,
  mockValidateDeploymentAuth,
  mockDownloadFile,
  mockResolveServableDoc,
} = vi.hoisted(() => ({
  mockResolveActiveShareByToken: vi.fn(),
  mockEnforceRateLimit: vi.fn(),
  mockValidateDeploymentAuth: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockResolveServableDoc: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveShareByToken: mockResolveActiveShareByToken,
}))

vi.mock('@/lib/public-shares/rate-limit', () => ({
  enforcePublicFileRateLimit: mockEnforceRateLimit,
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
    mockEnforceRateLimit.mockResolvedValue(null)
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
})
