/**
 * @vitest-environment node
 */

import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { describe, expect, it } from 'vitest'
import { tableOperations } from '@/lib/table/application/operations'

describe('table operation registry', () => {
  it('uses unique stable operation IDs with non-empty principal policies', () => {
    const operations = Object.values(tableOperations)
    const ids = operations.map((operation) => operation.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const operation of operations) {
      expect(
        operation.principalKinds.length,
        `${operation.id} has no allowed principals`
      ).toBeGreaterThan(0)
      expect(
        new Set(operation.principalKinds).size,
        `${operation.id} repeats a principal kind`
      ).toBe(operation.principalKinds.length)
    }
  })

  it('keeps workspace-key operations at or below the fixed write ceiling', () => {
    for (const operation of Object.values(tableOperations)) {
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

  it('keeps reads and mutations on their declared semantic roles', () => {
    expect(tableOperations.read.minimumRole).toBe('read')
    expect(tableOperations.queryRows.minimumRole).toBe('read')
    expect(tableOperations.readView.minimumRole).toBe('read')
    expect(tableOperations.startRun.minimumRole).toBe('write')
    expect(tableOperations.cancelRuns.minimumRole).toBe('write')
    expect(tableOperations.replaceRows.minimumRole).toBe('write')
    expect(tableOperations.completeImport.minimumRole).toBe('write')

    expect(tableOperations.createExport.minimumRole).toBe('read')
    expect(tableOperations.cancelExport.minimumRole).toBe('read')
  })

  it('keeps delegated table operations Copilot-only', () => {
    for (const operation of Object.values(tableOperations)) {
      if (operation.principalKinds.includes('delegated')) {
        expect(operation.delegatedServices).toEqual(['copilot'])
      } else {
        expect(operation.delegatedServices).toBeUndefined()
      }
    }
  })

  it('separates Copilot file imports from the credential-bound HTTP lifecycle', () => {
    expect(tableOperations.createImport.principalKinds).not.toContain('delegated')
    expect(tableOperations.createImportParts.principalKinds).not.toContain('delegated')
    expect(tableOperations.completeImport.principalKinds).not.toContain('delegated')
    expect(tableOperations.createFromWorkspaceFile.principalKinds).toEqual(['delegated'])
    expect(tableOperations.importWorkspaceFile.principalKinds).toEqual(['delegated'])
  })
})
