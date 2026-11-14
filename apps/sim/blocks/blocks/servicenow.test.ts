import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateSubblockIds } from '@/lib/workflows/migrations/subblock-migrations'
import { ServiceNowBlock } from '@/blocks/blocks/servicenow'
import { getBlock } from '@/blocks/registry'
import { extractBlockParams } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'

const mockGetBlock = vi.mocked(getBlock)

/**
 * Block state exactly as the canvas persists it. A workflow saved before the
 * Read Records projection moved off `fields` carries only the ids that existed
 * then, which is what marks the state as legacy.
 */
function legacyBlockState(values: Record<string, unknown>): BlockState {
  return {
    id: 'block-1',
    type: 'servicenow',
    name: 'ServiceNow 1',
    position: { x: 0, y: 0 },
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([id, value]) => [id, { id, type: 'short-input', value }])
    ),
    outputs: {},
    enabled: true,
  } as unknown as BlockState
}

/** Block state for a block created after the split: every current id present. */
function modernBlockState(overrides: Record<string, unknown>): BlockState {
  const subBlocks: Record<string, unknown> = {}
  for (const subBlock of ServiceNowBlock.subBlocks) {
    subBlocks[subBlock.id] = {
      id: subBlock.id,
      type: subBlock.type,
      value: typeof subBlock.value === 'function' ? subBlock.value({}) : null,
    }
  }
  for (const [id, value] of Object.entries(overrides)) {
    const declared = ServiceNowBlock.subBlocks.find((subBlock) => subBlock.id === id)
    subBlocks[id] = { id, type: declared?.type ?? 'short-input', value }
  }

  return {
    id: 'block-1',
    type: 'servicenow',
    name: 'ServiceNow 1',
    position: { x: 0, y: 0 },
    subBlocks,
    outputs: {},
    enabled: true,
  } as unknown as BlockState
}

function mapParams(params: Record<string, unknown>): Record<string, unknown> {
  const transform = ServiceNowBlock.tools.config?.params
  if (!transform) throw new Error('ServiceNow block has no params transform')
  return { ...params, ...transform(params) }
}

/** The real load-time pipeline: migrate stored state, serialize, then map. */
function runPipeline(state: BlockState): Record<string, unknown> {
  const { blocks } = migrateSubblockIds({ 'block-1': state })
  return mapParams(extractBlockParams(blocks['block-1']))
}

const CREDENTIALS = {
  instanceUrl: 'https://acme.service-now.com',
  username: 'u',
  password: 'p',
}

describe('ServiceNow Read Records projection saved before the id split', () => {
  beforeEach(() => {
    mockGetBlock.mockReturnValue(ServiceNowBlock)
  })

  /**
   * Without the migration every saved read silently widened to all columns of
   * every row, because the projection stayed stranded under `fields`.
   */
  it('carries a legacy projection onto the wire as the field list', () => {
    const mapped = runPipeline(
      legacyBlockState({
        ...CREDENTIALS,
        operation: 'servicenow_read_record',
        tableName: 'incident',
        query: 'active=true',
        limit: '10',
        fields: 'number,short_description,state',
      })
    )

    expect(mapped.fields).toBe('number,short_description,state')
  })
})

/**
 * `fields` is still the Create/Update Record JSON body — a different value
 * space. The migration is scoped to Read Records so that body is untouched.
 */
describe('ServiceNow create and update bodies the rename left alone', () => {
  beforeEach(() => {
    mockGetBlock.mockReturnValue(ServiceNowBlock)
  })

  it('still parses a JSON body stored under `fields` on Create Record', () => {
    const mapped = runPipeline(
      legacyBlockState({
        ...CREDENTIALS,
        operation: 'servicenow_create_record',
        tableName: 'incident',
        fields: '{"short_description":"Network outage","priority":"1"}',
      })
    )

    expect(mapped.fields).toEqual({
      short_description: 'Network outage',
      priority: '1',
    })
  })
})

describe('ServiceNow state written after the split is never re-migrated', () => {
  beforeEach(() => {
    mockGetBlock.mockReturnValue(ServiceNowBlock)
  })

  /**
   * The cross-operation leak the split exists to prevent: a create body left
   * behind and then promoted would go out as `sysparm_fields=[object Object]`.
   */
  it('does not promote a stale create body onto the Read Records projection', () => {
    const mapped = runPipeline(
      modernBlockState({
        ...CREDENTIALS,
        operation: 'servicenow_read_record',
        tableName: 'incident',
        fields: '{"short_description":"Network outage"}',
      })
    )

    expect(mapped.fields).toBeUndefined()
  })

  it('is a no-op the second time it runs', () => {
    const first = migrateSubblockIds({
      'block-1': legacyBlockState({
        ...CREDENTIALS,
        operation: 'servicenow_read_record',
        tableName: 'incident',
        fields: 'number,state',
      }),
    })
    expect(first.migrated).toBe(true)

    const second = migrateSubblockIds(first.blocks)
    expect(second.migrated).toBe(false)
    expect(second.blocks['block-1'].subBlocks.readFields?.value).toBe('number,state')
  })
})

/**
 * A tool call (agent, Pi, Human v2) passes the model's args under the tool param
 * names. Operations whose value has a dedicated, differently-named subblock must
 * fall back to the model's arg instead of overwriting it with the blank subblock.
 */
describe('ServiceNow tool-call args reach the tool', () => {
  function mapToolCall(operation: string, args: Record<string, unknown>) {
    const transform = ServiceNowBlock.tools.config?.params
    if (!transform) throw new Error('ServiceNow block has no params transform')
    const params = { ...CREDENTIALS, ...args }
    return { ...params, ...transform(params, { operation }) }
  }

  it('keeps the model close code and notes on Resolve Incident', () => {
    const mapped = mapToolCall('servicenow_resolve_incident', {
      sysId: 'abc',
      closeCode: 'Solution provided',
      closeNotes: 'Restarted the service',
    })

    expect(mapped.closeCode).toBe('Solution provided')
    expect(mapped.closeNotes).toBe('Restarted the service')
  })

  it('keeps the model state filter, projection, and display mode on List Incidents', () => {
    const mapped = mapToolCall('servicenow_list_incidents', {
      state: '2',
      fields: 'number,state',
      displayValue: 'false',
    })

    expect(mapped.state).toBe('2')
    expect(mapped.fields).toBe('number,state')
    expect(mapped.displayValue).toBe('false')
  })

  it('does not send a stored Create/Update JSON body as the List Incidents projection', () => {
    const mapped = mapToolCall('servicenow_list_incidents', {
      fields: '{"short_description":"Printer down"}',
    })

    expect(mapped.fields).toBeUndefined()
  })

  it('keeps the model comment on Update Approval and the search text on Search Knowledge', () => {
    expect(
      mapToolCall('servicenow_update_approval', {
        approvalSysId: 'abc',
        decision: 'approved',
        comments: 'Looks good',
      }).comments
    ).toBe('Looks good')
    expect(mapToolCall('servicenow_search_knowledge', { query: 'vpn' }).query).toBe('vpn')
  })

  it('keeps the model limit on List Attachments', () => {
    const mapped = mapToolCall('servicenow_list_attachments', {
      tableName: 'incident',
      recordSysId: 'abc',
      limit: 5,
    })

    expect(mapped.limit).toBe(5)
  })

  it('prefers a configured subblock value over the model arg', () => {
    const mapped = mapToolCall('servicenow_list_incidents', { incidentState: '6', state: '2' })

    expect(mapped.state).toBe('6')
  })
})
