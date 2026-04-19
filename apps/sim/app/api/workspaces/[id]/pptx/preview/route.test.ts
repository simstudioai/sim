/**
 * @vitest-environment node
 */
import {
  authMock,
  authMockFns,
  workflowsApiUtilsMock,
  workflowsApiUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_DOCUMENT_PREVIEW_CODE_BYTES } from '@/lib/execution/constants'

const { mockRunSandboxTask } = vi.hoisted(() => ({
  mockRunSandboxTask: vi.fn(),
}))

const mockVerifyWorkspaceMembership = workflowsApiUtilsMockFns.mockVerifyWorkspaceMembership

vi.mock('@/lib/auth', () => authMock)

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

vi.mock('@/lib/execution/sandbox/run-task', () => ({
  runSandboxTask: mockRunSandboxTask,
}))

import { POST } from '@/app/api/workspaces/[id]/pptx/preview/route'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

describe('PPTX preview API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockVerifyWorkspaceMembership.mockResolvedValue(true)
    mockRunSandboxTask.mockResolvedValue(Buffer.from('PK\x03\x04pptx'))
  })

  it('returns a generated PPTX for authorized workspace members', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/workspace-1/pptx/preview',
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
    expect(response.headers.get('Content-Type')).toBe(PPTX_MIME)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockVerifyWorkspaceMembership).toHaveBeenCalledWith('user-1', 'workspace-1')
    expect(mockRunSandboxTask).toHaveBeenCalledWith(
      'pptx-generate',
      { code: 'return 1', workspaceId: 'workspace-1' },
      { ownerKey: 'user:user-1', signal: request.signal }
    )
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('PK\x03\x04pptx')
  })

  it('rejects requests without code', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/workspace-1/pptx/preview',
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
    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('rejects oversized preview source payloads', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/workspace-1/pptx/preview',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: 'x'.repeat(MAX_DOCUMENT_PREVIEW_CODE_BYTES + 1) }),
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workspace-1' }),
    })

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'code exceeds maximum size' })
    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('returns 401 for unauthenticated requests', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)

    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/workspace-1/pptx/preview',
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

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockVerifyWorkspaceMembership).not.toHaveBeenCalled()
    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is not a workspace member', async () => {
    mockVerifyWorkspaceMembership.mockResolvedValue(false)

    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/workspace-1/pptx/preview',
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

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Insufficient permissions' })
    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('returns 400 for requests with invalid JSON bodies', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/workspace-1/pptx/preview',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{ not valid json',
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ id: 'workspace-1' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid or missing JSON body' })
    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('returns 500 when PPTX generation throws', async () => {
    mockRunSandboxTask.mockRejectedValue(new Error('boom: sandbox failed'))

    const request = new NextRequest(
      'http://localhost:3000/api/workspaces/workspace-1/pptx/preview',
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

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'boom: sandbox failed' })
  })
})
