import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkRemapKind } from '@/lib/workflows/references/remap-references'

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

vi.mock('@/lib/workflows/references/resources', () => ({
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

vi.mock('@/lib/workflows/references/remap-references', () => ({
  scanWorkflowReferences: mockScanWorkflowReferences,
}))

vi.mock('@/lib/workflows/references/reference-scan', () => ({
  toScannerBlocks: vi.fn((state: unknown) => state),
}))

import type { ForkResourceCandidate } from '@/lib/workflows/references/resources'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'
import {
  findDuplicateTargetEntry,
  suggestTarget,
  validateForkMappingTargets,
} from '@/ee/workspace-forking/lib/mapping/mapping-service'

type ExistingByKind = Partial<Record<ForkRemapKind, Set<string>>>

describe('validateForkMappingTargets', () => {
  beforeEach(() => {
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

  it('rejects an env-var whose target key is not in the target workspace', async () => {
    mockGetEnvKeys.mockResolvedValue(new Set())
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'env_var', sourceId: 'API_KEY', targetId: 'missing' },
      ])
    ).rejects.toBeInstanceOf(ForkError)
  })

  it('rejects a target that does not exist in the target workspace', async () => {
    mockFilterExisting.mockResolvedValue({ table: new Set<string>() })
    await expect(
      validateForkMappingTargets('ws-source', 'ws-target', [
        { resourceType: 'table', sourceId: 'table-src', targetId: 'table-gone' },
      ])
    ).rejects.toBeInstanceOf(ForkError)
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
  it('flags two distinct sources mapped to the same target', () => {
    expect(
      findDuplicateTargetEntry([
        { resourceType: 'oauth_credential', sourceId: 'c1', targetId: 'shared' },
        { resourceType: 'oauth_credential', sourceId: 'c2', targetId: 'shared' },
      ])
    ).toEqual({ resourceType: 'oauth_credential', targetId: 'shared' })
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
    const target = suggestTarget('credential', 'source-credential', 'Work', 'google-email', [
      cand('c1', 'Work', 'google-calendar'),
      cand('c2', 'Work', 'google-email'),
    ])
    expect(target).toBe('c2')
  })

  it('matches file folders by canonical path instead of a colliding display label', () => {
    expect(
      suggestTarget('file-folder', '/Team%2FDocs', 'Team / Docs', undefined, [
        cand('/Team/Docs', 'Team / Docs'),
        cand('/Team%2FDocs', 'Team / Docs'),
      ])
    ).toBe('/Team%2FDocs')
  })
})
