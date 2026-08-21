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
      'knowledge.list_archived',
      'knowledge.read',
      'knowledge.create',
      'knowledge.update',
      'knowledge.delete',
      'knowledge.bulk_move_items',
      'knowledge.bulk_delete_items',
      'knowledge.bulk_delete',
      'knowledge.vfs.rename',
      'knowledge.vfs.move',
      'knowledge.vfs.folders.manage',
      'knowledge.vfs.delete',
      'knowledge.search',
      'knowledge.folders.list',
      'knowledge.folders.create',
      'knowledge.folders.relocate',
      'knowledge.folders.delete',
      'knowledge.documents.list',
      'knowledge.documents.read',
      'knowledge.documents.upload',
      'knowledge.documents.add_workspace_files',
      'knowledge.documents.delete',
      'knowledge.documents.bulk_delete',
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

  /**
   * Reading the tag vocabulary is the one tag operation a workspace key may
   * perform. It is required input for the tag-name filters on document listing
   * and on search, both of which a workspace key can already run, so it carries
   * the policy of those sibling reads. Every tag *write* stays human-delegated.
   */
  it('lets a workspace key read the tag vocabulary, exactly like its sibling knowledge reads', () => {
    expect(knowledgeOperations.listTags.workspaceApiKey).toBe('allow')
    expect(knowledgeOperations.listTags.principalKinds).toContain('workspace_api_key')
    expect(knowledgeOperations.listTags.minimumRole).toBe(
      knowledgeOperations.listDocuments.minimumRole
    )
    expect(knowledgeOperations.listTags.workspaceApiKey).toBe(
      knowledgeOperations.listDocuments.workspaceApiKey
    )
  })

  it('keeps human-delegated tag, connector, and composed document operations off workspace keys', () => {
    const operations = [
      knowledgeOperations.updateDocument,
      knowledgeOperations.addWorkspaceFiles,
      knowledgeOperations.bulkDeleteDocuments,
      knowledgeOperations.createTag,
      knowledgeOperations.updateTag,
      knowledgeOperations.deleteTag,
      knowledgeOperations.readTagUsage,
      knowledgeOperations.listConnectors,
      knowledgeOperations.readConnector,
      knowledgeOperations.createConnector,
      knowledgeOperations.updateConnector,
      knowledgeOperations.deleteConnector,
      knowledgeOperations.syncConnector,
      knowledgeOperations.listConnectorDocuments,
      knowledgeOperations.updateConnectorDocuments,
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
