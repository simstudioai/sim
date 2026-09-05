/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { selectorManifest } from '@/lib/selectors/manifest'
import { oracleFusionRecruitingSelectorAttachments as attachments } from '@/lib/selectors/server/providers/oracle-fusion-recruiting'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const mocks = vi.hoisted(() => ({ bundle: vi.fn(), list: vi.fn(), get: vi.fn(), phones: vi.fn() }))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({ resolveSelectorCredentialBundle: mocks.bundle }))
vi.mock('@/lib/internal/oracle-fusion-recruiting/operations', () => ({
  executeListCandidates: mocks.list,
  executeGetCandidate: mocks.get,
  executeListCandidatePhones: mocks.phones,
}))
function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oracle_fusion_recruiting.candidates', context: { oauthCredential: 'credential-id' },
    request: { kind: 'list' }, scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1', principal: {} as never, requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-id', providerId: 'oracle-fusion-service-account' },
    references: new Map(),
    protectedValues: { add: vi.fn(), contains: vi.fn(), containsExceptExact: vi.fn() },
    ...overrides,
  }
}
describe('Recruiting selectors', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.bundle.mockResolvedValue({ accessToken: 'private-token', instanceUrl: 'https://example.fa.ocs.oraclecloud.com' })
    mocks.list.mockResolvedValue({ success: true, output: { candidates: [{ candidateNumber: '1', displayName: 'Taylor', accessToken: 'private-token' }], hasMore: true, nextOffset: 51 } })
  })
  it('binds every selector to Recruiting and its saved credential destination', () => {
    for (const [key, attachment] of Object.entries(attachments)) {
      expect(attachment.credential?.serviceIds).toEqual(['oracle_fusion_recruiting'])
      expect(attachment.integrationBlockTypes).toEqual(['oracle_fusion_recruiting'])
      expect(attachment.destination).toMatchObject({ kind: 'credential-bound' })
      expect(selectorManifest[key as keyof typeof attachments].listMode).toBe('paginated')
    }
  })
  it('projects safe options and forwards bounded pagination', async () => {
    const result = await attachments['oracle_fusion_recruiting.candidates'].execute(args({ request: { kind: 'list', cursor: '50' } }))
    expect(result).toEqual({ kind: 'list', items: [{ id: '1', label: 'Taylor' }], nextCursor: '51' })
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 50, accessToken: 'private-token', instanceUrl: 'https://example.fa.ocs.oraclecloud.com' }), undefined)
    expect(mocks.bundle).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'oracle-fusion-service-account' }))
  })
  it('requires candidate context before listing phones', async () => {
    await expect(attachments['oracle_fusion_recruiting.phones'].execute(args())).rejects.toThrow()
    expect(mocks.phones).not.toHaveBeenCalled()
  })
  it.each(['-1', '1e3', '9007199254740992'])('rejects invalid cursor %s', async (cursor) => {
    await expect(attachments['oracle_fusion_recruiting.candidates'].execute(args({ request: { kind: 'list', cursor } }))).rejects.toThrow()
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('represents a missing detail without inventing an option', async () => {
    mocks.get.mockRejectedValue(new OracleFusionProviderError('Not found', 404))
    expect(await attachments['oracle_fusion_recruiting.candidates'].execute(args({ request: { kind: 'detail', id: '1' } }))).toEqual({ kind: 'detail', item: null })
  })
  it('does not expose raw errors or credentials', async () => {
    mocks.list.mockRejectedValue(new Error('private-token'))
    await expect(attachments['oracle_fusion_recruiting.candidates'].execute(args())).rejects.not.toThrow('private-token')
  })
  it('stops aborted selector requests', async () => {
    await expect(attachments['oracle_fusion_recruiting.candidates'].execute(args({ signal: AbortSignal.abort() }))).rejects.toThrow()
    expect(mocks.bundle).not.toHaveBeenCalled()
  })
})
