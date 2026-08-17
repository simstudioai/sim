/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceNowBlock } from '@/blocks/blocks/servicenow'

const { mockGetBlock } = vi.hoisted(() => ({ mockGetBlock: vi.fn() }))

vi.mock('@/blocks/registry', () => ({
  getBlock: mockGetBlock,
  getAllBlocks: vi.fn(() => []),
  getLatestBlock: vi.fn(() => undefined),
  getBlockRegistry: vi.fn(() => ({})),
  getBlockByToolName: vi.fn(() => undefined),
  getBlocksByCategory: vi.fn(() => []),
}))

import { migrateSubblockIds } from '@/lib/workflows/migrations/subblock-migrations'
import { extractBlockParams } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'

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
    vi.clearAllMocks()
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

  it('moves the legacy projection onto the current id in stored state', () => {
    const { blocks, migrated } = migrateSubblockIds({
      'block-1': legacyBlockState({
        ...CREDENTIALS,
        operation: 'servicenow_read_record',
        tableName: 'incident',
        fields: 'number,state',
      }),
    })

    expect(migrated).toBe(true)
    expect(blocks['block-1'].subBlocks.readFields?.value).toBe('number,state')
    expect(blocks['block-1'].subBlocks.fields).toBeUndefined()
  })
})

/**
 * `fields` is still the Create/Update Record JSON body — a different value
 * space. The migration is scoped to Read Records so that body is untouched.
 */
describe('ServiceNow create and update bodies the rename left alone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('still parses a JSON body stored under `fields` on Update Record', () => {
    const mapped = runPipeline(
      legacyBlockState({
        ...CREDENTIALS,
        operation: 'servicenow_update_record',
        tableName: 'incident',
        sysId: 'abc',
        fields: '{"state":"2"}',
      })
    )

    expect(mapped.fields).toEqual({ state: '2' })
  })

  it('leaves a create body under `fields` instead of migrating it', () => {
    const { blocks } = migrateSubblockIds({
      'block-1': legacyBlockState({
        ...CREDENTIALS,
        operation: 'servicenow_create_record',
        tableName: 'incident',
        fields: '{"short_description":"Network outage"}',
      }),
    })

    expect(blocks['block-1'].subBlocks.fields?.value).toBe('{"short_description":"Network outage"}')
    expect(blocks['block-1'].subBlocks.readFields).toBeUndefined()
  })
})

describe('ServiceNow state written after the split is never re-migrated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('does not overwrite a projection the user picked', () => {
    const { blocks } = migrateSubblockIds({
      'block-1': modernBlockState({
        ...CREDENTIALS,
        operation: 'servicenow_read_record',
        tableName: 'incident',
        fields: 'number,short_description',
        readFields: 'number,state',
      }),
    })

    expect(blocks['block-1'].subBlocks.readFields?.value).toBe('number,state')
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
