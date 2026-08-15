/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  forkForestNodeSchema,
  forkMappableResourceTypeSchema,
  forkMatrixRowSchema,
  getForkDiffContract,
  getWorkspaceBackgroundWorkQuerySchema,
  promoteForkBodySchema,
  updateForkExcludedWorkflowsBodySchema,
  updateForkMappingBodySchema,
} from '@/lib/api/contracts/workspace-fork'

describe('forkMappableResourceTypeSchema', () => {
  it('rejects the system-managed workflow type', () => {
    expect(forkMappableResourceTypeSchema.safeParse('workflow').success).toBe(false)
  })

  it('rejects knowledge_document (a document follows its parent knowledge base)', () => {
    expect(forkMappableResourceTypeSchema.safeParse('knowledge_document').success).toBe(false)
  })

  it('accepts user-mappable resource types', () => {
    for (const type of [
      'oauth_credential',
      'service_account_credential',
      'env_var',
      'table',
      'knowledge_base',
      'file',
      'mcp_server',
      'custom_tool',
      'skill',
    ]) {
      expect(forkMappableResourceTypeSchema.safeParse(type).success).toBe(true)
    }
  })
})

describe('forkForestNodeSchema', () => {
  const rootNode = {
    id: 'ws-1',
    name: 'Root',
    color: '#33C482',
    logoUrl: null,
    organizationId: null,
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    viewerAccessible: true,
    viewerCanAdmin: true,
    deployedWorkflowCount: 2,
    edge: null,
  }

  it('requires both permission flags, so a row can never render un-gated by accident', () => {
    const { viewerCanAdmin, ...withoutAdmin } = rootNode
    expect(forkForestNodeSchema.safeParse(withoutAdmin).success).toBe(false)
    const { viewerAccessible, ...withoutAccess } = rootNode
    expect(forkForestNodeSchema.safeParse(withoutAccess).success).toBe(false)
    expect(forkForestNodeSchema.safeParse(rootNode).success).toBe(true)
  })

  it('carries no edge on a root and a full edge on a fork', () => {
    expect(forkForestNodeSchema.parse(rootNode).edge).toBeNull()
    const fork = {
      ...rootNode,
      id: 'ws-2',
      parentId: 'ws-1',
      edge: {
        mapped: 3,
        unmapped: 1,
        lastSyncAt: '2026-01-02T00:00:00.000Z',
        undoableRun: { otherWorkspaceId: 'ws-1', otherName: 'Root', direction: 'push' },
      },
    }
    expect(forkForestNodeSchema.parse(fork).edge?.unmapped).toBe(1)
  })

  it('rejects an edge whose undoable run names an unknown direction', () => {
    const fork = {
      ...rootNode,
      parentId: 'ws-1',
      edge: {
        mapped: 0,
        unmapped: 0,
        lastSyncAt: null,
        undoableRun: { otherWorkspaceId: 'ws-1', otherName: 'Root', direction: 'sideways' },
      },
    }
    expect(forkForestNodeSchema.safeParse(fork).success).toBe(false)
  })
})

describe('forkMatrixRowSchema', () => {
  const row = {
    key: 'ws-1:env_var:API_KEY',
    resourceType: 'env_var',
    kind: 'env-var',
    originWorkspaceId: 'ws-1',
    label: 'API_KEY',
    cells: {
      'ws-1': { resourceId: 'API_KEY', label: 'API_KEY', missing: false },
      'ws-2': { resourceId: null, label: null, missing: false },
    },
  }

  it('accepts a chain whose downstream cell is unmapped', () => {
    expect(forkMatrixRowSchema.safeParse(row).success).toBe(true)
  })

  it('rejects a row typed as a system-managed resource, which is never user-mappable', () => {
    expect(forkMatrixRowSchema.safeParse({ ...row, resourceType: 'workflow' }).success).toBe(false)
  })
})

describe('getWorkspaceBackgroundWorkQuerySchema', () => {
  it('defaults the limit to 50 and clamps it to 1..100 (audit-log behavior)', () => {
    expect(getWorkspaceBackgroundWorkQuerySchema.parse({}).limit).toBe(50)
    expect(getWorkspaceBackgroundWorkQuerySchema.parse({ limit: '25' }).limit).toBe(25)
    expect(getWorkspaceBackgroundWorkQuerySchema.parse({ limit: '5000' }).limit).toBe(100)
    expect(getWorkspaceBackgroundWorkQuerySchema.parse({ limit: '-3' }).limit).toBe(1)
    expect(getWorkspaceBackgroundWorkQuerySchema.parse({ limit: 'garbage' }).limit).toBe(50)
  })

  it('treats the cursor as an optional opaque string', () => {
    expect(getWorkspaceBackgroundWorkQuerySchema.parse({}).cursor).toBeUndefined()
    expect(getWorkspaceBackgroundWorkQuerySchema.parse({ cursor: 'abc' }).cursor).toBe('abc')
  })
})

describe('updateForkMappingBodySchema', () => {
  const base = { otherWorkspaceId: 'ws-1', direction: 'push' as const }

  it('rejects a body that maps a workflow-type entry', () => {
    const result = updateForkMappingBodySchema.safeParse({
      ...base,
      entries: [{ resourceType: 'workflow', sourceId: 'wf-src', targetId: 'wf-tgt' }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts mappable entries, including a cleared (null target) mapping', () => {
    const result = updateForkMappingBodySchema.safeParse({
      ...base,
      entries: [
        { resourceType: 'env_var', sourceId: 'API_KEY', targetId: 'API_KEY' },
        { resourceType: 'oauth_credential', sourceId: 'cred-1', targetId: null },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an entry with an empty sourceId', () => {
    const result = updateForkMappingBodySchema.safeParse({
      ...base,
      entries: [{ resourceType: 'env_var', sourceId: '', targetId: 'API_KEY' }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional dependentValues, including cleared (empty-string) values', () => {
    const result = updateForkMappingBodySchema.safeParse({
      ...base,
      entries: [{ resourceType: 'oauth_credential', sourceId: 'cred-1', targetId: 'cred-2' }],
      dependentValues: [
        { workflowId: 'wf-1', blockId: 'block-1', subBlockKey: 'label', value: 'INBOX' },
        { workflowId: 'wf-1', blockId: 'block-2', subBlockKey: 'sheet', value: '' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a dependent value with an empty blockId or subBlockKey', () => {
    for (const entry of [
      { workflowId: 'wf-1', blockId: '', subBlockKey: 'label', value: 'INBOX' },
      { workflowId: 'wf-1', blockId: 'block-1', subBlockKey: '', value: 'INBOX' },
    ]) {
      const result = updateForkMappingBodySchema.safeParse({
        ...base,
        entries: [],
        dependentValues: [entry],
      })
      expect(result.success).toBe(false)
    }
  })
})

describe('updateForkExcludedWorkflowsBodySchema', () => {
  it('accepts a batch of workflow ids with the exclusion flag', () => {
    const parsed = updateForkExcludedWorkflowsBodySchema.parse({
      workflowIds: ['wf-1', 'wf-2'],
      forkSyncExcluded: true,
    })
    expect(parsed).toEqual({ workflowIds: ['wf-1', 'wf-2'], forkSyncExcluded: true })
  })

  it('rejects an empty id list, empty ids, and oversized batches', () => {
    expect(
      updateForkExcludedWorkflowsBodySchema.safeParse({ workflowIds: [], forkSyncExcluded: true })
        .success
    ).toBe(false)
    expect(
      updateForkExcludedWorkflowsBodySchema.safeParse({ workflowIds: [''], forkSyncExcluded: true })
        .success
    ).toBe(false)
    expect(
      updateForkExcludedWorkflowsBodySchema.safeParse({
        workflowIds: Array.from({ length: 1001 }, (_, index) => `wf-${index}`),
        forkSyncExcluded: false,
      }).success
    ).toBe(false)
  })

  it('requires the forkSyncExcluded flag', () => {
    expect(updateForkExcludedWorkflowsBodySchema.safeParse({ workflowIds: ['wf-1'] }).success).toBe(
      false
    )
  })
})

describe('getForkDiffContract response excluded-workflow lists', () => {
  const baseDiffResponse = {
    sourceWorkspaceId: 'ws-src',
    targetWorkspaceId: 'ws-tgt',
    willUpdate: 0,
    willCreate: 0,
    willArchive: 0,
    workflows: [],
    unmappedRequired: [],
    unmappedOptional: [],
    mcpReauthServerIds: [],
    inlineSecretSources: [],
    dependentReconfigs: [],
    resourceUsages: [],
    copyableUnmapped: [],
    clearedRefs: [],
  }

  it('defaults absent lists to empty (old-server tolerance)', () => {
    const parsed = getForkDiffContract.response.schema.parse(baseDiffResponse)
    expect(parsed.excludedSourceWorkflows).toEqual([])
    expect(parsed.excludedTargetWorkflows).toEqual([])
    expect(parsed.retiringTriggerUrls).toEqual([])
    expect(parsed.triggerMappings).toEqual([])
  })

  it('carries every trigger, whether or not its URL is up for decision', () => {
    const parsed = getForkDiffContract.response.schema.parse({
      ...baseDiffResponse,
      triggerMappings: [
        // Already serving a URL: informational, no choice offered.
        {
          sourceBlockId: 'blk-stable',
          blockName: 'Prod intake',
          workflowName: 'ITSM intake',
          ownPath: 'prod-live-path',
          adoptablePaths: [],
          defaultAdoptPath: null,
        },
        // Arriving without one, with a retiring URL it can take over.
        {
          sourceBlockId: 'blk-new',
          blockName: 'Slack messages',
          workflowName: 'ITSM intake',
          ownPath: null,
          adoptablePaths: ['live-slack-path'],
          defaultAdoptPath: 'live-slack-path',
        },
      ],
      retiringTriggerUrls: [{ workflowName: 'ITSM intake', path: 'dead-path' }],
    })
    expect(parsed.triggerMappings[0].ownPath).toBe('prod-live-path')
    expect(parsed.triggerMappings[0].adoptablePaths).toEqual([])
    expect(parsed.triggerMappings[1].defaultAdoptPath).toBe('live-slack-path')
    expect(parsed.retiringTriggerUrls[0].path).toBe('dead-path')
  })

  it('accepts a trigger mapping choice on the promote body, including "new URL"', () => {
    const parsed = promoteForkBodySchema.parse({
      otherWorkspaceId: 'ws-other',
      direction: 'push',
      triggerMappings: [
        { sourceBlockId: 'blk-a', adoptPath: 'keep-this-path' },
        { sourceBlockId: 'blk-b', adoptPath: null },
      ],
    })
    expect(parsed.triggerMappings).toEqual([
      { sourceBlockId: 'blk-a', adoptPath: 'keep-this-path' },
      { sourceBlockId: 'blk-b', adoptPath: null },
    ])
  })

  it('carries the lists when present', () => {
    const parsed = getForkDiffContract.response.schema.parse({
      ...baseDiffResponse,
      excludedSourceWorkflows: ['Scratch agent'],
      excludedTargetWorkflows: ['Prod hotfix'],
    })
    expect(parsed.excludedSourceWorkflows).toEqual(['Scratch agent'])
    expect(parsed.excludedTargetWorkflows).toEqual(['Prod hotfix'])
  })
})
