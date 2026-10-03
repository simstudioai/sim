import { describe, expect, it } from 'vitest'
import { StreamRecoveryConfigSchema } from '@/lib/mothership/request/lifecycle/recovery-config'

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
