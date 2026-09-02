/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { v2ApiRowSchema, v2EnrichmentRunDetailSchema } from '@/lib/api/contracts/v2/tables'
import type { TableSchema, WorkflowGroup } from '@/lib/table/types'
import {
  presentV2CreateTableImport,
  presentV2TableDispatch,
  presentV2TableExport,
  presentV2TableImport,
  presentV2WorkflowGroup,
} from '@/app/api/v2/tables/presenters'
import { toApiEnrichmentDetail, toApiRow } from '@/app/api/v2/tables/utils'

const createdAt = new Date('2026-08-01T00:00:00.000Z')
const importRecord = {
  id: 'import-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  source: { type: 'workspace_file' as const, fileId: 'file-1' },
  target: { type: 'new' as const, name: 'People' },
  options: {},
  tableId: 'table-1',
  status: 'running' as const,
  rowsProcessed: 2,
  rowsRejected: 0,
  cellsRejected: 0,
  rejectedSamples: [],
  error: null,
  createdAt,
  updatedAt: createdAt,
  completedAt: null,
}
const exportRecord = {
  id: 'export-1',
  tableId: 'table-1',
  workspaceId: 'workspace-1',
  type: 'export',
  status: 'running',
  payload: { format: 'csv' as const },
  rowsProcessed: 0,
  error: null,
  startedAt: createdAt,
  updatedAt: createdAt,
  completedAt: null,
}

describe('v2 table presenters', () => {
  it('converts domain import records at the v2 boundary', () => {
    expect(presentV2CreateTableImport({ record: importRecord, upload: null })).toEqual({
      data: {
        session: {
          id: 'import-1',
          workspaceId: 'workspace-1',
          status: 'processing',
          source: importRecord.source,
          target: importRecord.target,
          tableId: 'table-1',
          rowsProcessed: 2,
          rowsRejected: 0,
          cellsRejected: 0,
          rejectedSamples: [],
          error: null,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
          completedAt: null,
        },
        uploadToken: null,
        transfer: null,
      },
    })
    expect(presentV2TableImport(importRecord).data.createdAt).toBe(createdAt.toISOString())
  })

  it('converts domain export records and preserves queued create presentation', () => {
    expect(presentV2TableExport(exportRecord, true)).toEqual({
      data: {
        id: 'export-1',
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        format: 'csv',
        status: 'queued',
        rowsProcessed: 0,
        error: null,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        completedAt: null,
      },
    })
  })
})

/**
 * A group is created with column **names** and was read back with stored column
 * **ids** under the same `columnName` field, on a surface every other row/data
 * endpoint keys by name. The value could not be round-tripped into another
 * create, and named nothing the caller could see elsewhere.
 */
describe('presentV2WorkflowGroup', () => {
  const schema: TableSchema = {
    columns: [
      { id: 'col_score', name: 'score', type: 'number' },
      { id: 'col_input', name: 'website', type: 'string' },
    ],
  }

  const stored = {
    id: 'group-1',
    workflowId: 'workflow-1',
    outputs: [{ blockId: 'block-1', path: 'result', columnName: 'col_score' }],
    dependencies: { columns: ['col_input'] },
    inputMappings: [{ inputName: 'url', columnName: 'col_input' }],
  } as WorkflowGroup

  it('presents every column reference as the column name', () => {
    const presented = presentV2WorkflowGroup(stored, schema)

    expect(presented.outputs[0].columnName).toBe('score')
    expect(presented.dependencies?.columns).toEqual(['website'])
    expect(presented.inputMappings?.[0].columnName).toBe('website')
  })

  it('leaves the stored group untouched', () => {
    presentV2WorkflowGroup(stored, schema)
    expect(stored.outputs[0].columnName).toBe('col_score')
  })

  it('passes a reference naming no current column through unchanged', () => {
    const orphaned = {
      ...stored,
      outputs: [{ blockId: 'block-1', path: 'result', columnName: 'col_deleted' }],
    } as WorkflowGroup

    expect(presentV2WorkflowGroup(orphaned, schema).outputs[0].columnName).toBe('col_deleted')
  })

  /**
   * `deploymentMode: null` on the wire was read as "runs the draft", while a
   * mode-less group has always run the deployment. The presenter publishes
   * the effective mode so the response can never carry a third, absent state.
   */
  it('presents the effective deployment mode, never an absent one', () => {
    expect(presentV2WorkflowGroup(stored, schema).deploymentMode).toBe('deployed')
    expect(
      presentV2WorkflowGroup({ ...stored, deploymentMode: 'live' }, schema).deploymentMode
    ).toBe('live')
  })

  it('leaves a legacy name-keyed group alone', () => {
    const legacy = {
      ...stored,
      outputs: [{ blockId: 'block-1', path: 'result', columnName: 'score' }],
      dependencies: undefined,
      inputMappings: undefined,
    } as unknown as WorkflowGroup

    expect(presentV2WorkflowGroup(legacy, schema).outputs[0].columnName).toBe('score')
  })
})

describe('presentV2TableDispatch', () => {
  const stored = {
    id: 'dispatch-1',
    tableId: 'table-1',
    workspaceId: 'workspace-1',
    requestId: 'request-1',
    mode: 'incomplete' as const,
    scope: { groupIds: ['group-1'], rowIds: ['row-1'], filter: { all: [] } },
    status: 'complete' as const,
    cursor: 512,
    limit: { type: 'rows' as const, max: 50 },
    processedCount: 12,
    isManualRun: true,
    triggeredByUserId: 'user-1',
    requestedAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: new Date('2026-01-01T00:05:00.000Z'),
    canceledAt: null,
  }

  it('serializes lifecycle timestamps and keeps a terminal status readable', () => {
    const presented = presentV2TableDispatch(stored)

    expect(presented.status).toBe('complete')
    expect(presented.requestedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(presented.completedAt).toBe('2026-01-01T00:05:00.000Z')
    expect(presented.canceledAt).toBeNull()
  })

  /**
   * A field named `cursor` on a v2 resource reads as a pagination token, and the
   * scheduler's internal identities have no public meaning.
   */
  it('withholds the scheduler cursor and internal identities', () => {
    const presented = presentV2TableDispatch(stored)

    expect(presented).not.toHaveProperty('cursor')
    expect(presented).not.toHaveProperty('requestId')
    expect(presented).not.toHaveProperty('triggeredByUserId')
  })

  /**
   * The stored scope also carries a compiled filter, which stays unpublished —
   * it is held in a different grammar from the predicate the request was
   * written in.
   */
  it('withholds the compiled filter itself', () => {
    expect(presentV2TableDispatch(stored).scope).not.toHaveProperty('filter')
  })

  /**
   * Withholding the filter must not also withhold the fact that there was one.
   * A filtered dispatch has no `rowIds` either, so without `filtered` the
   * response described it exactly like a run over every eligible row.
   */
  it('says a filtered scope is a filtered scope', () => {
    expect(
      presentV2TableDispatch({
        ...stored,
        scope: { groupIds: ['group-1'], filter: { status: 'open' }, excludeRowIds: ['row-9'] },
      }).scope
    ).toEqual({ groupIds: ['group-1'], filtered: true, excludeRowIds: ['row-9'] })
  })

  /**
   * The run rejects only `rowIds` *with* `excludeRowIds`, so exclusions with no
   * filter are a scope a caller can really create, and the walk applies them.
   * Reporting it as filtered would be false; reporting it bare would be the
   * original bug, since it targets every eligible row *except* these.
   */
  it('reports exclusions that narrow an otherwise unfiltered run', () => {
    expect(
      presentV2TableDispatch({
        ...stored,
        scope: { groupIds: ['group-1'], excludeRowIds: ['row-9'] },
      }).scope
    ).toEqual({ groupIds: ['group-1'], excludeRowIds: ['row-9'] })
  })

  /**
   * The walk ignores exclusions once a row list is given, so publishing them
   * beside `rowIds` would describe a narrowing that never happens.
   */
  it('withholds exclusions the walk would ignore', () => {
    expect(
      presentV2TableDispatch({
        ...stored,
        scope: { groupIds: ['group-1'], rowIds: ['row-1'], excludeRowIds: ['row-9'] },
      }).scope
    ).toEqual({ groupIds: ['group-1'], rowIds: ['row-1'] })
  })

  /** Nothing narrowing it is the one shape that really does mean every eligible row. */
  it('leaves an unnarrowed scope unmarked', () => {
    const scope = presentV2TableDispatch({ ...stored, scope: { groupIds: ['group-1'] } }).scope
    expect(scope).toEqual({ groupIds: ['group-1'] })
  })
})

describe('toApiRow run state', () => {
  const row = {
    id: 'row-1',
    data: { 'col-1': 'Ada' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  }
  const identity = (data: Record<string, unknown>) => data

  it('omits run state entirely when the read did not ask for it', () => {
    expect(toApiRow(row, identity)).not.toHaveProperty('runState')
  })

  /**
   * `jobId` is the async scheduler's identity and addresses nothing public;
   * `enrichmentDetails` has its own sub-resource and is never hydrated here.
   */
  it('drops the scheduler job id and the deep cascade payload', () => {
    const presented = toApiRow(row, identity, {
      'group-1': {
        status: 'completed',
        executionId: 'execution-1',
        jobId: 'job-1',
        workflowId: 'workflow-1',
        error: null,
        enrichmentDetails: null,
      },
    })

    expect(presented.runState?.['group-1']).toEqual({
      status: 'completed',
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      error: null,
      runningBlockIds: [],
      blockErrors: {},
      canceledAt: null,
    })
  })

  it('carries the fields a caller polls a failed cell for', () => {
    const presented = toApiRow(row, identity, {
      'group-1': {
        status: 'error',
        executionId: 'execution-1',
        jobId: null,
        workflowId: 'workflow-1',
        error: 'boom',
        runningBlockIds: ['block-1'],
        blockErrors: { 'block-1': 'boom' },
        cancelledAt: '2026-01-03T00:00:00.000Z',
      },
    })

    expect(presented.runState?.['group-1']).toMatchObject({
      status: 'error',
      error: 'boom',
      runningBlockIds: ['block-1'],
      blockErrors: { 'block-1': 'boom' },
      canceledAt: '2026-01-03T00:00:00.000Z',
    })
  })

  it('presents a row that has never run as an empty map, not an absent one', () => {
    expect(toApiRow(row, identity, {}).runState).toEqual({})
  })

  /**
   * `status` is a `text` column read through a bare `as` cast, and the response
   * schema is `.parse`d on the way out — a closed enum there turns one drifted
   * row into a 500 on a well-formed read.
   */
  it('publishes a stored status the domain union does not name', () => {
    const presented = toApiRow(row, identity, {
      'group-1': {
        status: 'reconciling' as never,
        executionId: null,
        jobId: null,
        workflowId: 'workflow-1',
        error: null,
      },
    })

    expect(() => v2ApiRowSchema.parse(presented)).not.toThrow()
    expect(v2ApiRowSchema.parse(presented).runState?.['group-1'].status).toBe('reconciling')
  })
})

/**
 * `tableRowExecutions.enrichmentDetails` is schemaless jsonb read back through a
 * bare `as` cast, so every declared key is a claim about the writer rather than
 * a property of the column.
 */
describe('toApiEnrichmentDetail', () => {
  it('projects a complete blob unchanged', () => {
    const detail = {
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      totalCost: 0.25,
      matchedProvider: 'hunter',
      aborted: false,
      providers: [
        {
          id: 'hunter',
          label: 'Hunter',
          toolId: 'hunter_find_email',
          status: 'matched' as const,
          cost: 0.25,
          durationMs: 900,
          error: null,
        },
      ],
    }

    const presented = toApiEnrichmentDetail(detail)

    expect(presented).toEqual(detail)
    expect(() => v2EnrichmentRunDetailSchema.parse(presented)).not.toThrow()
  })

  it('answers null for a missing cascade', () => {
    expect(toApiEnrichmentDetail(null)).toBeNull()
  })

  /** A blob written before the cascade breakdown settled is a partial answer, not a 500. */
  it('defaults every key a drifted blob is missing', () => {
    const presented = toApiEnrichmentDetail({
      startedAt: '2026-01-01 00:00:00+00',
      providers: [{ id: 'hunter', status: 'rate_limited' }],
    } as never)

    expect(presented).toEqual({
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      durationMs: 0,
      totalCost: 0,
      matchedProvider: null,
      aborted: false,
      providers: [
        {
          id: 'hunter',
          label: '',
          toolId: '',
          status: 'rate_limited',
          cost: 0,
          durationMs: 0,
          error: null,
        },
      ],
    })
    expect(() => v2EnrichmentRunDetailSchema.parse(presented)).not.toThrow()
  })

  it('drops a timestamp no date-time consumer could parse', () => {
    const presented = toApiEnrichmentDetail({ startedAt: 'never', completedAt: 7 } as never)

    expect(presented?.startedAt).toBeNull()
    expect(presented?.completedAt).toBeNull()
    expect(() => v2EnrichmentRunDetailSchema.parse(presented)).not.toThrow()
  })
})
