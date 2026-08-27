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

    /** Reading the state of a run you started is a read; un-archiving is a write. */
    expect(tableOperations.readRun.minimumRole).toBe('read')
    expect(tableOperations.restore.minimumRole).toBe('write')
  })

  it('admits executor delegation only for the intentional internal route operations', () => {
    const executorOnlyOperations = new Set([
      tableOperations.createImport.id,
      tableOperations.readImport.id,
      tableOperations.createImportParts.id,
      tableOperations.completeImport.id,
      tableOperations.cancelImport.id,
      tableOperations.createExport.id,
      tableOperations.readExport.id,
      tableOperations.cancelExport.id,
      tableOperations.downloadExport.id,
    ])
    // Reachable from the executor's Table block as well as from Copilot. The
    // single-row operations joined this set when their routes moved onto the
    // delegation auth policy: the Table block's get/update/delete/upsert row
    // tools run under them, and a policy without `executor` fails every one of
    // those calls with a 403 while every route test still passes.
    const sharedToolOperations = new Set([
      tableOperations.createGroup.id,
      tableOperations.updateGroup.id,
      tableOperations.deleteGroup.id,
      tableOperations.readRow.id,
      tableOperations.updateRow.id,
      tableOperations.deleteRow.id,
      tableOperations.upsertRow.id,
    ])

    for (const operation of Object.values(tableOperations)) {
      expect(operation.delegatedServices).toEqual(
        executorOnlyOperations.has(operation.id)
          ? ['executor']
          : sharedToolOperations.has(operation.id)
            ? ['copilot', 'executor']
            : ['copilot']
      )
    }
  })

  it('separates Copilot workspace-file imports from the credential-bound upload lifecycle', () => {
    expect(tableOperations.createImport.delegatedServices).toEqual(['executor'])
    expect(tableOperations.createImportParts.delegatedServices).toEqual(['executor'])
    expect(tableOperations.completeImport.delegatedServices).toEqual(['executor'])
    expect(tableOperations.createFromWorkspaceFile.principalKinds).toEqual(['delegated'])
    expect(tableOperations.createFromWorkspaceFile.delegatedServices).toEqual(['copilot'])
    expect(tableOperations.importWorkspaceFile.principalKinds).toEqual(['delegated'])
    expect(tableOperations.importWorkspaceFile.delegatedServices).toEqual(['copilot'])
  })
})
