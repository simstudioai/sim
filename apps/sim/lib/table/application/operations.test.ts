import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { describe, expect, it } from 'vitest'
import { tableOperations } from '@/lib/table/application/operations'

describe('table operation registry', () => {
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

  it('admits executor delegation only for the intentional internal route operations', () => {
    const uploadAndExportOperations = new Set([
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
      tableOperations.list.id,
      tableOperations.read.id,
      tableOperations.create.id,
      tableOperations.queryRows.id,
      tableOperations.createRows.id,
      tableOperations.updateRows.id,
      tableOperations.deleteRows.id,
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
        uploadAndExportOperations.has(operation.id) || sharedToolOperations.has(operation.id)
          ? ['copilot', 'executor']
          : ['copilot']
      )
    }
  })
})
