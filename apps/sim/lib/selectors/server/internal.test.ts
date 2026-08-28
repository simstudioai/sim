/**
 * @vitest-environment node
 */
import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { internalSelectorAttachments } from '@/lib/selectors/server/internal'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'

describe('workspace.secretNames selector', () => {
  beforeEach(() => {
    resetEnvironmentUtilsMock()
  })

  it('returns the ACL-filtered names without loading the decrypted environment snapshot', async () => {
    environmentUtilsMockFns.mockGetEffectiveEnvironmentVariableNames.mockResolvedValue([
      'PERSONAL_KEY',
      'SHARED_KEY',
    ])

    await expect(
      internalSelectorAttachments['workspace.secretNames'].execute({
        selectorKey: 'workspace.secretNames',
        context: {},
        request: { kind: 'list' },
        scope: { kind: 'workspace', workspaceId: 'workspace-1' },
        workspaceId: 'workspace-1',
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        requesterUserId: 'user-1',
        references: new Map(),
        protectedValues: createSelectorProtectedValues(),
      })
    ).resolves.toEqual({
      kind: 'list',
      items: [
        { id: 'PERSONAL_KEY', label: 'PERSONAL_KEY' },
        { id: 'SHARED_KEY', label: 'SHARED_KEY' },
      ],
    })

    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentVariableNames).toHaveBeenCalledWith(
      'user-1',
      'workspace-1'
    )
    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot).not.toHaveBeenCalled()
  })
})
