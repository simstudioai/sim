/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  resolveBundle: vi.fn(),
}))

vi.mock('@/lib/managed-agents/session-client', () => ({
  AGENT_MEMORY_BETA: 'agent-memory-test',
  managedAgentsList: mocks.list,
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.resolveBundle,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { managedAgentSelectorAttachments } from '@/lib/selectors/server/providers/managed-agent'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const args: ExecuteServerSelectorArgs = {
  selectorKey: 'managedAgent.agents',
  context: {},
  request: { kind: 'list' },
  scope: { kind: 'workspace', workspaceId: 'workspace-1' },
  workspaceId: 'workspace-1',
  principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  requesterUserId: 'user-1',
  credential: { suppliedId: 'credential-1' },
  references: new Map(),
  protectedValues: createSelectorProtectedValues(),
}

describe('Managed Agent server selector adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('preserves the editor empty-list fallback when key resolution fails', async () => {
    mocks.resolveBundle.mockRejectedValue(new Error('credential unavailable'))

    await expect(
      managedAgentSelectorAttachments['managedAgent.agents'].execute(args)
    ).resolves.toEqual({ kind: 'list', items: [] })
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
