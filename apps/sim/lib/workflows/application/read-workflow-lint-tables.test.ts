import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import {
  secretsUseCasesMock,
  secretsUseCasesMockFns,
} from '@sim/testing/mocks/secrets-use-cases.mock'
import {
  tableApplicationTablesMock,
  tableApplicationTablesMockFns,
} from '@sim/testing/mocks/table-application-tables.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsQueriesMock,
  workflowsQueriesMockFns,
} from '@sim/testing/mocks/workflows-queries.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/workflows/queries', () => workflowsQueriesMock)
vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/table/application/tables', () => tableApplicationTablesMock)
vi.mock('@/lib/knowledge/application/documents', () => ({
  readKnowledgeDocument: { execute: vi.fn() },
}))
vi.mock('@/lib/secrets/application/use-cases', () => secretsUseCasesMock)
vi.mock('@/lib/workflows/editing/validation', () => ({
  collectUnresolvedReferences: vi.fn(async () => []),
  collectUnresolvedAgentToolReferences: vi.fn(async () => []),
  UNRESOLVABLE_AT_LINT_NOTE: 'External resources need runtime verification.',
  validateConditionHandle: vi.fn(() => ({ valid: true })),
  validateRouterHandle: vi.fn(() => ({ valid: true })),
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readWorkflowLint } from '@/lib/workflows/application/read-workflow-lint'
import { TableBlock } from '@/blocks/blocks/table'
import { TableV2Block } from '@/blocks/blocks/table_v2'

const mocks = {
  snapshot: workflowsQueriesMockFns.mockLoadWorkflowReadSnapshot,
  table: tableApplicationTablesMockFns.mockReadTableDefinitionUseCase,
  secrets: secretsUseCasesMockFns.mockListSecretsUseCase,
}

const mockGetBlock = getBlock as Mock
mockGetBlock.mockReturnValue(undefined)

const mockLegacyTable = tableServiceMockFns.mockGetTableById

const mockPermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockContext = workflowContextMockFns.mockResolveActiveWorkflowApplicationContext

const principal = createPersonalApiKeyPrincipal({ userId: 'reader' })
const workspaceId = 'canonical-workspace'
const table = {
  id: 'active-table',
  workspaceId,
  name: 'People',
  schema: { columns: [{ id: 'col_name', name: 'name', type: 'string' }] },
}

function block(
  id = 'query',
  values: Record<string, unknown> = {},
  mode: 'basic' | 'advanced' = 'basic'
) {
  return {
    id,
    type: 'table_v2',
    name: id,
    position: { x: 0, y: 0 },
    enabled: true,
    outputs: {},
    data: { canonicalModes: { tableId: mode } },
    subBlocks: Object.fromEntries(
      Object.entries({
        operation: 'query_rows',
        tableSelector: table.id,
        builderMode: 'json',
        ...values,
      }).map(([key, value]) => [key, { id: key, type: 'code', value }])
    ),
  }
}
function setGraph(...blocks: ReturnType<typeof block>[]) {
  mocks.snapshot.mockResolvedValue({
    workflowRecord: { id: 'parent' },
    normalizedData: {
      blocks: Object.fromEntries(blocks.map((block) => [block.id, block])),
      edges: [],
      loops: {},
      parallels: {},
    },
  })
}
function lint(signal?: AbortSignal) {
  return readWorkflowLint.execute({ principal, input: { workflowId: 'parent', signal } })
}

describe('standalone table diagnostics against the actual Table block', () => {
  beforeEach(() => {
    mockContext.mockResolvedValue({
      workflowId: 'parent',
      workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
      workflow: { id: 'parent' },
    })
    mockPermission.mockResolvedValue('read')
    mockGetBlock.mockImplementation((type: string) =>
      type === 'table_v2' ? TableBlock : undefined
    )
    mocks.table.mockResolvedValue({ table })
    mockLegacyTable.mockResolvedValue(table)
    mocks.secrets.mockResolvedValue({ secrets: [] })
    setGraph(block())
  })

  it('uses the active picker and authorized table read instead of a stale manual ID', async () => {
    setGraph(block('query', { manualTableId: 'stale-table', filter: '{"missing":{"$eq":1}}' }))
    const result = await lint()
    expect(mocks.table).toHaveBeenCalledExactlyOnceWith({
      principal,
      input: { tableId: table.id, workspaceId },
      request: undefined,
    })
    expect(mockLegacyTable).not.toHaveBeenCalled()
    expect(result.tableFieldIssues).toEqual([
      expect.objectContaining({ blockId: 'query', field: 'missing', tableName: 'People' }),
    ])
  })

  it.each(['not_found', 'forbidden'] as const)(
    'reports a %s table without exposing its metadata',
    async (code) => {
      mocks.table.mockRejectedValueOnce(new OrchestrationError(code, 'Private table and workspace'))
      const result = await lint()
      expect(result.unresolvedReferences).toEqual([
        expect.objectContaining({
          blockId: 'query',
          field: 'tableId',
          value: table.id,
          kind: 'resource',
        }),
      ])
      expect(result.tableFieldIssues).toEqual([])
      expect(JSON.stringify(result)).not.toContain('Private table')
    }
  )

  it.each(['<start.tableId>', '{{TABLE_ID}}', ''])(
    'does not query a dormant ID when the active value is %j',
    async (value) => {
      setGraph(block('query', { manualTableId: value }, 'advanced'))
      const result = await lint()
      expect(mocks.table).not.toHaveBeenCalled()
      expect(mockLegacyTable).not.toHaveBeenCalled()
      expect(result.notes).toContain(
        'Table checks in block "query" were not completed because its active table ID is empty or requires runtime resolution.'
      )
    }
  )

  it('uses the actual JSON filter and sort grammar, including nested groups', async () => {
    setGraph(
      block('query', {
        filter: '{"$or":[{"name":"A"},{"missing":{"$eq":"<start.value>"}}]}',
        sort: '{"other":"asc","createdAt":"desc"}',
      })
    )
    const result = await lint()
    expect(result.tableFieldIssues.map(({ field }) => field)).toEqual(['missing', 'other'])
  })

  it('checks visual filter and sort builders and ignores dormant JSON editors', async () => {
    setGraph(
      block('query', {
        builderMode: 'builder',
        filter: '{"dormant":1}',
        sort: '{"dormant":"asc"}',
        filterBuilder: [
          { id: 'r1', column: 'missing', operator: 'eq', value: '1', logicalOperator: 'and' },
        ],
        sortBuilder: [{ id: 's1', column: 'other', direction: 'desc' }],
      })
    )
    const result = await lint()
    expect(result.tableFieldIssues.map(({ field }) => field)).toEqual(['missing', 'other'])
  })

  it('does not check stale query fields during a schema read', async () => {
    setGraph(
      block('query', {
        operation: 'get_schema',
        filter: '{"field":"missing","op":"eq","value":1}',
        sort: '{"missing":"asc"}',
      })
    )
    const result = await lint()
    expect(result.tableFieldIssues).toEqual([])
  })

  it('accepts stable column IDs and system query fields while rejecting wrong-case names', async () => {
    setGraph(
      block('query', {
        filter: '{"col_name":"A","Name":"B"}',
        sort: '{"id":"asc","createdAt":"desc","updatedAt":"asc"}',
      })
    )
    const result = await lint()
    expect(result.tableFieldIssues.map(({ field }) => field)).toEqual(['Name'])
  })

  it('does not convert a table-read outage into a clean report', async () => {
    mocks.table.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(lint()).rejects.toThrow('database unavailable')
  })

  it('reports input normalization failures instead of claiming a clean table check', async () => {
    setGraph(block('query', { filter: 'not JSON' }))
    const result = await lint()
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Table input checks in block "query" could not complete before runtime: Invalid JSON in Filter'
        ),
      ])
    )
    expect(result.tableFieldIssues).toEqual([])
  })

  it('checks literal row keys around bare references that resolve to JSON at runtime', async () => {
    setGraph(
      block('write', {
        operation: 'insert_row',
        data: '{"name": <start.name>, "missing": <start.count>, "note": "<3 {{SUFFIX}}", "env": {{N}}}',
      })
    )
    const result = await lint()
    expect(result.notes.filter((note) => note.includes('could not complete'))).toEqual([])
    expect(
      result.unresolvedReferences.filter((reference) => reference.kind === 'resource')
    ).toEqual([
      expect.objectContaining({
        blockId: 'write',
        field: 'data',
        value: ['missing', 'note', 'env'],
      }),
    ])
  })

  describe('with the registered TableV2Block predicate grammar', () => {
    beforeEach(() => {
      mockGetBlock.mockImplementation((type: string) =>
        type === 'table_v2' ? TableV2Block : undefined
      )
    })

    it('checks literal predicate fields around a bare reference value', async () => {
      setGraph(
        block('query', {
          filter:
            '{"all":[{"field":"name","op":"eq","value":<start.name>},{"field":"other","op":"gt","value":<start.n>}]}',
        })
      )
      const result = await lint()
      expect(result.notes.filter((note) => note.includes('could not complete'))).toEqual([])
      expect(result.tableFieldIssues.map(({ field }) => field)).toEqual(['other'])
    })

    it('checks predicate fields around an in-list reference', async () => {
      setGraph(
        block('query', {
          filter:
            '{"all":[{"field":"other","op":"in","value":<start.names>},{"field":"name","op":"eq","value":<start.name>}]}',
        })
      )
      const result = await lint()
      expect(result.notes.filter((note) => note.includes('could not complete'))).toEqual([])
      expect(result.tableFieldIssues.map(({ field }) => field)).toEqual(['other'])
    })

    it('notes a whole-field filter reference as runtime-resolved and still checks row data', async () => {
      setGraph(
        block('write', {
          operation: 'update_rows_by_filter',
          bulkFilterMode: 'json',
          filter: '<start.filter>',
          data: '{"name":"Ada","missing":1}',
        })
      )
      const result = await lint()
      expect(result.notes.filter((note) => note.includes('could not complete'))).toEqual([])
      expect(result.notes).toContain(
        'Table inputs in block "write" depend on references resolved at runtime and were not checked: filterInput.'
      )
      expect(
        result.unresolvedReferences.filter((reference) => reference.kind === 'resource')
      ).toEqual([expect.objectContaining({ field: 'data', value: ['missing'] })])
    })

    const manyReferenceData = `{${['a', 'b', 'c', 'd', 'e', 'f', 'g']
      .map((name) => `"name": <start.${name}>`)
      .join(',')},"missing":1}`

    it.each([
      ['insert_row', manyReferenceData, undefined],
      [
        'update_rows_by_filter',
        manyReferenceData,
        '{"all":[{"field":"name","op":"eq","value":<start.n>},{"field":"name","op":"in","value":<start.names>}]}',
      ],
    ])(
      'checks literal row keys beside many bare references (%s)',
      async (operation, data, filter) => {
        setGraph(block('write', { operation, bulkFilterMode: 'json', data, filter }))
        const result = await lint()
        expect(result.notes.filter((note) => note.includes('could not complete'))).toEqual([])
        expect(
          result.unresolvedReferences.filter((reference) => reference.kind === 'resource')
        ).toEqual([expect.objectContaining({ field: 'data', value: ['missing'] })])
      }
    )

    it('checks the literal conditions beside a whole-condition reference', async () => {
      setGraph(
        block('query', {
          filter: '{"all":[<start.condition>,{"field":"other","op":"eq","value":1}]}',
        })
      )
      const result = await lint()
      expect(result.notes.filter((note) => note.includes('could not complete'))).toEqual([])
      expect(result.tableFieldIssues.map(({ field }) => field)).toEqual(['other'])
    })

    it('defers a filter group made only of references and still checks row data', async () => {
      const conditions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `<start.${name}>`)
      setGraph(
        block('write', {
          operation: 'update_rows_by_filter',
          bulkFilterMode: 'json',
          filter: `{"all":[${conditions.join(',')}]}`,
          data: '{"name":"Ada","missing":1}',
        })
      )
      const result = await lint()
      expect(result.notes.filter((note) => note.includes('could not complete'))).toEqual([])
      expect(result.notes).toContain(
        'Table inputs in block "write" depend on references resolved at runtime and were not checked: filterInput.'
      )
      expect(
        result.unresolvedReferences.filter((reference) => reference.kind === 'resource')
      ).toEqual([expect.objectContaining({ field: 'data', value: ['missing'] })])
    })

    it('checks row data whose keys resemble a reference-only filter group', async () => {
      setGraph(
        block('write', {
          operation: 'update_rows_by_filter',
          bulkFilterMode: 'json',
          filter: '<start.filter>',
          data: '{"all":[<start.values>],"missing":1}',
        })
      )
      const result = await lint()
      expect(
        result.unresolvedReferences.filter((reference) => reference.kind === 'resource')
      ).toEqual([expect.objectContaining({ field: 'data', value: ['all', 'missing'] })])
    })

    it('reports a quoted in-list value that matches a bare reference elsewhere', async () => {
      setGraph(
        block('query', {
          filter:
            '{"all":[{"field":"name","op":"eq","value":<start.names>},{"field":"name","op":"in","value":"<start.names>"}]}',
        })
      )
      const result = await lint()
      expect(result.notes).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'Table input checks in block "query" could not complete before runtime:'
          ),
        ])
      )
    })

    it('keeps a __proto__ row key beside a bare reference', async () => {
      setGraph(
        block('write', {
          operation: 'insert_row',
          data: '{"name":<start.name>,"__proto__":"extra"}',
        })
      )
      const result = await lint()
      expect(
        result.unresolvedReferences.filter((reference) => reference.kind === 'resource')
      ).toEqual([expect.objectContaining({ field: 'data', value: ['__proto__'] })])
    })

    it('blames malformed row data, not a whole-field filter reference', async () => {
      setGraph(
        block('write', {
          operation: 'update_rows_by_filter',
          bulkFilterMode: 'json',
          filter: '<start.filter>',
          data: '{"name":"Ada",}',
        })
      )
      const result = await lint()
      expect(result.notes).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'Table input checks in block "write" could not complete before runtime: Invalid JSON in Row Data'
          ),
        ])
      )
    })

    it('does not call deferred whole-field row data a non-static object', async () => {
      setGraph(
        block('write', {
          operation: 'update_rows_by_filter',
          bulkFilterMode: 'json',
          filter: '<start.filter>',
          data: '<start.row>',
        })
      )
      const result = await lint()
      expect(result.notes).toContain(
        'Table inputs in block "write" depend on references resolved at runtime and were not checked: data, filterInput.'
      )
      expect(result.notes.filter((note) => note.includes('not a static object'))).toEqual([])
    })

    it('still reports an invalid literal condition beside a reference', async () => {
      setGraph(
        block('query', {
          filter:
            '{"all":[{"field":"name","op":"eq","value":<start.n>},{"field":"name","op":"in","value":"not a list"}]}',
        })
      )
      const result = await lint()
      expect(result.notes).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'Table input checks in block "query" could not complete before runtime:'
          ),
        ])
      )
    })
  })

  it.each([
    ['data', 'insert_row', '<start.row>', 'Table row "write".data is not a static object'],
    [
      'rows',
      'batch_insert_rows',
      '<start.rows>',
      'Table rows in block "write" are not a static array',
    ],
    ['rows', 'batch_insert_rows', '[<start.first>, {"name":"Ada"}]', 'Table row "write".rows[0]'],
  ])(
    'notes a %s value that is a bare reference instead of a failed check (%s, %s)',
    async (field, operation, value, note) => {
      setGraph(block('write', { operation, [field]: value }))
      const result = await lint()
      expect(result.notes.filter((entry) => entry.includes('could not complete'))).toEqual([])
      expect(result.notes).toEqual(expect.arrayContaining([expect.stringContaining(note)]))
    }
  )

  it('still reports malformed literal JSON that contains a reference', async () => {
    setGraph(block('write', { operation: 'insert_row', data: '{"name": <start.name>,}' }))
    const result = await lint()
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Table input checks in block "write" could not complete before runtime: Invalid JSON in Row Data'
        ),
      ])
    )
  })

  it('reports a query object whose entire value requires runtime resolution', async () => {
    setGraph(block('query', { filter: '"<start.filter>"' }))
    const result = await lint()
    expect(result.notes).toContain(
      'Table filter in block "query" is not a static query object; its column references were not checked.'
    )
  })

  it('does not treat dynamic field names as missing columns', async () => {
    setGraph(block('query', { sort: '{"<start.column>":"asc"}' }))
    const result = await lint()
    expect(result.tableFieldIssues).toEqual([])
    expect(result.notes).toContain(
      'Table column "<start.column>" in block "query" requires runtime resolution and was not checked.'
    )
  })

  it('does not start another table read after cancellation', async () => {
    const controller = new AbortController()
    setGraph(block('first'), block('second', { tableSelector: 'second-table' }))
    mocks.table.mockImplementationOnce(async () => {
      controller.abort()
      return { table }
    })
    await expect(lint(controller.signal)).rejects.toThrow()
    expect(mocks.table).toHaveBeenCalledTimes(1)
    expect(mocks.secrets).not.toHaveBeenCalled()
  })

  it.each(['insert_row', 'upsert_row', 'update_row', 'update_rows_by_filter'])(
    'reports row keys that %s would drop',
    async (operation) => {
      setGraph(
        block('write', {
          operation,
          rowId: 'row-1',
          bulkFilterMode: 'json',
          filter: '{"name":"Ada"}',
          data: '{"name":"Ada","col_name":"wrong key","Name":"wrong case","id":"system"}',
        })
      )
      const result = await lint()
      expect(result.unresolvedReferences).toEqual([
        expect.objectContaining({
          blockId: 'write',
          field: 'data',
          value: ['col_name', 'Name', 'id'],
          kind: 'resource',
          reason: expect.stringContaining('exact column names'),
        }),
      ])
      expect(result.tableFieldIssues).toEqual([])
    }
  )

  it('identifies the batch row containing keys that would be omitted', async () => {
    setGraph(
      block('write', {
        operation: 'batch_insert_rows',
        rows: '[{"name":"Ada"},{"name":"Grace","missing":1}]',
      })
    )
    const result = await lint()
    expect(result.unresolvedReferences).toEqual([
      expect.objectContaining({ blockId: 'write', field: 'rows[1]', value: ['missing'] }),
    ])
  })

  it('reports runtime row keys as unchecked instead of missing columns', async () => {
    setGraph(
      block('write', { operation: 'insert_row', data: '{"<start.column>":"value","name":"Ada"}' })
    )
    const result = await lint()
    expect(
      result.unresolvedReferences.filter((reference) => reference.kind === 'resource')
    ).toEqual([])
    expect(result.notes).toContain(
      'Table row keys in "write".data require runtime resolution and were not checked: <start.column>.'
    )
  })
})
