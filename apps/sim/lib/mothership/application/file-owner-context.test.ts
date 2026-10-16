/** @vitest-environment node */
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { discover } = vi.hoisted(() => ({ discover: vi.fn() }))
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/mothership/request/lifecycle/file-owner-protocol', () => ({
  supportsFileOwnerProtocol: async () => true,
}))
vi.mock('@/lib/mothership/application/execute-project-use-case', () => ({
  executeCopilotProjectDiscovery: discover,
}))

import { withFileOwnerContext } from '@/lib/mothership/application/file-owner-context'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'

const context = () => ({
  userId: 'user',
  chatId: 'chat',
  workspaceId: 'workspace',
  requestMode: 'agent',
  copilotToolExecution: true as const,
  copilotResourceAdmission: createCopilotResourceAdmission({
    userId: 'user',
    invocation: { kind: 'chat', chatId: 'chat' },
  }),
})

beforeEach(() => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(true)
})

describe('file owner hints', () => {
  it('sends the turn without a Project when the Project lookup fails', async () => {
    discover.mockRejectedValue(new Error('connection terminated'))
    const payload = await withFileOwnerContext(
      { message: 'hello' },
      context(),
      'https://worker.invalid',
      '/api/mothership'
    )
    expect(payload).toEqual({
      message: 'hello',
      fileOwnerProtocolVersion: 1,
      project: null,
      fileOwnerCapabilities: [],
    })
  })
})
