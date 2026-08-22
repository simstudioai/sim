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
      'files.read_metadata',
      'files.read_content',
      'files.download',
      'files.create',
      'files.update_content',
      'files.move',
      'files.share.update',
      'files.folders.create',
    ])
  })

  it('keeps external sharing policy changes human-delegated', () => {
    expect(fileOperations.updateShare.workspaceApiKey).toBe('deny')
    expect(fileOperations.updateShare.principalKinds).toEqual([
      'session',
      'personal_api_key',
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
      expect(operation.principalKinds).toEqual(['session', 'personal_api_key', 'workspace_api_key'])
      expect(operation.delegatedServices).toBeUndefined()
    }
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
