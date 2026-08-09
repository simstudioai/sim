/**
 * @vitest-environment node
 */

import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { describe, expect, it } from 'vitest'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

describe('knowledge operation registry', () => {
  it('defines unique stable semantic operation IDs', () => {
    const ids = Object.values(knowledgeOperations).map((operation) => operation.id)
    expect(ids).toEqual([
      'knowledge.list',
      'knowledge.read',
      'knowledge.create',
      'knowledge.update',
      'knowledge.delete',
      'knowledge.search',
      'knowledge.folders.list',
      'knowledge.folders.create',
      'knowledge.folders.relocate',
      'knowledge.folders.delete',
      'knowledge.documents.list',
      'knowledge.documents.read',
      'knowledge.documents.upload',
      'knowledge.documents.delete',
      'knowledge.documents.upload.create',
      'knowledge.documents.upload.parts',
      'knowledge.documents.upload.complete',
      'knowledge.documents.upload.cancel',
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps workspace keys within their fixed write ceiling', () => {
    for (const operation of Object.values(knowledgeOperations)) {
      expect(operation.workspaceApiKey).toBe('allow')
      expect(operation.principalKinds).toContain('workspace_api_key')
      expect(permissionSatisfies('write', operation.minimumRole)).toBe(true)
    }
  })

  it('allows delegated callers only on semantic knowledge and document operations', () => {
    expect(knowledgeOperations.list.principalKinds).toContain('delegated')
    expect(knowledgeOperations.search.principalKinds).toContain('delegated')
    expect(knowledgeOperations.uploadDocument.principalKinds).toContain('delegated')
    expect(knowledgeOperations.listFolders.principalKinds).not.toContain('delegated')
    expect(knowledgeOperations.uploadComplete.principalKinds).not.toContain('delegated')
    expect(knowledgeOperations.list.delegatedServices).toEqual(['copilot'])
    expect(knowledgeOperations.uploadComplete.delegatedServices).toBeUndefined()
  })
})
