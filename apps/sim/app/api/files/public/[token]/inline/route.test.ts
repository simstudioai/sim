/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const { mockResolveShare, mockRateLimit, mockValidateAuth, mockDownloadFile, mockResolveImage } =
  vi.hoisted(() => ({
    mockResolveShare: vi.fn(),
    mockRateLimit: vi.fn(),
    mockValidateAuth: vi.fn(),
    mockDownloadFile: vi.fn(),
    mockResolveImage: vi.fn(),
  }))

vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveShareByToken: mockResolveShare,
}))
vi.mock('@/lib/public-shares/rate-limit', () => ({ enforcePublicFileRateLimit: mockRateLimit }))
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
    mockRateLimit.mockResolvedValue(null)
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
    const request = req(`fileId=${FILE_ID}`)
    const res = await GET(request, params)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(mockRateLimit).toHaveBeenCalledExactlyOnceWith(request, 'inline')
    expect(res.headers.get('cache-control')).toBe('private, no-cache, must-revalidate')
  })

  it('rejects exhausted image budgets before share lookup, authentication, or storage reads', async () => {
    const limited = NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
    mockRateLimit.mockResolvedValue(limited)

    const response = await GET(req(`fileId=${FILE_ID}`), params)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(mockResolveShare).not.toHaveBeenCalled()
    expect(mockValidateAuth).not.toHaveBeenCalled()
    expect(mockResolveImage).not.toHaveBeenCalled()
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })

  it('serves an image whose id is percent-encoded in the document', async () => {
    mockDownloadFile.mockImplementation(downloadByKey('![a](/api/files/view/wf%5Fabc)'))

    const res = await GET(req('fileId=wf%5Fabc'), params)

    expect(res.status).toBe(200)
    expect(mockResolveImage).toHaveBeenCalledWith('ws-1', { fileId: 'wf_abc' })
  })

  it('serves a key-referenced image', async () => {
    mockDownloadFile.mockImplementation(
      downloadByKey(`![a](/api/files/serve/${encodeURIComponent(IMG_KEY)}?context=workspace)`)
    )
    const res = await GET(req(`key=${encodeURIComponent(IMG_KEY)}`), params)
    expect(res.status).toBe(200)
  })

  it.each(['fileId', 'key'] as const)(
    'serves a referenced %s beyond the export bundle limit',
    async (kind) => {
      const earlierImages = Array.from(
        { length: 50 },
        (_, index) => `![earlier](/api/files/view/wf_earlier_${index})`
      )
      const src =
        kind === 'fileId'
          ? `/api/files/view/${FILE_ID}`
          : `/api/files/serve/${encodeURIComponent(IMG_KEY)}`
      mockDownloadFile.mockImplementation(
        downloadByKey([...earlierImages, `![last](${src})`].join('\n\n'))
      )

      const response = await GET(
        req(`${kind}=${encodeURIComponent(kind === 'fileId' ? FILE_ID : IMG_KEY)}`),
        params
      )

      expect(response.status).toBe(200)
      expect(mockResolveImage).toHaveBeenCalledExactlyOnceWith('ws-1', {
        [kind]: kind === 'fileId' ? FILE_ID : IMG_KEY,
      })
    }
  )

  it('404s when the reference is not embedded in the shared document', async () => {
    mockDownloadFile.mockImplementation(downloadByKey('no images here'))
    const res = await GET(req(`fileId=${FILE_ID}`), params)
    expect(res.status).toBe(404)
    expect(mockResolveImage).not.toHaveBeenCalled()
  })

  it.each([
    `[link](/api/files/view/${FILE_ID})`,
    `\`![image](/api/files/view/${FILE_ID})\``,
    `<script><img src="/api/files/view/${FILE_ID}"></script>`,
    `<!-- <img src="/api/files/view/${FILE_ID}"> -->`,
    `<div><!-- <img src="/api/files/view/${FILE_ID}"> --></div>`,
    `inline <!-- <img src="/api/files/view/${FILE_ID}"> --> text`,
    `![external](https://example.com/api/files/view/${FILE_ID})`,
  ])('does not extend a share to an image mentioned as %s', async (source) => {
    mockDownloadFile.mockImplementation(downloadByKey(source))

    const response = await GET(req(`fileId=${FILE_ID}`), params)

    expect(response.status).toBe(404)
    expect(mockResolveImage).not.toHaveBeenCalled()
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
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

  it('bounds both reads: the doc scan tightly, the served image at the transfer ceiling', async () => {
    await GET(req(`fileId=${FILE_ID}`), params)

    const [docRead, imageRead] = mockDownloadFile.mock.calls.map(([args]) => args)
    // The doc is scanned and discarded (and decoded to UTF-16 on top of the buffer),
    // so it must not inherit the ceiling of a file this route actually serves.
    expect(docRead.key).toBe(DOC_KEY)
    expect(docRead.maxBytes).toBeGreaterThan(0)
    expect(docRead.maxBytes).toBeLessThan(MAX_BUFFERED_TRANSFER_BYTES)
    expect(imageRead.key).toBe(IMG_KEY)
    expect(imageRead.maxBytes).toBe(MAX_BUFFERED_TRANSFER_BYTES)
  })

  it('fails the referenced-by-doc gate closed when the document is too large to scan', async () => {
    mockDownloadFile.mockImplementation(({ key }: { key: string }) =>
      key === DOC_KEY
        ? Promise.reject(
            new PayloadSizeLimitError({
              label: 'storage download',
              maxBytes: 10 * 1024 * 1024,
              observedBytes: 5 * 1024 * 1024 * 1024,
            })
          )
        : Promise.resolve(PNG)
    )

    const res = await GET(req(`fileId=${FILE_ID}`), params)

    expect(res.status).toBe(404)
    // The gate could not be verified, so the image must never be read at all.
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
  })
})
