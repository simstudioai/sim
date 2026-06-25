/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkRemapKind } from '@/lib/workspaces/fork/remap/remap-references'

const { mockListForkResourceCandidates } = vi.hoisted(() => ({
  mockListForkResourceCandidates: vi.fn(),
}))

vi.mock('@/lib/workspaces/fork/mapping/resources', () => ({
  listForkResourceCandidates: mockListForkResourceCandidates,
  classifyCredentialResourceType: vi.fn(),
  getWorkspaceEnvKeys: vi.fn(),
}))

import { ForkError } from '@/lib/workspaces/fork/lineage/authz'
import { validateForkMappingTargets } from '@/lib/workspaces/fork/mapping/mapping-service'

const emptyCandidates: Record<ForkRemapKind, Array<{ id: string; label: string }>> = {
  credential: [],
  'env-var': [],
  table: [],
  'knowledge-base': [],
  'knowledge-document': [],
  file: [],
  'mcp-server': [],
  'custom-tool': [],
  skill: [],
}

describe('validateForkMappingTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListForkResourceCandidates.mockResolvedValue(emptyCandidates)
  })

  it('rejects a workflow-type entry with a target (identity is system-managed)', async () => {
    await expect(
      validateForkMappingTargets('ws-target', [
        { resourceType: 'workflow', sourceId: 'wf-src', targetId: 'wf-tgt' },
      ])
    ).rejects.toBeInstanceOf(ForkError)
  })

  it('short-circuits without querying candidates when no entry has a target', async () => {
    await expect(
      validateForkMappingTargets('ws-target', [
        { resourceType: 'env_var', sourceId: 'API_KEY', targetId: null },
      ])
    ).resolves.toBeUndefined()
    expect(mockListForkResourceCandidates).not.toHaveBeenCalled()
  })

  it('accepts a mappable entry whose target is a valid candidate', async () => {
    mockListForkResourceCandidates.mockResolvedValue({
      ...emptyCandidates,
      'env-var': [{ id: 'API_KEY', label: 'API_KEY' }],
    })
    await expect(
      validateForkMappingTargets('ws-target', [
        { resourceType: 'env_var', sourceId: 'API_KEY', targetId: 'API_KEY' },
      ])
    ).resolves.toBeUndefined()
  })

  it('rejects a mappable entry whose target is not a candidate in the target workspace', async () => {
    await expect(
      validateForkMappingTargets('ws-target', [
        { resourceType: 'env_var', sourceId: 'API_KEY', targetId: 'not-in-target' },
      ])
    ).rejects.toBeInstanceOf(ForkError)
  })
})
