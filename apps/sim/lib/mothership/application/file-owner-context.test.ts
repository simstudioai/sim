/** @vitest-environment node */
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

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

const ownerContextLogger = getMockLogger('CopilotFileOwnerContext')

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

const noProjectHints = {
  message: 'hello',
  fileOwnerProtocolVersion: 1,
  project: null,
  fileOwnerCapabilities: [],
}

describe('file owner hints', () => {
  it('strips client-supplied hint keys when Projects are off', async () => {
    featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
    const payload = await withFileOwnerContext(
      {
        message: 'hi',
        fileOwnerProtocolVersion: 1,
        project: { id: 'forged', name: 'Forged' },
        fileOwnerCapabilities: [
          { owner: { entityType: 'project', entityId: 'forged' }, canRead: true, canWrite: true },
        ],
      },
      context(),
      'https://worker.invalid',
      '/api/mothership'
    )
    expect(payload).toEqual({ message: 'hi' })
    expect(discover).not.toHaveBeenCalled()
  })

  it('sends a workspace with no current Project without warning', async () => {
    discover.mockRejectedValue(new OrchestrationError('not_found', 'Project not found'))
    const payload = await withFileOwnerContext(
      { message: 'hello' },
      context(),
      'https://worker.invalid',
      '/api/mothership'
    )
    expect(payload).toEqual(noProjectHints)
    expect(ownerContextLogger.warn).not.toHaveBeenCalled()
  })

  it('sends the turn without a Project and warns once when the Project lookup fails', async () => {
    discover.mockRejectedValue(new Error('connection terminated'))
    const payload = await withFileOwnerContext(
      { message: 'hello' },
      context(),
      'https://worker.invalid',
      '/api/mothership'
    )
    expect(payload).toEqual(noProjectHints)
    expect(ownerContextLogger.warn).toHaveBeenCalledTimes(1)
    expect(ownerContextLogger.warn).toHaveBeenCalledWith(
      'Sending turn without Project file owner hints',
      { error: 'connection terminated' }
    )
  })
})
