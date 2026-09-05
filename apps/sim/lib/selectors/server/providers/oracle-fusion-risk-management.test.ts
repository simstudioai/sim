/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleFusionRiskSelectorAttachments } from '@/lib/selectors/server/providers/oracle-fusion-risk-management'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const mocks = vi.hoisted(() => ({ request: vi.fn(), account: vi.fn(), bundle: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.request,
  requestOracleFusionEmpty: vi.fn(),
}))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveOAuthAccountId: mocks.account }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))

const ORIGIN = 'https://example.fa.us2.oraclecloud.com'
const ID = '9007199254740993'
const attachment = oracleFusionRiskSelectorAttachments['oracle_fusion_risk_management.process']
function args(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oracle_fusion_risk_management.process',
    context: { oauthCredential: 'credential' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace' },
    workspaceId: 'workspace',
    principal: { kind: 'session', userId: 'user', sessionId: 'session' },
    requesterUserId: 'user',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    credential: {
      suppliedId: 'credential',
      access: {
        ok: true,
        resolvedCredentialId: 'credential',
        credentialOwnerUserId: 'user',
        credentialType: 'service_account',
      },
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.account.mockResolvedValue({
    credentialType: 'service_account',
    providerId: 'oracle-fusion-service-account',
  })
  mocks.bundle.mockResolvedValue({ instanceUrl: ORIGIN, accessToken: 'hidden-token' })
})

describe('Risk Management selectors', () => {
  it('selects group navigation keys instead of business IDs', async () => {
    const input = args()
    input.selectorKey = 'oracle_fusion_risk_management.assignment_group'
    const groupAttachment = oracleFusionRiskSelectorAttachments[input.selectorKey]
    mocks.request.mockResolvedValue({
      items: [
        {
          GroupId: 'business-id',
          Name: 'Reviewers',
          '@context': {
            links: [
              {
                rel: 'self',
                href: `${ORIGIN}/fscmRestApi/resources/11.13.18.05/userAssignmentGroups/group-hash`,
              },
            ],
          },
        },
      ],
      count: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    })
    expect(
      await groupAttachment.execute(input, { instanceUrl: ORIGIN, accessToken: 'hidden-token' })
    ).toEqual({ kind: 'list', items: [{ id: 'group-hash', label: 'Reviewers' }] })
  })

  it('prepares only a credential-bound Oracle destination', async () => {
    const input = args()
    if (attachment.destination === 'fixed') throw new Error('Expected credential binding')
    expect(attachment.destination.kind).toBe('credential-bound')
    expect(await attachment.destination.prepare(input)).toEqual({
      instanceUrl: ORIGIN,
      accessToken: 'hidden-token',
    })
    mocks.account.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'other-service',
    })
    await expect(attachment.destination.prepare(input)).rejects.toThrow()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('projects safe exact-ID options from one page and preserves cancellation', async () => {
    const input = args()
    input.request = { kind: 'list', cursor: '100' }
    input.signal = new AbortController().signal
    mocks.request.mockResolvedValue({
      items: [{ ProcessId: ID, Name: 'Quarterly review', secret: 'unprojected' }],
      count: 1,
      hasMore: true,
      limit: 100,
      offset: 100,
    })
    const result = await attachment.execute(input, {
      instanceUrl: ORIGIN,
      accessToken: 'hidden-token',
    })
    expect(result).toEqual({
      kind: 'list',
      items: [{ id: ID, label: 'Quarterly review' }],
      nextCursor: '101',
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0][2]).toBe(input.signal)
    expect(JSON.stringify(result)).not.toContain('hidden-token')
    expect(JSON.stringify(result)).not.toContain('unprojected')
  })

  it('rejects invalid cursors before any request', async () => {
    const input = args()
    input.request = { kind: 'list', cursor: '1000001' }
    await expect(
      attachment.execute(input, { instanceUrl: ORIGIN, accessToken: 'hidden-token' })
    ).rejects.toThrow()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('returns null for an unavailable detail and sanitizes other provider errors', async () => {
    const input = args()
    input.request = { kind: 'detail', id: ID }
    mocks.request.mockRejectedValue(new OracleFusionProviderError('not found', 404))
    expect(
      await attachment.execute(input, { instanceUrl: ORIGIN, accessToken: 'hidden-token' })
    ).toEqual({ kind: 'detail', item: null })
    mocks.request.mockRejectedValue(new OracleFusionProviderError('private provider text', 500))
    await expect(
      attachment.execute(input, { instanceUrl: ORIGIN, accessToken: 'hidden-token' })
    ).rejects.not.toThrow('private provider text')
  })
})
