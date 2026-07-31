/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { claimPendingAsyncToolCall, getAsyncToolCall, getRunSegment } = vi.hoisted(() => ({
  claimPendingAsyncToolCall: vi.fn(),
  getAsyncToolCall: vi.fn(),
  getRunSegment: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  claimPendingAsyncToolCall,
  getAsyncToolCall,
  getRunSegment,
}))

import { POST } from './route'

function request(toolCallId: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/desktop/tool/authorize', {
    method: 'POST',
    body: JSON.stringify({ toolCallId }),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('desktop tool authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    getAsyncToolCall.mockResolvedValue({
      toolCallId: 'tool-1',
      runId: 'run-1',
      status: 'pending',
      toolName: 'read',
      args: { path: 'user-local/Project--mount-1/README.md', offset: 0, limit: 100 },
    })
    getRunSegment.mockResolvedValue({ id: 'run-1', userId: 'user-1', status: 'active' })
    claimPendingAsyncToolCall.mockResolvedValue({ toolCallId: 'browser-tool', status: 'running' })
  })

  it('returns the server-persisted args for an owned pending user-local call', async () => {
    const response = await POST(request('tool-1'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      toolName: 'read',
      args: { path: 'user-local/Project--mount-1/README.md', offset: 0, limit: 100 },
    })
  })

  it('authorizes a known browser tool and returns its persisted args', async () => {
    getAsyncToolCall.mockResolvedValueOnce({
      toolCallId: 'browser-tool',
      runId: 'run-1',
      status: 'pending',
      toolName: 'browser_navigate',
      args: { url: 'https://example.com' },
    })

    const response = await POST(request('browser-tool'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      toolName: 'browser_navigate',
      args: { url: 'https://example.com' },
    })
    expect(claimPendingAsyncToolCall).toHaveBeenCalledWith('browser-tool', 'desktop-browser')
  })

  it('rejects a replayed browser action after its pending row was claimed', async () => {
    getAsyncToolCall.mockResolvedValueOnce({
      toolCallId: 'browser-tool',
      runId: 'run-1',
      status: 'running',
      toolName: 'browser_click',
      args: { ref: 'e12' },
    })

    const response = await POST(request('browser-tool'))
    expect(response.status).toBe(404)
    expect(claimPendingAsyncToolCall).not.toHaveBeenCalled()
  })

  it('rejects workspace VFS calls and mutating legacy local tools', async () => {
    getAsyncToolCall.mockResolvedValueOnce({
      runId: 'run-1',
      status: 'pending',
      toolName: 'read',
      args: { path: 'WORKSPACE.md' },
    })
    const workspaceRead = await POST(request('tool-1'))
    expect(workspaceRead.status).toBe(403)

    getAsyncToolCall.mockResolvedValueOnce({
      runId: 'run-1',
      status: 'pending',
      toolName: 'local_stage_file',
      args: { uri: 'localfs://mount-1/secret.txt' },
    })
    const legacyMutation = await POST(request('tool-2'))
    expect(legacyMutation.status).toBe(403)
  })

  it('rejects completed, missing, and cross-user tool calls', async () => {
    getAsyncToolCall.mockResolvedValueOnce({
      runId: 'run-1',
      status: 'completed',
      toolName: 'read',
      args: { path: 'user-local/Project--mount-1/README.md' },
    })
    expect((await POST(request('tool-1'))).status).toBe(404)

    getAsyncToolCall.mockResolvedValueOnce(null)
    expect((await POST(request('missing'))).status).toBe(404)

    getRunSegment.mockResolvedValueOnce({ id: 'run-1', userId: 'user-2', status: 'active' })
    expect((await POST(request('tool-2'))).status).toBe(403)
  })

  it('rejects a pending tool after its run was aborted or returned early', async () => {
    getRunSegment.mockResolvedValueOnce({
      id: 'run-1',
      userId: 'user-1',
      status: 'cancelled',
    })
    expect((await POST(request('cancelled-tool'))).status).toBe(404)

    getRunSegment.mockResolvedValueOnce({
      id: 'run-1',
      userId: 'user-1',
      status: 'complete',
    })
    expect((await POST(request('completed-run-tool'))).status).toBe(404)
  })

  it('authenticates before parsing and rejects malformed IDs', async () => {
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
      userId: null,
      isAuthenticated: false,
    })
    expect((await POST(request('tool-1'))).status).toBe(401)
    expect(getAsyncToolCall).not.toHaveBeenCalled()

    expect((await POST(request('bad\u0000id'))).status).toBe(400)
    expect(getAsyncToolCall).not.toHaveBeenCalled()
  })
})
