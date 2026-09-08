/**
 * @vitest-environment node
 */

import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { describe, expect, it } from 'vitest'
import { fileOperations } from '@/lib/workspace-files/application/operations'

describe('file operation registry', () => {
  it('keeps every workspace-key operation at or below the fixed write ceiling', () => {
    for (const operation of Object.values(fileOperations)) {
      expect(
        operation.principalKinds.length,
        `${operation.id} has no allowed principals`
      ).toBeGreaterThan(0)
      expect(
        new Set(operation.principalKinds).size,
        `${operation.id} repeats a principal kind`
      ).toBe(operation.principalKinds.length)
      expect(
        operation.principalKinds.includes('workspace_api_key'),
        `${operation.id} has inconsistent workspace API-key declarations`
      ).toBe(operation.workspaceApiKey === 'allow')

      if (operation.workspaceApiKey === 'allow') {
        expect(
          permissionSatisfies('write', operation.minimumRole),
          `${operation.id} exceeds the workspace API-key write ceiling`
        ).toBe(true)
      }
    }
  })

  it('uses unique stable operation IDs', () => {
    const ids = Object.values(fileOperations).map((operation) => operation.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('allows executor delegation only for operations used by the internal file tool', () => {
    const executorOperationIds = Object.values(fileOperations)
      .filter((operation) => operation.delegatedServices?.includes('executor'))
      .map((operation) => operation.id)

    expect(executorOperationIds).toEqual([
      'files.list',
      'files.read_metadata',
      'files.read_content',
      'files.search_content',
      'files.download',
      'files.create',
      'files.update_content',
      'files.move',
      'files.share.read',
      'files.share.update',
      'files.folders.list',
      'files.folders.create',
      'files.folders.update',
      'files.folders.delete',
      'files.folders.restore',
    ])
  })

  it('keeps external sharing policy changes human-delegated', () => {
    expect(fileOperations.updateShare.workspaceApiKey).toBe('deny')
    expect(fileOperations.updateShare.principalKinds).toEqual([
      'session',
      'personal_api_key',
      'oauth_access_token',
      'delegated',
    ])
    expect(fileOperations.updateShare.delegatedServices).toEqual(['copilot', 'executor'])
  })

  it('keeps resumable workspace-file uploads on credential-bound principals', () => {
    for (const operation of [
      fileOperations.uploadCreate,
      fileOperations.uploadParts,
      fileOperations.uploadComplete,
      fileOperations.uploadCancel,
    ]) {
      expect(operation.principalKinds).toEqual([
        'session',
        'personal_api_key',
        'oauth_access_token',
        'workspace_api_key',
      ])
      expect(operation.delegatedServices).toBeUndefined()
    }
  })

  /**
   * Extraction was widened from `['session']` to both API-key kinds. Nothing
   * else pins that, and the widening is only defensible while extraction grants
   * no capability `files.create` does not — so a role increase or a delegated
   * service added here has to be a deliberate edit.
   */
  it('keeps archive extraction at the write role for credential-bound principals', () => {
    expect(fileOperations.extractArchive).toMatchObject({
      id: 'files.extract_archive',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
    })
    expect(fileOperations.extractArchive.principalKinds).not.toContain('delegated')
    expect(fileOperations.extractArchive.delegatedServices).toBeUndefined()
    expect(Object.isFrozen(fileOperations.extractArchive)).toBe(true)
  })

  it('restricts compiled checks to authenticated sessions', () => {
    expect(fileOperations.compiledCheck).toMatchObject({
      id: 'files.compiled_check',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      principalKinds: ['session'],
    })
  })
})
