/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  forkMappableResourceTypeSchema,
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
})
