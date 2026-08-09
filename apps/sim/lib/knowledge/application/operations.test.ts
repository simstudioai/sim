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
      'knowledge.documents.update',
      'knowledge.documents.bulk',
      'knowledge.chunks.list',
      'knowledge.chunks.read',
      'knowledge.chunks.create',
      'knowledge.chunks.update',
      'knowledge.chunks.delete',
      'knowledge.chunks.bulk',
      'knowledge.tags.list',
      'knowledge.tags.create',
      'knowledge.tags.update',
      'knowledge.tags.delete',
      'knowledge.tags.read_usage',
      'knowledge.tags.read_detailed_usage',
      'knowledge.tags.read_next_slot',
      'knowledge.tags.save_document_definitions',
      'knowledge.tags.delete_document_definitions',
      'knowledge.connectors.list',
      'knowledge.connectors.read',
      'knowledge.connectors.create',
      'knowledge.connectors.update',
      'knowledge.connectors.delete',
      'knowledge.connectors.sync',
      'knowledge.connectors.documents.list',
      'knowledge.connectors.documents.update',
      'knowledge.documents.upload.create',
      'knowledge.documents.upload.parts',
      'knowledge.documents.upload.complete',
      'knowledge.documents.upload.cancel',
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps workspace keys within their fixed write ceiling', () => {
    const workspaceKeyOperations = Object.values(knowledgeOperations).filter(
      (operation) => operation.workspaceApiKey === 'allow'
    )
    for (const operation of workspaceKeyOperations) {
      expect(operation.workspaceApiKey).toBe('allow')
      expect(operation.principalKinds).toContain('workspace_api_key')
      expect(permissionSatisfies('write', operation.minimumRole)).toBe(true)
    }
  })

  it('keeps Copilot-only tag, connector, and document-update operations off workspace keys', () => {
    const operations = [
      knowledgeOperations.updateDocument,
      knowledgeOperations.listTags,
      knowledgeOperations.createTag,
      knowledgeOperations.updateTag,
      knowledgeOperations.deleteTag,
      knowledgeOperations.readTagUsage,
      knowledgeOperations.createConnector,
      knowledgeOperations.updateConnector,
      knowledgeOperations.deleteConnector,
      knowledgeOperations.syncConnector,
    ]
    for (const operation of operations) {
      expect(operation.workspaceApiKey).toBe('deny')
      expect(operation.principalKinds).not.toContain('workspace_api_key')
      expect(operation.principalKinds).toContain('delegated')
    }
  })

  it('allows delegated callers only on semantic knowledge and document operations', () => {
    expect(knowledgeOperations.list.principalKinds).toContain('delegated')
    expect(knowledgeOperations.search.principalKinds).toContain('delegated')
    expect(knowledgeOperations.uploadDocument.principalKinds).toContain('delegated')
    expect(knowledgeOperations.updateDocument.principalKinds).toContain('delegated')
    expect(knowledgeOperations.updateTag.principalKinds).toContain('delegated')
    expect(knowledgeOperations.syncConnector.principalKinds).toContain('delegated')
    expect(knowledgeOperations.listFolders.principalKinds).not.toContain('delegated')
    expect(knowledgeOperations.uploadComplete.principalKinds).not.toContain('delegated')
    expect(knowledgeOperations.list.delegatedServices).toEqual(['copilot'])
    expect(knowledgeOperations.search.delegatedServices).toEqual(['copilot', 'executor'])
    expect(knowledgeOperations.uploadComplete.delegatedServices).toBeUndefined()
  })
})
