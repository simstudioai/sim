import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { describe, expect, it } from 'vitest'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

describe('knowledge operation registry', () => {
  it('limits Slack member delegation to the existing search operation', () => {
    const allowed = Object.values(knowledgeOperations).filter((operation) =>
      operation.organizationOperation.delegatedServices?.includes('slack-search')
    )
    expect(allowed).toEqual([knowledgeOperations.search])
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

  it('requires organization admin authority for writes while allowing members to search and enroll', () => {
    for (const operation of [
      knowledgeOperations.create,
      knowledgeOperations.update,
      knowledgeOperations.delete,
      knowledgeOperations.uploadDocument,
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
      knowledgeOperations.listPersonalSourceSetupAccounts,
      knowledgeOperations.personalSourceSetup,
    ]) {
      expect(operation.organizationOperation.minimumRole).toBe('member')
    }
  })

  it('limits personal source setup to the signed-in member without delegating credential discovery', () => {
    for (const operation of [
      knowledgeOperations.listPersonalSourceSetupAccounts,
      knowledgeOperations.personalSourceSetup,
    ]) {
      expect(operation.principalKinds).toEqual(['session'])
      expect(operation.organizationOperation.principalKinds).not.toContain('organization_delegated')
      expect(operation.workspaceApiKey).toBe('deny')
      expect(operation.capability).toBe('knowledge.use')
    }
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
})
