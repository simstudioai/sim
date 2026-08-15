/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPolicy } = vi.hoisted(() => ({
  mockGetPolicy: vi.fn(),
}))

vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapter: () => ({ getPolicy: mockGetPolicy }),
}))

import { updateCredentialGroup } from '@/lib/credential-groups/service'

describe('Credential Group service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('validates provider policy through the active update transaction', async () => {
    const option = {
      id: 'option-1',
      provider: 'slack' as const,
      label: 'Slack',
      slackBotCredentialId: 'bot-1',
      authorizationAppId: 'slack:A123:T123',
      requiredScopes: ['chat:write'],
      scopeVersion: 1,
      required: true,
      status: 'active' as const,
    }
    const existing = {
      id: 'group-1',
      workspaceId: 'workspace-1',
      publicId: 'public-1',
      name: 'Support accounts',
      description: null,
      options: [option],
      encryptedProviderConfiguration: null,
      status: 'active' as const,
      createdBy: 'user-1',
      createdAt: new Date('2026-08-13T00:00:00Z'),
      updatedAt: new Date('2026-08-13T00:00:00Z'),
    }
    queueTableRows(schemaMock.credentialGroup, [existing])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...existing, updatedAt: new Date('2026-08-13T01:00:00Z') },
    ])
    mockGetPolicy.mockResolvedValue({
      provider: 'slack',
      providerId: 'slack',
      authorizationAppId: option.authorizationAppId,
      requiredScopes: option.requiredScopes,
      scopeVersion: option.scopeVersion,
    })

    await expect(
      updateCredentialGroup('workspace-1', 'group-1', {
        options: [
          {
            id: option.id,
            provider: option.provider,
            label: option.label,
            slackBotCredentialId: option.slackBotCredentialId,
            required: option.required,
          },
        ],
      })
    ).resolves.toMatchObject({ id: 'group-1' })

    expect(mockGetPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ slackBotCredentialId: 'bot-1' }),
      {
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        executor: dbChainMock.db,
      }
    )
  })
})
