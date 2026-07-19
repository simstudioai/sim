/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveShare,
  mockEnforcePerIp,
  mockEnforcePerShare,
  mockValidateAuth,
  mockDownloadFile,
  mockResolveImage,
} = vi.hoisted(() => ({
  mockResolveShare: vi.fn(),
  mockEnforcePerIp: vi.fn(),
  mockEnforcePerShare: vi.fn(),
  mockValidateAuth: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockResolveImage: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveShareByToken: mockResolveShare,
}))
vi.mock('@/lib/public-shares/rate-limit', () => ({
  enforcePerIpRateLimit: mockEnforcePerIp,
  enforcePerShareRateLimit: mockEnforcePerShare,
}))
vi.mock('@/lib/core/security/deployment-auth', () => ({ validateDeploymentAuth: mockValidateAuth }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFile: mockDownloadFile }))
vi.mock('@/lib/uploads/server/inline-image', () => ({
  resolveWorkspaceInlineImage: mockResolveImage,
}))

import { GET } from '@/app/api/files/public/[token]/inline/route'

const TOKEN = 'tok_share_123456'
const DOC_KEY = 'workspace/ws-1/doc.md'
const IMG_KEY = 'workspace/ws-1/photo.png'
const FILE_ID = 'wf_YwDXi8eWOkTxn0sbgChlB'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

const params = { params: Promise.resolve({ token: TOKEN }) }
const req = (q: string) => new NextRequest(`http://localhost/api/files/public/${TOKEN}/inline?${q}`)

const share = {
  share: { id: 'sh_1', token: TOKEN, authType: 'public' },
  file: { id: 'wf_doc', key: DOC_KEY, workspaceId: 'ws-1', originalName: 'doc.md' },
  workspaceName: 'Acme',
  ownerName: 'Jane',
}

/** doc bytes embed the image via the view form; image bytes are a real PNG */
function downloadByKey(docContent = `![a](/api/files/view/${FILE_ID})`) {
  return ({ key }: { key: string }) =>
    Promise.resolve(key === DOC_KEY ? Buffer.from(docContent, 'utf-8') : PNG)
}

describe('GET /api/files/public/[token]/inline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforcePerIp.mockResolvedValue(null)
    mockEnforcePerShare.mockResolvedValue(null)
    mockResolveShare.mockResolvedValue(share)
    mockValidateAuth.mockResolvedValue({ authorized: true })
    mockResolveImage.mockResolvedValue({
      key: IMG_KEY,
      contentType: 'image/png',
      filename: 'photo.png',
    })
    mockDownloadFile.mockImplementation(downloadByKey())
  })

  it('serves a same-workspace image referenced by the doc, typed from its bytes', async () => {
    const res = await GET(req(`fileId=${FILE_ID}`), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
  })

  it('serves a key-referenced image', async () => {
    mockDownloadFile.mockImplementation(
      downloadByKey(`![a](/api/files/serve/${encodeURIComponent(IMG_KEY)}?context=workspace)`)
    )
    const res = await GET(req(`key=${encodeURIComponent(IMG_KEY)}`), params)
    expect(res.status).toBe(200)
  })

  it('404s when the reference is not embedded in the shared document', async () => {
    mockDownloadFile.mockImplementation(downloadByKey('no images here'))
    const res = await GET(req(`fileId=${FILE_ID}`), params)
    expect(res.status).toBe(404)
    expect(mockResolveImage).not.toHaveBeenCalled()
  })

  it('404s when the referenced file is not in the document workspace', async () => {
    mockResolveImage.mockResolvedValue(null)
    const res = await GET(req(`fileId=${FILE_ID}`), params)
    expect(res.status).toBe(404)
  })

  it('404s when the bytes are not a renderable image', async () => {
    mockDownloadFile.mockImplementation(({ key }: { key: string }) =>
      Promise.resolve(
        key === DOC_KEY
          ? Buffer.from(`![a](/api/files/view/${FILE_ID})`, 'utf-8')
          : Buffer.from('<svg/>', 'utf-8')
      )
    )
    const res = await GET(req(`fileId=${FILE_ID}`), params)
    expect(res.status).toBe(404)
  })

  it('401s and never reads storage when the share is unauthorized', async () => {
    mockValidateAuth.mockResolvedValue({ authorized: false, error: 'auth_required_password' })
    const res = await GET(req(`fileId=${FILE_ID}`), params)
    expect(res.status).toBe(401)
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('404s for an unknown or inactive token', async () => {
    mockResolveShare.mockResolvedValue(null)
    const res = await GET(req(`fileId=${FILE_ID}`), params)
    expect(res.status).toBe(404)
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('charges the per-IP content bucket exactly once', async () => {
    await GET(req(`fileId=${FILE_ID}`), params)
    expect(mockEnforcePerIp).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerIp).toHaveBeenCalledWith(expect.anything(), 'content')
  })

  /**
   * One page of a shared document fans out to many inline requests, so the
   * aggregate per-share ceiling matters most here — the per-IP bucket alone does
   * not bound a link that is passed around.
   */
  it('enforces the per-share content bucket with the resolved share id', async () => {
    await GET(req(`fileId=${FILE_ID}`), params)
    expect(mockEnforcePerShare).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerShare).toHaveBeenCalledWith('content', 'sh_1')
  })

  it('never charges the per-share bucket for a request that fails the auth gate', async () => {
    mockValidateAuth.mockResolvedValue({ authorized: false, error: 'auth_required_password' })
    await GET(req(`fileId=${FILE_ID}`), params)
    expect(mockEnforcePerShare).not.toHaveBeenCalled()
  })

  it('stops on the per-share bucket before any storage read', async () => {
    mockEnforcePerShare.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await GET(req(`fileId=${FILE_ID}`), params)
    expect(res.status).toBe(429)
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })
})
