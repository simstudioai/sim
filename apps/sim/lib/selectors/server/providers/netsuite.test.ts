/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeListRecordTypes: vi.fn(),
}))

vi.mock('@/lib/internal/netsuite/operations/list-record-types', () => ({
  executeNetsuiteListRecordTypesOperation: mocks.executeListRecordTypes,
}))

vi.mock('@/lib/internal/netsuite/operations/get-async-status', () => ({
  executeNetsuiteGetAsyncStatusOperation: vi.fn(),
}))

import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { netsuiteSelectorAttachments } from '@/lib/selectors/server/providers/netsuite'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const args: ExecuteServerSelectorArgs = {
  selectorKey: 'netsuite.recordTypes',
  context: {},
  request: { kind: 'list' },
  scope: { kind: 'workspace', workspaceId: 'workspace-1' },
  workspaceId: 'workspace-1',
  principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  requesterUserId: 'user-1',
  references: new Map(),
  protectedValues: createSelectorProtectedValues(),
}

describe('NetSuite server selector adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('preserves a safe provider authentication status without forwarding its body', async () => {
    mocks.executeListRecordTypes.mockResolvedValue({
      success: false,
      output: { status: 401, data: 'provider-secret-canary' },
      error: 'provider-secret-canary',
    })

    await expect(
      netsuiteSelectorAttachments['netsuite.recordTypes'].execute(args, {
        oauthCredential: 'credential-1',
        accessToken: 'server-token',
        instanceUrl: 'https://123.suitetalk.api.netsuite.com',
      })
    ).rejects.toEqual(new SelectorConnectionUnavailableError(401))
  })
})
