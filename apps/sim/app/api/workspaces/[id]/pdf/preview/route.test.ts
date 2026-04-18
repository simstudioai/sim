/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockVerifyWorkspaceMembership, mockGeneratePdfFromCode } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockVerifyWorkspaceMembership: vi.fn(),
    mockGeneratePdfFromCode: vi.fn(),
  })
)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/app/api/workflows/utils', () => ({
  verifyWorkspaceMembership: mockVerifyWorkspaceMembership,
}))

vi.mock('@/lib/execution/doc-vm', () => ({
  generatePdfFromCode: mockGeneratePdfFromCode,
}))

import { POST } from '@/app/api/workspaces/[id]/pdf/preview/route'

describe('PDF preview API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockVerifyWorkspaceMembership.mockResolvedValue(true)
    mockGeneratePdfFromCode.mockResolvedValue(Buffer.from('%PDF-test'))
  })

  it('returns a generated PDF for authorized workspace members', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/workspace-1/pdf/preview',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: 'return 1' }),
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workspace-1' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockVerifyWorkspaceMembership).toHaveBeenCalledWith('user-1', 'workspace-1')
    expect(mockGeneratePdfFromCode).toHaveBeenCalledWith('return 1', 'workspace-1', request.signal)
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('%PDF-test')
  })

  it('rejects requests without code', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/workspace-1/pdf/preview',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workspace-1' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'code is required' })
    expect(mockGeneratePdfFromCode).not.toHaveBeenCalled()
  })
})
