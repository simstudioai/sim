/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OktaBlock } from '@/blocks/blocks/okta'

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
import { isOktaFlagEnabled } from '@/tools/okta/utils'

/**
 * Build the block state the canvas persists: one entry per stored sub-block id.
 * A workflow saved before an id rename only carries the ids that existed then.
 */
function legacyBlockState(values: Record<string, unknown>): BlockState {
  return {
    id: 'block-1',
    type: 'okta',
    name: 'Okta 1',
    position: { x: 0, y: 0 },
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([id, value]) => [id, { id, type: 'short-input', value }])
    ),
    outputs: {},
    enabled: true,
  } as unknown as BlockState
}

/**
 * The generic block handler runs `{ ...inputs, ...transformedParams }`, so the
 * transform can only drop a value by assigning `undefined` to its key. Omitting
 * the key leaves the raw subBlock string in place. These cases pin that
 * behavior by asserting on the merge, not on the transform alone.
 */
function merge(inputs: Record<string, unknown>): Record<string, unknown> {
  const transform = OktaBlock.tools.config?.params
  if (!transform) throw new Error('Okta block has no params transform')
  return { ...inputs, ...transform(inputs) }
}

const BASE = { operation: 'okta_list_users', apiKey: 'token', domain: 'dev-1.okta.com' }

describe('Okta block params transform', () => {
  it('coerces a numeric limit', () => {
    expect(merge({ ...BASE, limit: '25' }).limit).toBe(25)
  })

  it('drops a non-numeric limit rather than forwarding the raw entry', () => {
    expect(merge({ ...BASE, limit: 'twenty' }).limit).toBeUndefined()
  })

  it('drops a non-numeric priority rather than forwarding the raw entry', () => {
    const merged = merge({
      ...BASE,
      operation: 'okta_assign_group_to_app',
      priority: 'high',
    })
    expect(merged.priority).toBeUndefined()
  })

  it('drops a blank profile field so a partial update leaves Okta untouched', () => {
    const merged = merge({
      ...BASE,
      operation: 'okta_update_user',
      userId: '00u1',
      firstName: 'Ada',
      lastName: '',
    })
    expect(merged.firstName).toBe('Ada')
    expect(merged.lastName).toBeUndefined()
  })

  it('maps the group name and description onto the tool param names', () => {
    const merged = merge({
      ...BASE,
      operation: 'okta_create_group',
      groupName: 'Engineering',
      groupDescription: 'Eng team',
    })
    expect(merged.name).toBe('Engineering')
    expect(merged.description).toBe('Eng team')
  })

  /**
   * The update tool declares `name` optional and its merge helper carries the
   * stored name through when the field is blank, so requiring it on the block
   * would block a description-only update the tool and the API both accept.
   * Create has no stored name to fall back on and still requires it.
   */
  it('requires the group name only when creating a group', () => {
    const groupName = OktaBlock.subBlocks.find((subBlock) => subBlock.id === 'groupName')

    expect(groupName?.condition).toEqual({
      field: 'operation',
      value: ['okta_create_group', 'okta_update_group'],
    })
    expect(groupName?.required).toEqual({ field: 'operation', value: ['okta_create_group'] })
  })

  it('keeps a false toggle, which is a real choice rather than a blank field', () => {
    const merged = merge({
      ...BASE,
      operation: 'okta_activate_user',
      userId: '00u1',
      sendEmail: false,
    })
    expect(merged.sendEmail).toBe(false)
  })
})

/** Block state for a block created after the split: every current id present. */
function modernBlockState(overrides: Record<string, unknown>): BlockState {
  const subBlocks: Record<string, unknown> = {}
  for (const subBlock of OktaBlock.subBlocks) {
    subBlocks[subBlock.id] = {
      id: subBlock.id,
      type: subBlock.type,
      value: typeof subBlock.value === 'function' ? subBlock.value({}) : null,
    }
  }
  for (const [id, value] of Object.entries(overrides)) {
    const declared = OktaBlock.subBlocks.find((subBlock) => subBlock.id === id)
    subBlocks[id] = { id, type: declared?.type ?? 'short-input', value }
  }

  return {
    id: 'block-1',
    type: 'okta',
    name: 'Okta 1',
    position: { x: 0, y: 0 },
    subBlocks,
    outputs: {},
    enabled: true,
  } as unknown as BlockState
}

/** The real load-time pipeline: migrate stored state, serialize, then map. */
function runPipeline(state: BlockState): Record<string, unknown> {
  const { blocks } = migrateSubblockIds({ 'block-1': state })
  return merge(extractBlockParams(blocks['block-1']))
}

/**
 * One `sendEmail` switch used to serve activation, reset, deactivation, and
 * deletion. Okta's API default is not uniform across those, so it split in two
 * — orphaning every deactivation toggle a saved workflow had stored.
 */
describe('Okta deactivation toggle saved before the switch split', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBlock.mockReturnValue(OktaBlock)
  })

  it('carries a legacy deactivation toggle onto the wire', () => {
    const mapped = runPipeline(
      legacyBlockState({
        operation: 'okta_deactivate_user',
        apiKey: 'token',
        domain: 'dev-1.okta.com',
        userId: '00u1',
        sendEmail: 'true',
      })
    )

    expect(isOktaFlagEnabled(mapped.sendEmail)).toBe(true)
  })

  it('carries a legacy delete toggle onto the wire', () => {
    const mapped = runPipeline(
      legacyBlockState({
        operation: 'okta_delete_user',
        apiKey: 'token',
        domain: 'dev-1.okta.com',
        userId: '00u1',
        sendEmail: 'true',
      })
    )

    expect(isOktaFlagEnabled(mapped.sendEmail)).toBe(true)
  })

  it('moves the legacy toggle onto the current id in stored state', () => {
    const { blocks, migrated } = migrateSubblockIds({
      'block-1': legacyBlockState({
        operation: 'okta_deactivate_user',
        apiKey: 'token',
        domain: 'dev-1.okta.com',
        userId: '00u1',
        sendEmail: 'true',
      }),
    })

    expect(migrated).toBe(true)
    expect(blocks['block-1'].subBlocks.sendDeactivationEmail?.value).toBe('true')
    expect(blocks['block-1'].subBlocks.sendEmail).toBeUndefined()
  })
})

/**
 * `sendEmail` stays live for activation and password reset, so the migration is
 * scoped to the deactivation half and must leave the other half alone.
 */
describe('Okta activation toggle the rename left alone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBlock.mockReturnValue(OktaBlock)
  })

  it('still sends the activation email from `sendEmail`', () => {
    const mapped = runPipeline(
      legacyBlockState({
        operation: 'okta_activate_user',
        apiKey: 'token',
        domain: 'dev-1.okta.com',
        userId: '00u1',
        sendEmail: 'true',
      })
    )

    expect(isOktaFlagEnabled(mapped.sendEmail)).toBe(true)
  })

  it('leaves an activation toggle under `sendEmail` instead of migrating it', () => {
    const { blocks } = migrateSubblockIds({
      'block-1': legacyBlockState({
        operation: 'okta_activate_user',
        apiKey: 'token',
        domain: 'dev-1.okta.com',
        userId: '00u1',
        sendEmail: 'false',
      }),
    })

    expect(blocks['block-1'].subBlocks.sendEmail?.value).toBe('false')
    expect(blocks['block-1'].subBlocks.sendDeactivationEmail).toBeUndefined()
  })

  it('honours a suppressed activation email', () => {
    const mapped = runPipeline(
      legacyBlockState({
        operation: 'okta_activate_user',
        apiKey: 'token',
        domain: 'dev-1.okta.com',
        userId: '00u1',
        sendEmail: 'false',
      })
    )

    /**
     * Assert the value itself, not just the resolved flag: activation defaults
     * to sending when the param is absent, so a dropped `false` and an honoured
     * one both read as "not enabled" one layer down.
     */
    expect(mapped.sendEmail).toBe('false')
    expect(isOktaFlagEnabled(mapped.sendEmail)).toBe(false)
  })
})

describe('Okta state written after the split is never re-migrated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBlock.mockReturnValue(OktaBlock)
  })

  /**
   * `sendEmail` is seeded `'true'` on every newly placed block, so promoting it
   * would silently notify every user a workflow deactivates.
   */
  it('does not promote the seeded activation toggle onto a deactivation', () => {
    const mapped = runPipeline(
      modernBlockState({
        operation: 'okta_deactivate_user',
        apiKey: 'token',
        domain: 'dev-1.okta.com',
        userId: '00u1',
      })
    )

    expect(mapped.sendEmail).toBeUndefined()
  })

  it('does not overwrite a deactivation toggle the user set', () => {
    const { blocks } = migrateSubblockIds({
      'block-1': modernBlockState({
        operation: 'okta_deactivate_user',
        apiKey: 'token',
        domain: 'dev-1.okta.com',
        userId: '00u1',
        sendEmail: 'true',
        sendDeactivationEmail: 'false',
      }),
    })

    expect(blocks['block-1'].subBlocks.sendDeactivationEmail?.value).toBe('false')
  })

  it('is a no-op the second time it runs', () => {
    const first = migrateSubblockIds({
      'block-1': legacyBlockState({
        operation: 'okta_deactivate_user',
        apiKey: 'token',
        domain: 'dev-1.okta.com',
        userId: '00u1',
        sendEmail: 'true',
      }),
    })
    expect(first.migrated).toBe(true)

    const second = migrateSubblockIds(first.blocks)
    expect(second.migrated).toBe(false)
    expect(second.blocks['block-1'].subBlocks.sendDeactivationEmail?.value).toBe('true')
  })
})

describe('Okta block outputs', () => {
  it('declares only fields a tool emits at the top level', () => {
    const declared = Object.keys(OktaBlock.outputs)
    expect(declared).not.toContain('targets')
    expect(declared).not.toContain('debugData')
    expect(declared).toContain('events')
  })
})
