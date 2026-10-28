import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  auditLog,
  tableJobs,
  user,
  userStats,
  userTableDefinitions,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { tableBillingMock, tableBillingMockFns } from '@sim/testing/mocks/table-billing.mock'
import { tableEventsMock } from '@sim/testing/mocks/table-events.mock'
import { tableTriggerMock } from '@sim/testing/mocks/table-trigger.mock'
import { tableWorkflowColumnsMock } from '@sim/testing/mocks/table-workflow-columns.mock'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return storage.root
  },
}))
vi.mock('@/lib/table/billing', () => tableBillingMock)
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/trigger', () => tableTriggerMock)
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)

import { encryptSecret } from '@/lib/core/security/encryption'
import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import { runTableImport } from '@/lib/table/import-runner'
import { markTableJobRunningInWorkspace } from '@/lib/table/jobs/service'
import { TableRowProvenanceReader } from '@/lib/table/rows/secret-provenance'
import { queryRows } from '@/lib/table/rows/service'
import { getTableById } from '@/lib/table/service'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/file-manager'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/** Whitespace is part of this recorded value, not a new matching normalization. */
const SECRET = '  csv-source-secret-012345  '
const PADDED_SHORT = ['        x', 'x        ', '    x    ']
const QUOTED_OVERLAP = `${SECRET.trimStart()} | ${SECRET} | ${SECRET.trimEnd()}`
const ORDINARY_VALUES: Record<string, string> = {
  clean: 'ordinary value',
  skipped: 'visible',
  'short-prefix': 'xylophone',
  'short-suffix': 'phoenix',
  'short-whole': 'x',
}

describe('stored CSV imports preserve lineage through parsing and persistence', () => {
  const userId = generateId()
  const workspaceId = generateId()

  beforeAll(async () => {
    storage.root = mkdtempSync(path.join(tmpdir(), 'sim-import-lineage-'))
    tableBillingMockFns.mockAssertRowCapacity.mockResolvedValue(10_000)
    await db.insert(user).values({
      id: userId,
      name: 'CSV lineage fixture',
      email: `${userId}@csv-lineage.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(userStats).values({ id: generateId(), userId })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'CSV lineage fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
  })

  afterAll(async () => {
    await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await rm(storage.root, { recursive: true, force: true })
  })

  it('protects a trimmed source value while preserving quoted, clean and skipped cells', async () => {
    const tableId = generateId()
    const importId = generateId()
    await db.insert(userTableDefinitions).values({
      id: tableId,
      workspaceId,
      name: tableId,
      createdBy: userId,
      schema: {
        columns: [
          { id: 'kind', name: 'kind', type: 'string' },
          { id: 'value', name: 'value', type: 'string' },
        ],
      },
    })
    const source = await uploadWorkspaceFile(
      workspaceId,
      userId,
      Buffer.from(
        'kind,value,ignored\r\n' +
          `trimmed,${SECRET},none\r\n` +
          `quoted,"${SECRET}",none\r\n` +
          `quoted-overlap,"${QUOTED_OVERLAP}",none\r\n` +
          `short-prefix,xylophone,"${PADDED_SHORT[0]}"\r\n` +
          `short-suffix,phoenix,"${PADDED_SHORT[1]}"\r\n` +
          `short-whole,x,"${PADDED_SHORT[2]}"\r\n` +
          'clean,  ordinary value  ,none\r\n' +
          `skipped,visible,"${SECRET}"\r\n` +
          `"multiline,\nquoted",${SECRET},none\r\n`
      ),
      `${importId}.csv`,
      'text/csv',
      {
        secretProvenance: {
          status: 'exact',
          entries: [
            {
              name: 'CSV_SOURCE',
              encryptedValue: (await encryptSecret(SECRET)).encrypted,
              sourceUserId: userId,
              sourceWorkspaceId: workspaceId,
            },
            ...(await Promise.all(
              PADDED_SHORT.map(async (value, index) => ({
                name: `PADDED_${index}`,
                encryptedValue: (await encryptSecret(value)).encrypted,
                sourceUserId: userId,
                sourceWorkspaceId: workspaceId,
              }))
            )),
          ],
        },
        notifyWorkspaceChange: false,
      }
    )
    expect(await markTableJobRunningInWorkspace(tableId, workspaceId, importId, 'import')).toBe(
      true
    )
    await runTableImport({
      importId,
      tableId,
      workspaceId,
      userId,
      fileKey: source.key,
      fileName: source.name,
      delimiter: ',',
      mode: 'append',
      mapping: { kind: 'kind', value: 'value', ignored: null },
      deleteSourceFile: false,
    })
    const [job] = await db.select().from(tableJobs).where(eq(tableJobs.id, importId))
    expect(job).toMatchObject({ status: 'ready', rowsProcessed: 9, error: null })
    const reader = new TableRowProvenanceReader({ userId, workspaceId })
    const table = await getTableById(tableId)
    if (!table) throw new Error('Imported fixture table disappeared')
    const result = await queryRows(table, { limit: 10 }, generateId(), reader)
    expect(result.rows).toHaveLength(9)
    for (const row of result.rows) {
      const provenance = reader.rowProvenance(row.id)
      if (row.data.kind === 'trimmed' || row.data.kind === 'multiline,\nquoted') {
        expect(row.data.value).toBe(SECRET.trim())
        expect(provenance).toEqual({ status: 'unknown' })
      } else if (row.data.kind === 'quoted' || row.data.kind === 'quoted-overlap') {
        const expected = row.data.kind === 'quoted' ? SECRET : QUOTED_OVERLAP
        expect(row.data.value).toBe(expected)
        expect.soft(provenance.status).toBe('exact')
        if (provenance.status !== 'exact') continue
        const registry = new ResolvedSecretTraceRegistry([], { userId, workspaceId })
        expect(await importDurableSecretProvenance(registry, provenance)).toBe(true)
        expect(projectResolvedSecretModelContent(row.data.value, registry)).toEqual({
          safe: true,
          value: expected.replace(SECRET, '{{CSV_SOURCE}}'),
        })
      } else {
        expect(row.data.value).toBe(ORDINARY_VALUES[String(row.data.kind)])
        expect.soft(provenance).toEqual({ status: 'exact', entries: [] })
      }
    }
  })
})
