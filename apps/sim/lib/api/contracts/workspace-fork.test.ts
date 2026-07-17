/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  forkLineageChildSchema,
  forkLineageNodeSchema,
  forkMappableResourceTypeSchema,
  getWorkspaceBackgroundWorkQuerySchema,
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

describe('forkLineageNodeSchema', () => {
  const baseNode = { id: 'ws-1', name: 'Parent', organizationId: null }

  it('requires viewerAccessible on every node (both accessible and inaccessible parse)', () => {
    expect(forkLineageNodeSchema.safeParse(baseNode).success).toBe(false)
    expect(forkLineageNodeSchema.safeParse({ ...baseNode, viewerAccessible: true }).success).toBe(
      true
    )
    expect(forkLineageNodeSchema.safeParse({ ...baseNode, viewerAccessible: false }).success).toBe(
      true
    )
  })

  it('requires viewerAccessible on child nodes too', () => {
    const child = { ...baseNode, createdAt: '2026-01-01T00:00:00.000Z' }
    expect(forkLineageChildSchema.safeParse(child).success).toBe(false)
    expect(forkLineageChildSchema.safeParse({ ...child, viewerAccessible: false }).success).toBe(
      true
    )
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
