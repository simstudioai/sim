/**
 * @vitest-environment node
 *
 * Failure modes: `/o/<org>/chat/<id>` rendering a chat the viewer may open that belongs to another
 * organization, which then reads and writes under the wrong organization's shell; and a workspace
 * chat opened without its workspace, whose sends and Stops then name the organization and are
 * refused (the chat turns read-only and a Stop leaves its run going).
 */
import {
  mothershipChatLifecycleMock,
  mothershipChatLifecycleMockFns,
} from '@sim/testing/mocks/mothership-chat-lifecycle.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readWorkspaceShellOrganizationId } = vi.hoisted(() => ({
  readWorkspaceShellOrganizationId: vi.fn(),
}))
const getAccessibleCopilotChatAuth = mothershipChatLifecycleMockFns.mockGetAccessibleCopilotChatAuth
vi.mock('server-only', () => ({}))
vi.mock('@/lib/mothership/chat/lifecycle', () => mothershipChatLifecycleMock)
vi.mock('@/platform/lib/data/shell-scope', () => ({ readWorkspaceShellOrganizationId }))
vi.mock('@/platform/lib/data/server-read', () => ({
  requireSessionViewer: async () => ({
    principal: { kind: 'session', userId: 'viewer', sessionId: 'session-1' },
    activeOrganizationId: null,
  }),
}))

import { readOpenChat } from '@/platform/lib/data/chat-gate'

function chat(organizationId: string | null, workspaceId: string | null) {
  return { id: 'chat-1', organizationId, workspaceId, workflowId: null, mode: 'build' }
}

beforeEach(() => {
  getAccessibleCopilotChatAuth.mockReset()
  readWorkspaceShellOrganizationId.mockReset().mockResolvedValue('org-a')
})

describe('readOpenChat', () => {
  it("opens an organization chat under its own organization's URL only, in that organization", async () => {
    getAccessibleCopilotChatAuth.mockResolvedValue(chat('org-a', null))
    expect(await readOpenChat('chat-1', 'org-a')).toEqual({
      mode: 'build',
      chat: { id: 'chat-1' },
    })
    expect(await readOpenChat('chat-1', 'org-b')).toBeNull()
  })

  it('opens a workspace chat under the organization its workspace opens in, in its workspace', async () => {
    getAccessibleCopilotChatAuth.mockResolvedValue(chat(null, 'ws-1'))
    expect(await readOpenChat('chat-1', 'org-a')).toEqual({
      mode: 'build',
      chat: { id: 'chat-1', workspaceId: 'ws-1' },
    })
    expect(await readOpenChat('chat-1', 'org-b')).toBeNull()
    expect(readWorkspaceShellOrganizationId).toHaveBeenCalledWith('ws-1')
  })

  it('opens nothing the viewer may not open', async () => {
    getAccessibleCopilotChatAuth.mockResolvedValue(null)
    expect(await readOpenChat('chat-1', 'org-a')).toBeNull()
  })
})
