/**
 * @vitest-environment node
 *
 * Failure mode: `/o/<org>/chat/<id>` rendering a chat the viewer may open that belongs to another
 * organization, which then reads and writes under the wrong organization's shell.
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

import { readChatMode } from '@/platform/lib/data/chat-gate'

function chat(organizationId: string | null, workspaceId: string | null) {
  return { id: 'chat-1', organizationId, workspaceId, workflowId: null, mode: 'build' }
}

beforeEach(() => {
  getAccessibleCopilotChatAuth.mockReset()
  readWorkspaceShellOrganizationId.mockReset().mockResolvedValue('org-a')
})

describe('readChatMode', () => {
  it("opens an organization chat under its own organization's URL only", async () => {
    getAccessibleCopilotChatAuth.mockResolvedValue(chat('org-a', null))
    expect(await readChatMode('chat-1', 'org-a')).toBe('build')
    expect(await readChatMode('chat-1', 'org-b')).toBeNull()
  })

  it('opens a workspace chat under the organization its workspace opens in', async () => {
    getAccessibleCopilotChatAuth.mockResolvedValue(chat(null, 'ws-1'))
    expect(await readChatMode('chat-1', 'org-a')).toBe('build')
    expect(await readChatMode('chat-1', 'org-b')).toBeNull()
    expect(readWorkspaceShellOrganizationId).toHaveBeenCalledWith('ws-1')
  })

  it('opens nothing the viewer may not open', async () => {
    getAccessibleCopilotChatAuth.mockResolvedValue(null)
    expect(await readChatMode('chat-1', 'org-a')).toBeNull()
  })
})
