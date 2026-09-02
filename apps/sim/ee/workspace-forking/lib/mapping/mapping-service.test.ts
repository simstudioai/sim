/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkRemapKind } from '@/ee/workspace-forking/lib/remap/remap-references'

const {
  mockFilterExisting,
  mockGetCredentialProviders,
  mockGetEnvKeys,
  mockLoadLabels,
  mockListCandidates,
  mockClassifyCredential,
  mockListDeployedWorkflows,
  mockReadDeployedState,
  mockScanWorkflowReferences,
  mockDetectCascade,
} = vi.hoisted(() => ({
  mockFilterExisting: vi.fn(),
  mockGetCredentialProviders: vi.fn(),
  mockGetEnvKeys: vi.fn(),
  mockLoadLabels: vi.fn(),
  mockListCandidates: vi.fn(),
  mockClassifyCredential: vi.fn(),
  mockListDeployedWorkflows: vi.fn(),
  mockReadDeployedState: vi.fn(),
  mockScanWorkflowReferences: vi.fn(),
  mockDetectCascade: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/mapping/resources', () => ({
  listForkResourceCandidates: mockListCandidates,
  classifyCredentialResourceType: mockClassifyCredential,
  getWorkspaceEnvKeys: mockGetEnvKeys,
  filterExistingForkTargets: mockFilterExisting,
  getCredentialProvidersByIds: mockGetCredentialProviders,
  loadForkResourceLabels: mockLoadLabels,
  CANDIDATE_LIMIT: 1000,
}))

vi.mock('@/ee/workspace-forking/lib/copy/deploy-bridge', () => ({
  listDeployedWorkflows: mockListDeployedWorkflows,
  readDeployedState: mockReadDeployedState,
}))

vi.mock('@/ee/workspace-forking/lib/mapping/cascade', () => ({
  detectForkCascadeReferences: mockDetectCascade,
}))

vi.mock('@/ee/workspace-forking/lib/remap/remap-references', () => ({
  scanWorkflowReferences: mockScanWorkflowReferences,
}))

vi.mock('@/ee/workspace-forking/lib/remap/reference-scan', () => ({
  toScannerBlocks: vi.fn((state: unknown) => state),
}))

import { workflow, workspaceForkResourceMap } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'
import {
  findDuplicateTargetEntry,
  getForkMappingView,
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

  /**
   * A source credential that no longer exists is exactly what the mapping editor asks the user
   * to resolve (`sourceDeleted`), so the save must accept it - rejecting made it the one kind of
   * reference the UI told you to map and the server refused. Access propagation is not driven
   * from here: `propagateCredentialAccess` re-validates both sides inside the promote tx.
   */
  it('accepts a credential whose source no longer exists in the source workspace', async () => {
    mockFilterExisting.mockResolvedValue({ credential: new Set(['cred-tgt']) })
    mockGetCredentialProviders.mockImplementation(async (_db: unknown, workspaceId: string) =>
      workspaceId === 'ws-source'
        ? new Map<string, string | null>() // cred-deleted is gone from the source
        : new Map([['cred-tgt', 'google-email']])
    )
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'oauth_credential', sourceId: 'cred-deleted', targetId: 'cred-tgt' },
      ])
    ).resolves.toBeUndefined()
  })

  it('still rejects a target that does not exist, even when the source is gone', async () => {
    mockFilterExisting.mockResolvedValue({ credential: new Set<string>() })
    mockGetCredentialProviders.mockImplementation(async () => new Map<string, string | null>())
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'oauth_credential', sourceId: 'cred-deleted', targetId: 'cred-foreign' },
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

describe('getForkMappingView', () => {
  const edge = { parentWorkspaceId: 'ws-parent', childWorkspaceId: 'ws-child' } as never
  const emptyCandidates = {
    credential: [],
    'env-var': [],
    table: [],
    'knowledge-base': [],
    'mcp-server': [],
    'custom-tool': [],
    skill: [],
    'knowledge-document': [],
    file: [],
    'file-folder': [],
  }

  /** Pull: parent is the source, child the target — the direction the raw-id rows showed up in. */
  function pullView(overrides: { workflowRows?: unknown[] } = {}) {
    // The real `getEdgeMappingRows` runs; this row is the workflow identity pair it returns.
    queueTableRows(workspaceForkResourceMap, [
      {
        id: 'map-1',
        childWorkspaceId: 'ws-child',
        resourceType: 'workflow',
        parentResourceId: 'wf-parent',
        childResourceId: 'wf-child',
      },
    ])
    queueTableRows(
      workflow,
      overrides.workflowRows ?? [{ id: 'wf-child', forkSyncExcluded: false }]
    )
    return getForkMappingView({
      edge,
      sourceWorkspaceId: 'ws-parent',
      targetWorkspaceId: 'ws-child',
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetEnvKeys.mockResolvedValue(new Set<string>())
    mockListCandidates.mockResolvedValue(emptyCandidates)
    mockListDeployedWorkflows.mockResolvedValue([{ id: 'wf-parent', name: 'Prod' }])
    mockReadDeployedState.mockResolvedValue({ blocks: {} })
    mockScanWorkflowReferences.mockReturnValue({
      references: [
        { kind: 'table', sourceId: 'tbl_live', subBlockKey: 'tableSelector', required: false },
        { kind: 'table', sourceId: 'tbl_gone', subBlockKey: 'tableSelector', required: false },
      ],
    })
    mockDetectCascade.mockResolvedValue({ references: [] })
    mockFilterExisting.mockResolvedValue({})
    mockGetCredentialProviders.mockResolvedValue(new Map())
    mockClassifyCredential.mockResolvedValue('oauth_credential')
    mockLoadLabels.mockResolvedValue({ table: new Map([['tbl_live', 'Orders']]) })
  })

  it('labels a live source resource by name and flags a deleted one', async () => {
    const { entries } = await pullView()
    expect(entries).toEqual([
      expect.objectContaining({
        sourceId: 'tbl_live',
        sourceLabel: 'Orders',
        sourceDeleted: false,
      }),
      expect.objectContaining({
        sourceId: 'tbl_gone',
        sourceLabel: 'tbl_gone',
        sourceDeleted: true,
      }),
    ])
  })

  /**
   * The label lookup must be by exact id, never the display-capped candidate list — otherwise a
   * workspace past CANDIDATE_LIMIT renders live resources as raw ids, indistinguishable from
   * deleted ones. Pinned by asserting the exact ids are what gets looked up.
   */
  it('looks source labels up by exact id, not through the capped candidate list', async () => {
    await pullView()
    expect(mockLoadLabels).toHaveBeenCalledWith(expect.anything(), 'ws-parent', {
      table: new Set(['tbl_live', 'tbl_gone']),
    })
    expect(mockListCandidates).toHaveBeenCalledTimes(1)
    expect(mockListCandidates).toHaveBeenCalledWith(expect.anything(), 'ws-child')
  })

  it('skips a source workflow whose target is excluded from sync', async () => {
    const { entries } = await pullView({
      workflowRows: [{ id: 'wf-child', forkSyncExcluded: true }],
    })
    expect(entries).toEqual([])
    expect(mockReadDeployedState).not.toHaveBeenCalled()
  })

  it('still scans when the excluded flag is on an unrelated target workflow', async () => {
    const { entries } = await pullView({
      workflowRows: [
        { id: 'wf-child', forkSyncExcluded: false },
        { id: 'wf-other', forkSyncExcluded: true },
      ],
    })
    expect(entries).toHaveLength(2)
  })
})
