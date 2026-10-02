/** @vitest-environment node */
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rows: vi.fn(), deployed: vi.fn(), candidates: vi.fn() }))
vi.mock('@sim/db', () => ({ db: { select: () => ({ from: () => ({ where: async () => [] }) }) } }))
vi.mock('@/lib/workflows/references/resources', () => ({
  CANDIDATE_LIMIT: 1000,
  getWorkspaceEnvKeys: async () => new Set(['PARENT_TOKEN', 'CHILD_TOKEN']),
  listForkResourceCandidates: mocks.candidates,
  loadForkResourceLabels: async () => ({}),
  getCredentialProvidersByIds: async () => new Map(),
  filterExistingForkTargets: async () => ({}),
  classifyCredentialResourceType: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/copy/deploy-bridge', () => ({
  listDeployedWorkflows: mocks.deployed,
  readDeployedState: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/cascade', () => ({
  detectForkCascadeReferences: async () => ({ references: [] }),
}))
vi.mock('@/lib/workflows/references/reference-scan', () => ({ toScannerBlocks: vi.fn() }))
vi.mock('@/lib/workflows/references/remap-references', () => ({ scanWorkflowReferences: vi.fn() }))
vi.mock('@/ee/workspace-forking/lib/promote/promote-plan', () => ({
  resolveForkExcludedTargetId: vi.fn(),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => ({
  getEdgeMappingRows: mocks.rows,
  resourceTypeToForkKind: (type: string) => (type === 'env_var' ? 'env-var' : null),
  nonCredentialForkKindToResourceType: () => 'env_var',
  buildForkResolver: (_rows: unknown, options: { sourceIsParent: boolean }) => () =>
    options.sourceIsParent ? 'CHILD_TOKEN' : 'PARENT_TOKEN',
}))

import { getForkMappingView } from '@/ee/workspace-forking/lib/mapping/mapping-service'

const edge = { parentWorkspaceId: 'parent', childWorkspaceId: 'child' }
beforeEach(() => {
  mocks.deployed.mockResolvedValue([])
  mocks.rows.mockResolvedValue([
    { resourceType: 'env_var', parentResourceId: 'PARENT_TOKEN', childResourceId: 'CHILD_TOKEN' },
    { resourceType: 'workflow', parentResourceId: 'wf-parent', childResourceId: 'wf-child' },
  ])
  mocks.candidates.mockResolvedValue({
    'env-var': [
      { id: 'PARENT_TOKEN', label: 'PARENT_TOKEN' },
      { id: 'CHILD_TOKEN', label: 'CHILD_TOKEN' },
    ],
  })
})
it('keeps the default sync view empty without deployed references', async () => {
  const result = await getForkMappingView({
    edge,
    sourceWorkspaceId: 'parent',
    targetWorkspaceId: 'child',
  })
  expect(result.entries).toEqual([])
})
it.each([
  ['parent', 'child', 'PARENT_TOKEN', 'CHILD_TOKEN'],
  ['child', 'parent', 'CHILD_TOKEN', 'PARENT_TOKEN'],
])(
  'shows saved mappings with no deployments from %s to %s',
  async (sourceWorkspaceId, targetWorkspaceId, sourceId, targetId) => {
    const result = await getForkMappingView({
      edge,
      sourceWorkspaceId,
      targetWorkspaceId,
      scope: 'all',
    })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      sourceId,
      targetId,
      required: false,
      suggested: false,
    })
  }
)
