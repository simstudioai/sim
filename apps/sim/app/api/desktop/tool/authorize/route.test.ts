import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const { claimPendingAsyncToolCall, getAsyncToolCall, getRunSegment, resolveInvocationWorkspace } =
  vi.hoisted(() => ({
    claimPendingAsyncToolCall: vi.fn(),
    resolveInvocationWorkspace: vi.fn(),
    getAsyncToolCall: vi.fn(),
    getRunSegment: vi.fn(),
  }))

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)
vi.mock('@/lib/mothership/application/workspace-target', () => ({ resolveInvocationWorkspace }))

vi.mock('@/lib/mothership/async-runs/repository', () => ({
  claimPendingAsyncToolCall,
  getAsyncToolCall,
  getRunSegment,
}))

import { POST } from './route'

function request(toolCallId: unknown, claim = false): NextRequest {
  return new NextRequest('http://localhost:3000/api/desktop/tool/authorize', {
    method: 'POST',
    body: JSON.stringify({ toolCallId, claim }),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('desktop tool authorization', () => {
  beforeEach(() => {
    resolveInvocationWorkspace.mockResolvedValue({ workspaceId: 'target' })
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
    getRunSegment.mockResolvedValue({
      id: 'run-1',
      chatId: 'chat-1',
      userId: 'user-1',
      status: 'active',
    })
    claimPendingAsyncToolCall.mockResolvedValue({ toolCallId: 'browser-tool', status: 'running' })
  })

  it('never returns presentation activity as an executable browser argument', async () => {
    const fields = [{ elementId: 1, kind: 'text', text: 'a' }]
    getAsyncToolCall.mockResolvedValueOnce({
      toolCallId: 'form-tool',
      runId: 'run-1',
      status: 'pending',
      toolName: 'browser_fill_form',
      args: { activity: { description: 'Filling the form' }, fields },
    })

    const response = await POST(request('form-tool'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      chatId: 'chat-1',
      toolName: 'browser_fill_form',
      args: { fields },
    })
  })

  it('rejects retired browser tools retained only for history', async () => {
    getAsyncToolCall.mockResolvedValueOnce({
      toolCallId: 'retired-browser-tool',
      runId: 'run-1',
      status: 'pending',
      toolName: 'browser_request_takeover',
      args: { reason: 'Legacy handoff' },
    })

    const response = await POST(request('retired-browser-tool'))

    expect(response.status).toBe(403)
    expect(claimPendingAsyncToolCall).not.toHaveBeenCalled()
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

  it('claims an org-view import once and permits chunks only under that claim', async () => {
    const args = { path: '~/Documents/project', targetWorkspaceId: 'target' }
    const tool = {
      toolCallId: 'import-1',
      runId: 'run-1',
      toolName: 'import_local_files',
      args,
      status: 'pending',
    }
    getAsyncToolCall.mockResolvedValue(tool)
    getRunSegment.mockResolvedValue({
      id: 'run-1',
      userId: 'user-1',
      chatId: 'chat-1',
      organizationId: 'org-1',
      status: 'active',
    })
    expect((await POST(request('import-1'))).status).toBe(404)
    expect((await POST(request('import-1', true))).status).toBe(200)
    expect(resolveInvocationWorkspace).toHaveBeenCalledWith(
      { userId: 'user-1', chatId: 'chat-1', organizationId: 'org-1', workspaceId: undefined },
      'target'
    )
    expect(claimPendingAsyncToolCall).toHaveBeenCalledExactlyOnceWith('import-1', 'desktop-files')
    getAsyncToolCall.mockResolvedValue({ ...tool, status: 'running', claimedBy: 'desktop-files' })
    expect((await POST(request('import-1', true))).status).toBe(409)
    expect((await POST(request('import-1'))).status).toBe(200)
    getAsyncToolCall.mockResolvedValue({ ...tool, status: 'running', claimedBy: 'sim-stream' })
    expect((await POST(request('import-1'))).status).toBe(404)
    expect(claimPendingAsyncToolCall).toHaveBeenCalledOnce()
  })

  it('rejects inaccessible destinations and lost import claims before exposing files', async () => {
    getAsyncToolCall.mockResolvedValue({
      toolCallId: 'import-1',
      runId: 'run-1',
      status: 'pending',
      toolName: 'import_local_files',
      args: { path: '~/file', targetWorkspaceId: 'outside-org' },
    })
    resolveInvocationWorkspace.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Workspace not found')
    )
    expect((await POST(request('import-1', true))).status).toBe(404)
    expect(claimPendingAsyncToolCall).not.toHaveBeenCalled()
    claimPendingAsyncToolCall.mockResolvedValueOnce(null)
    expect((await POST(request('import-1', true))).status).toBe(409)
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
