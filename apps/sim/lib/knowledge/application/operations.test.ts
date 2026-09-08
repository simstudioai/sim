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
      'knowledge.restore',
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
      'knowledge.tags.bulk_save',
      'knowledge.tags.cleanup',
      'knowledge.connectors.list',
      'knowledge.connectors.read',
      'knowledge.connectors.create',
      'knowledge.connectors.update',
      'knowledge.connectors.access.update',
      'knowledge.search.sources.list',
      'knowledge.search.integrations.list',
      'knowledge.search.integrations.approve',
      'knowledge.connectors.members.list',
      'knowledge.connectors.members.enroll',
      'knowledge.simSearch.connect',
      'knowledge.search.sources.connectApproved',
      'knowledge.search.index.read',
      'knowledge.search.sources.prepare',
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

  it('uses the same semantic IDs and permission-group capabilities for organization access', () => {
    for (const operation of Object.values(knowledgeOperations)) {
      expect(operation.organizationOperation.id).toBe(operation.id)
      expect(operation.organizationOperation.capability).toBe(operation.capability)
      expect(operation.organizationOperation.principalKinds).not.toContain('workspace_api_key')
      expect(operation.organizationOperation.principalKinds).not.toContain('delegated')
      expect(operation.organizationOperation.principalKinds).not.toContain('system')
      expect(Object.isFrozen(operation.organizationOperation)).toBe(true)
      expect(Object.isFrozen(operation)).toBe(true)
    }
  })

  it('requires organization admin authority for writes while allowing members to search and enroll', () => {
    for (const operation of [
      knowledgeOperations.create,
      knowledgeOperations.update,
      knowledgeOperations.delete,
      knowledgeOperations.uploadDocument,
      knowledgeOperations.prepareSearchSource,
      knowledgeOperations.updateConnectorAccess,
    ]) {
      expect(operation.organizationOperation.minimumRole).toBe('admin')
      expect(operation.organizationOperation.principalKinds).toEqual([
        'session',
        'personal_api_key',
        'oauth_access_token',
      ])
      expect(operation.organizationOperation.oauthScope).toBe('api:write')
      expect(operation.organizationOperation.delegationAudience).toBeUndefined()
    }
    for (const operation of [
      knowledgeOperations.search,
      knowledgeOperations.readSearchIndex,
      knowledgeOperations.enrollConnectorMember,
      knowledgeOperations.simSearchConnect,
    ]) {
      expect(operation.organizationOperation.minimumRole).toBe('member')
    }
  })

  it('permits organization delegation only for Copilot reads', () => {
    for (const operation of Object.values(knowledgeOperations)) {
      if (!operation.organizationOperation.principalKinds.includes('organization_delegated'))
        continue
      expect(operation.minimumRole).toBe('read')
      expect(operation.delegatedServices).toContain('copilot')
      expect(operation.organizationOperation.delegationAudience).toBe('sim:knowledge')
    }
    expect(knowledgeOperations.search.organizationOperation.principalKinds).toContain(
      'organization_delegated'
    )
    expect(knowledgeOperations.readDocument.organizationOperation.principalKinds).toContain(
      'organization_delegated'
    )
    expect(knowledgeOperations.listFolders.organizationOperation.principalKinds).not.toContain(
      'organization_delegated'
    )
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

  /**
   * Archive, restore, and the list that discovers archived rows are one
   * recoverable loop. A principal that may run the first two but not the third
   * can restore only the ids it recorded before archiving, so the discovery read
   * — `knowledge.list`, which serves `scope=archived` too — carries the policy of
   * the writes it exists to serve.
   */
  it('keeps the archived list reachable by every principal that may archive and restore', () => {
    expect(knowledgeOperations.list.workspaceApiKey).toBe(
      knowledgeOperations.restore.workspaceApiKey
    )
    expect(knowledgeOperations.list.principalKinds).toEqual(
      knowledgeOperations.restore.principalKinds
    )
    expect(knowledgeOperations.list.principalKinds).toContain('workspace_api_key')
    expect(
      permissionSatisfies(
        knowledgeOperations.restore.minimumRole,
        knowledgeOperations.list.minimumRole
      )
    ).toBe(true)
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

  it('withholds knowledge base creation separately from using existing ones', () => {
    expect(knowledgeOperations.create.capability).toBe('knowledge.create')
    for (const operation of [
      knowledgeOperations.list,
      knowledgeOperations.read,
      knowledgeOperations.search,
      knowledgeOperations.update,
      knowledgeOperations.delete,
      knowledgeOperations.createFolder,
      knowledgeOperations.createTag,
      knowledgeOperations.createConnector,
    ]) {
      expect(operation.capability).toBe('knowledge.use')
    }
  })

  it('withholds every path that carries caller-supplied document bytes', () => {
    for (const operation of [
      knowledgeOperations.uploadDocument,
      knowledgeOperations.uploadCreate,
      knowledgeOperations.uploadParts,
      knowledgeOperations.uploadComplete,
      knowledgeOperations.uploadCancel,
    ]) {
      expect(operation.capability).toBe('knowledge.upload')
    }
  })

  it('leaves the connector sync path on the shared knowledge capability', () => {
    /** A connector's documents are the sanctioned source, so an upload ban must not reach them. */
    for (const operation of [
      knowledgeOperations.syncConnector,
      knowledgeOperations.updateConnectorDocuments,
      knowledgeOperations.addWorkspaceFiles,
    ]) {
      expect(operation.capability).toBe('knowledge.use')
    }
  })
})
