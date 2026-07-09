/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkRemapKind } from '@/ee/workspace-forking/lib/remap/remap-references'

const { mockFilterExisting, mockGetCredentialProviders, mockGetEnvKeys } = vi.hoisted(() => ({
  mockFilterExisting: vi.fn(),
  mockGetCredentialProviders: vi.fn(),
  mockGetEnvKeys: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/mapping/resources', () => ({
  listForkResourceCandidates: vi.fn(),
  classifyCredentialResourceType: vi.fn(),
  getWorkspaceEnvKeys: mockGetEnvKeys,
  filterExistingForkTargets: mockFilterExisting,
  getCredentialProvidersByIds: mockGetCredentialProviders,
  CANDIDATE_LIMIT: 1000,
}))

import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'
import {
  findDuplicateTargetEntry,
  suggestTarget,
  validateForkMappingTargets,
} from '@/ee/workspace-forking/lib/mapping/mapping-service'
import type { ForkResourceCandidate } from '@/ee/workspace-forking/lib/mapping/resources'

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

  it('accepts a file target whose storage key exists in the target workspace', async () => {
    // Files are mappable like any other content kind; the target is the storage key, and
    // filterExistingForkTargets resolves file existence by key in the target workspace.
    mockFilterExisting.mockResolvedValue({ file: new Set(['workspace/DST/report.pdf']) })
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        {
          resourceType: 'file',
          sourceId: 'workspace/SRC/report.pdf',
          targetId: 'workspace/DST/report.pdf',
        },
      ])
    ).resolves.toBeUndefined()
  })

  it('rejects a file target whose storage key is missing in the target workspace', async () => {
    mockFilterExisting.mockResolvedValue({ file: new Set<string>() })
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        {
          resourceType: 'file',
          sourceId: 'workspace/SRC/report.pdf',
          targetId: 'workspace/DST/gone.pdf',
        },
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

describe('findDuplicateTargetEntry', () => {
  it('returns null when every target is used by at most one source', () => {
    expect(
      findDuplicateTargetEntry([
        { resourceType: 'oauth_credential', sourceId: 'c1', targetId: 't1' },
        { resourceType: 'oauth_credential', sourceId: 'c2', targetId: 't2' },
      ])
    ).toBeNull()
  })

  it('flags two distinct sources mapped to the same target', () => {
    expect(
      findDuplicateTargetEntry([
        { resourceType: 'oauth_credential', sourceId: 'c1', targetId: 'shared' },
        { resourceType: 'oauth_credential', sourceId: 'c2', targetId: 'shared' },
      ])
    ).toEqual({ resourceType: 'oauth_credential', targetId: 'shared' })
  })

  it('ignores cleared (null target) entries', () => {
    expect(
      findDuplicateTargetEntry([
        { resourceType: 'oauth_credential', sourceId: 'c1', targetId: null },
        { resourceType: 'oauth_credential', sourceId: 'c2', targetId: null },
      ])
    ).toBeNull()
  })

  it('does not flag the same source+target repeated', () => {
    expect(
      findDuplicateTargetEntry([
        { resourceType: 'table', sourceId: 'c1', targetId: 't1' },
        { resourceType: 'table', sourceId: 'c1', targetId: 't1' },
      ])
    ).toBeNull()
  })

  it('does not conflate the same target id across resource types', () => {
    expect(
      findDuplicateTargetEntry([
        { resourceType: 'oauth_credential', sourceId: 'c1', targetId: 'same' },
        { resourceType: 'table', sourceId: 'c2', targetId: 'same' },
      ])
    ).toBeNull()
  })
})

describe('suggestTarget', () => {
  const cand = (id: string, label: string, providerId?: string): ForkResourceCandidate => ({
    id,
    label,
    providerId,
  })

  it('disambiguates same-name credentials by matching the source provider', () => {
    const target = suggestTarget('credential', 'Work', 'google-email', [
      cand('c1', 'Work', 'google-calendar'),
      cand('c2', 'Work', 'google-email'),
    ])
    expect(target).toBe('c2')
  })

  it('suggests a unique name match for a non-credential kind', () => {
    expect(
      suggestTarget('table', 'Orders', undefined, [cand('t1', 'Orders'), cand('t2', 'Other')])
    ).toBe('t1')
  })

  it('returns null when the name is ambiguous (two same-name candidates)', () => {
    expect(
      suggestTarget('table', 'Dup', undefined, [cand('t1', 'Dup'), cand('t2', 'Dup')])
    ).toBeNull()
  })

  it('returns null when no candidate name matches', () => {
    expect(suggestTarget('table', 'Orders', undefined, [cand('t1', 'Other')])).toBeNull()
  })

  it('matches the name case- and whitespace-insensitively', () => {
    expect(suggestTarget('table', '  Orders  ', undefined, [cand('t1', 'orders')])).toBe('t1')
  })
})
