/** @vitest-environment node */
import { setupGlobalFetchMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: <TInput, TOutput>(options: { mutationFn: (input: TInput) => Promise<TOutput> }) => ({
    mutateAsync: options.mutationFn,
  }),
}))
vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  oauthCredentialKeys: { lists: () => ['oauth-credentials', 'list'] },
}))

import { updateOrganizationCredentialBodySchema } from '@/lib/api/contracts/organization-credentials'
import { useUpdateScopedCredential } from '@/hooks/queries/scoped-credentials'

const WORKSPACE_ID = 'workspace-1'
const ORGANIZATION_ID = 'organization-1'
const CREDENTIAL_ID = 'slack-bot-1'
const reconnectFields = {
  signingSecret: 'new-signing-secret',
  botToken: 'xoxb-new-bot-token',
  displayName: 'Support Bot',
  description: 'Reconnected Slack bot',
} as const
const credential = {
  id: CREDENTIAL_ID,
  workspaceId: WORKSPACE_ID,
  type: 'service_account',
  displayName: reconnectFields.displayName,
  description: reconnectFields.description,
  unredacted: false,
  providerId: 'slack-custom-bot',
  accountId: null,
  envKey: null,
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
} as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('scoped Slack bot reconnect requests', () => {
  it.each([WORKSPACE_ID, undefined])(
    'sends workspace scope %s only in the query when reconnecting the existing credential',
    async (workspaceId) => {
      const fetch = setupGlobalFetchMock({ json: { credential } })

      await expect(
        useUpdateScopedCredential().mutateAsync({
          credentialId: CREDENTIAL_ID,
          workspaceId,
          ...reconnectFields,
        })
      ).resolves.toEqual({ credential })

      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        `/api/credentials/${CREDENTIAL_ID}${workspaceId ? `?workspaceId=${workspaceId}` : ''}`,
        expect.objectContaining({ method: 'PUT' })
      )
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(reconnectFields)
    }
  )

  it('includes organization scope in the body when reconnecting the existing credential', async () => {
    const organizationCredential = {
      ...credential,
      workspaceId: null,
      organizationId: ORGANIZATION_ID,
    }
    const fetch = setupGlobalFetchMock({ json: { credential: organizationCredential } })

    await expect(
      useUpdateScopedCredential().mutateAsync({
        credentialId: CREDENTIAL_ID,
        organizationId: ORGANIZATION_ID,
        ...reconnectFields,
      })
    ).resolves.toEqual({ credential: organizationCredential })

    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/organization-credentials/${CREDENTIAL_ID}`,
      expect.objectContaining({ method: 'PATCH' })
    )
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      ...reconnectFields,
      organizationId: ORGANIZATION_ID,
    })
  })

  it.each([
    { organizationId: ORGANIZATION_ID },
    { ...reconnectFields },
    { organizationId: ORGANIZATION_ID, ...reconnectFields, workspaceId: WORKSPACE_ID },
    { organizationId: ORGANIZATION_ID, ...reconnectFields, unexpected: true },
  ])('rejects invalid organization updates: %j', (body) => {
    expect(updateOrganizationCredentialBodySchema.safeParse(body).success).toBe(false)
  })
})
