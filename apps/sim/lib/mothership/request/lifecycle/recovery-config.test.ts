import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { describe, expect, it, vi } from 'vitest'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import {
  StreamRecoveryConfigSchema,
  streamRecoveryConfig,
} from '@/lib/mothership/request/lifecycle/recovery-config'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const identity = {
  userId: 'actor',
  chatId: '11111111-1111-4111-8111-111111111111',
  messageId: '22222222-2222-4222-8222-222222222222',
  message: 'Continue',
}
const workspaceRequest = { ...identity, workspaceId: '33333333-3333-4333-8333-333333333333' }
const organizationRequest = {
  ...identity,
  organizationId: 'org-1',
  mode: 'assistant' as const,
  assistantSearch: { source: 'drive', documentIds: ['document-1'] },
}
function config(request: object, requestMode?: string) {
  return {
    kind: 'interactive_stream',
    request,
    requestMode,
    goRoute: '/api/mothership',
    clientToolPickupExpected: false,
  }
}

describe('durable recovery admission contract', () => {
  it.each(['agent', 'build', 'plan'])(
    'retains existing %s UI intent without changing the Build wire contract',
    (mode) => {
      expect(
        StreamRecoveryConfigSchema.parse(config(workspaceRequest, mode)).request
      ).not.toHaveProperty('mode')
    }
  )
  it('preserves admitted Assistant policy and filters while stripping transport secrets and receipts', () => {
    const parsed = StreamRecoveryConfigSchema.parse(
      config(
        {
          ...organizationRequest,
          byokApiKey: 'test-only-key',
          delegationToken: 'test-only-token',
          receivedTextChars: 7,
        },
        'assistant'
      )
    )
    expect(parsed.request).toMatchObject(organizationRequest)
    expect(parsed.request).not.toHaveProperty('byokApiKey')
    expect(parsed.request).not.toHaveProperty('delegationToken')
    expect(parsed.request).not.toHaveProperty('receivedTextChars')
    expect(parsed.request).not.toHaveProperty('integrationTools')
    expect(parsed.request).not.toHaveProperty('mothershipTools')
  })
  it.each(['integrationTools', 'mothershipTools'])(
    'rejects %s schemas at the durable request boundary',
    (field) => {
      expect(
        StreamRecoveryConfigSchema.safeParse(
          config({
            ...workspaceRequest,
            [field]: [{ name: 'tool', inputSchema: { type: 'object' } }],
          })
        ).success
      ).toBe(false)
    }
  )
  it.each([
    config(workspaceRequest, 'assistant'),
    config({ ...workspaceRequest, mode: 'plan' }, 'agent'),
    config({ ...workspaceRequest, mode: 'agent' }, 'plan'),
    config(organizationRequest, 'agent'),
    config({ ...organizationRequest, workspaceId: workspaceRequest.workspaceId }, 'assistant'),
    config({ ...organizationRequest, mode: undefined }, 'assistant'),
    config({ ...organizationRequest, workflowId: 'workflow' }, 'assistant'),
  ])('rejects conflicting durable mode or owner declarations', (input) => {
    expect(StreamRecoveryConfigSchema.safeParse(input).success).toBe(false)
  })
})

it('preserves the explicit Plan wire mode on recovery', () => {
  expect(
    StreamRecoveryConfigSchema.parse(config({ ...workspaceRequest, mode: 'plan' }, 'plan')).request
      .mode
  ).toBe('plan')
})

describe('recovery marker written by an admitted turn', () => {
  const options = {
    interactive: true,
    userId: identity.userId,
    chatId: identity.chatId,
    goRoute: '/api/mothership',
    copilotResourceAdmission: createCopilotResourceAdmission({
      userId: identity.userId,
      invocation: { kind: 'chat', chatId: identity.chatId },
    }),
  }

  it.each([true, false])(
    'restores authoring admission on recovery whether Projects are on (%s) or off',
    async (projects) => {
      featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
        async (flag) => projects && flag === 'projects'
      )
      const recovery = await streamRecoveryConfig(options, workspaceRequest)
      expect(recovery?.resourceAuthoringVersion).toBe(1)
    }
  )

  it('stays off a turn that was never admitted', async () => {
    const recovery = await streamRecoveryConfig(
      { ...options, copilotResourceAdmission: undefined },
      workspaceRequest
    )
    expect(recovery).not.toHaveProperty('resourceAuthoringVersion')
  })
})
