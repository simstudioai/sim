/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkRemapKind } from '@/lib/workspaces/fork/remap/remap-references'

const { mockFilterExisting, mockGetCredentialProviders, mockGetEnvKeys } = vi.hoisted(() => ({
  mockFilterExisting: vi.fn(),
  mockGetCredentialProviders: vi.fn(),
  mockGetEnvKeys: vi.fn(),
}))

vi.mock('@/lib/workspaces/fork/mapping/resources', () => ({
  listForkResourceCandidates: vi.fn(),
  classifyCredentialResourceType: vi.fn(),
  getWorkspaceEnvKeys: mockGetEnvKeys,
  filterExistingForkTargets: mockFilterExisting,
  getCredentialProvidersByIds: mockGetCredentialProviders,
  CANDIDATE_LIMIT: 1000,
}))

import { ForkError } from '@/lib/workspaces/fork/lineage/authz'
import { validateForkMappingTargets } from '@/lib/workspaces/fork/mapping/mapping-service'

type ExistingByKind = Partial<Record<ForkRemapKind, Set<string>>>

describe('validateForkMappingTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFilterExisting.mockResolvedValue({} as ExistingByKind)
    mockGetEnvKeys.mockResolvedValue(new Set<string>())
    mockGetCredentialProviders.mockResolvedValue(new Map<string, string | null>())
  })

  it('rejects a workflow-type entry with a target (identity is system-managed)', async () => {
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'workflow', sourceId: 'wf-src', targetId: 'wf-tgt' },
      ])
    ).rejects.toBeInstanceOf(ForkError)
  })

  it('short-circuits without querying when no entry has a target', async () => {
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'env_var', sourceId: 'API_KEY', targetId: null },
      ])
    ).resolves.toBeUndefined()
    expect(mockFilterExisting).not.toHaveBeenCalled()
    expect(mockGetEnvKeys).not.toHaveBeenCalled()
  })

  it('accepts an env-var whose target key exists in the target workspace', async () => {
    mockGetEnvKeys.mockResolvedValue(new Set(['API_KEY']))
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'env_var', sourceId: 'API_KEY', targetId: 'API_KEY' },
      ])
    ).resolves.toBeUndefined()
  })

  it('rejects an env-var whose target key is not in the target workspace', async () => {
    mockGetEnvKeys.mockResolvedValue(new Set())
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'env_var', sourceId: 'API_KEY', targetId: 'missing' },
      ])
    ).rejects.toBeInstanceOf(ForkError)
  })

  it('accepts a target validated by exact id even when picker lists are capped', async () => {
    // filterExistingForkTargets checks by exact id (cap-free), so a target that would
    // sit past the candidate cap still validates.
    mockFilterExisting.mockResolvedValue({ table: new Set(['table-1001']) })
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'table', sourceId: 'table-src', targetId: 'table-1001' },
      ])
    ).resolves.toBeUndefined()
  })

  it('rejects a target that does not exist in the target workspace', async () => {
    mockFilterExisting.mockResolvedValue({ table: new Set<string>() })
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'table', sourceId: 'table-src', targetId: 'table-gone' },
      ])
    ).rejects.toBeInstanceOf(ForkError)
  })

  it('rejects a credential whose target provider differs from the source provider', async () => {
    mockFilterExisting.mockResolvedValue({ credential: new Set(['cred-tgt']) })
    mockGetCredentialProviders.mockImplementation(async (_db: unknown, workspaceId: string) =>
      workspaceId === 'ws-source'
        ? new Map([['cred-src', 'google-email']])
        : new Map([['cred-tgt', 'google-calendar']])
    )
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'oauth_credential', sourceId: 'cred-src', targetId: 'cred-tgt' },
      ])
    ).rejects.toBeInstanceOf(ForkError)
  })

  it('accepts a credential whose target provider matches the source provider', async () => {
    mockFilterExisting.mockResolvedValue({ credential: new Set(['cred-tgt']) })
    mockGetCredentialProviders.mockImplementation(async (_db: unknown, workspaceId: string) =>
      workspaceId === 'ws-source'
        ? new Map([['cred-src', 'google-email']])
        : new Map([['cred-tgt', 'google-email']])
    )
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'oauth_credential', sourceId: 'cred-src', targetId: 'cred-tgt' },
      ])
    ).resolves.toBeUndefined()
  })

  it('rejects a credential whose source is not a credential in the source workspace', async () => {
    mockFilterExisting.mockResolvedValue({ credential: new Set(['cred-tgt']) })
    mockGetCredentialProviders.mockImplementation(async (_db: unknown, workspaceId: string) =>
      workspaceId === 'ws-source'
        ? new Map<string, string | null>() // cred-foreign is not in the source
        : new Map([['cred-tgt', 'google-email']])
    )
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'oauth_credential', sourceId: 'cred-foreign', targetId: 'cred-tgt' },
      ])
    ).rejects.toBeInstanceOf(ForkError)
  })
})
