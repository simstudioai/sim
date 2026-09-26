import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateSubblockIds } from '@/lib/workflows/migrations/subblock-migrations'
import { CloudflareBlock } from '@/blocks/blocks/cloudflare'
import { getBlock } from '@/blocks/registry'
import { extractBlockParams } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'

const mockGetBlock = vi.mocked(getBlock)

/**
 * Block state exactly as the canvas persists it: one entry per sub-block id,
 * and nothing else. A workflow saved before an id rename carries only the ids
 * that existed then, which is what makes the migration's "target absent" test
 * mean "this state predates the rename".
 */
function blockState(values: Record<string, unknown>, advancedMode = false): BlockState {
  return {
    id: 'block-1',
    type: 'cloudflare',
    name: 'Cloudflare 1',
    position: { x: 0, y: 0 },
    advancedMode,
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([id, value]) => [id, { id, type: 'short-input', value }])
    ),
    outputs: {},
    enabled: true,
  } as unknown as BlockState
}

/**
 * Block state as it exists for a block CREATED after the renames: `prepareBlockState`
 * materializes an entry for every declared sub-block and the add-block write
 * persists that map wholesale, so every current id is present — seeded, or
 * `null` where the control has no seed.
 */
function modernBlockState(overrides: Record<string, unknown>, advancedMode = false): BlockState {
  const subBlocks: Record<string, unknown> = {}
  for (const subBlock of CloudflareBlock.subBlocks) {
    subBlocks[subBlock.id] = {
      id: subBlock.id,
      type: subBlock.type,
      value: typeof subBlock.value === 'function' ? subBlock.value({}) : null,
    }
  }
  for (const [id, value] of Object.entries(overrides)) {
    const declared = CloudflareBlock.subBlocks.find((subBlock) => subBlock.id === id)
    subBlocks[id] = { id, type: declared?.type ?? 'short-input', value }
  }

  return {
    id: 'block-1',
    type: 'cloudflare',
    name: 'Cloudflare 1',
    position: { x: 0, y: 0 },
    advancedMode,
    subBlocks,
    outputs: {},
    enabled: true,
  } as unknown as BlockState
}

/**
 * Mirror the executor merge — `finalInputs = { ...inputs, ...transformedParams }`
 * in `executor/handlers/generic/generic-handler.ts` — so a key the mapper omits
 * keeps its raw block value and only an explicit `undefined` erases it.
 */
function mapParams(params: Record<string, unknown>): Record<string, unknown> {
  const transform = CloudflareBlock.tools.config?.params
  if (!transform) throw new Error('Cloudflare block has no params transform')
  return { ...params, ...transform(params) }
}

/** The real load-time pipeline: migrate stored state, serialize, then map. */
function runPipeline(state: BlockState): Record<string, unknown> {
  const { blocks } = migrateSubblockIds({ 'block-1': state })
  return mapParams(extractBlockParams(blocks['block-1']))
}

const CREDENTIALS = { apiKey: 'cf-token' }

describe('Cloudflare DNS write values saved before the id rename', () => {
  beforeEach(() => {
    mockGetBlock.mockReturnValue(CloudflareBlock)
  })

  describe('create_dns_record', () => {
    it('carries a record type saved under the legacy `type` id onto the wire', () => {
      const mapped = runPipeline(
        blockState({
          ...CREDENTIALS,
          operation: 'create_dns_record',
          zoneId: 'zone-1',
          type: 'CNAME',
          name: 'app.example.com',
          content: 'origin.example.com',
        })
      )

      expect(mapped.type).toBe('CNAME')
    })

    it('recovers the legacy value with the block advanced toggle on', () => {
      const mapped = runPipeline(
        blockState(
          {
            ...CREDENTIALS,
            operation: 'create_dns_record',
            zoneId: 'zone-1',
            type: 'CNAME',
            name: 'app.example.com',
            content: 'origin.example.com',
            proxied: 'true',
          },
          true
        )
      )

      expect(mapped).toMatchObject({ type: 'CNAME', proxied: true })
    })
  })

  describe('list filters that were also renamed', () => {
    it('carries a sort field saved under the legacy `order` id onto the wire', () => {
      const mapped = runPipeline(
        blockState({
          ...CREDENTIALS,
          operation: 'list_dns_records',
          zoneId: 'zone-1',
          order: 'ttl',
        })
      )

      expect(mapped.order).toBe('ttl')
    })
  })
})

/**
 * The renamed ids all stayed live for a different operation. The migration is
 * scoped so those value spaces are untouched.
 */
describe('Cloudflare value spaces the rename left alone', () => {
  beforeEach(() => {
    mockGetBlock.mockReturnValue(CloudflareBlock)
  })

  it('leaves a list filter in place instead of migrating it to a write control', () => {
    const { blocks } = migrateSubblockIds({
      'block-1': blockState({
        ...CREDENTIALS,
        operation: 'list_dns_records',
        zoneId: 'zone-1',
        type: 'MX',
        name: 'mail.example.com',
      }),
    })

    const subBlocks = blocks['block-1'].subBlocks
    expect(subBlocks.type?.value).toBe('MX')
    expect(subBlocks.name?.value).toBe('mail.example.com')
    expect(subBlocks.recordType).toBeUndefined()
    expect(subBlocks.updateRecordType).toBeUndefined()
    expect(subBlocks.updateRecordName).toBeUndefined()
  })
})

/**
 * A block created after the renames carries every current id, which is exactly
 * what tells the migration the state is not legacy. Nothing may move.
 */
describe('Cloudflare state written after the rename is never re-migrated', () => {
  beforeEach(() => {
    mockGetBlock.mockReturnValue(CloudflareBlock)
  })

  it('does not promote a stale list type filter onto a create record', () => {
    const mapped = runPipeline(
      modernBlockState({
        ...CREDENTIALS,
        operation: 'create_dns_record',
        zoneId: 'zone-1',
        // Typed while the block was on `list_dns_records`, then the operation
        // changed. `recordType` is still sitting at its seeded default.
        type: 'MX',
        name: 'app.example.com',
        content: '192.0.2.1',
      })
    )

    expect(mapped.type).toBe('A')
  })

  it('does not overwrite a record type the user picked', () => {
    const { blocks } = migrateSubblockIds({
      'block-1': modernBlockState({
        ...CREDENTIALS,
        operation: 'create_dns_record',
        zoneId: 'zone-1',
        type: 'MX',
        recordType: 'CNAME',
      }),
    })

    expect(blocks['block-1'].subBlocks.recordType?.value).toBe('CNAME')
  })
})

/**
 * The migration rewrites stored state, so running it twice must be a no-op —
 * otherwise every load would rewrite the row and re-fire the persist.
 */
describe('Cloudflare migration convergence', () => {
  beforeEach(() => {
    mockGetBlock.mockReturnValue(CloudflareBlock)
  })

  it('is a no-op the second time it runs', () => {
    const legacy = blockState({
      ...CREDENTIALS,
      operation: 'create_dns_record',
      zoneId: 'zone-1',
      type: 'CNAME',
      proxied: 'true',
    })

    const first = migrateSubblockIds({ 'block-1': legacy })
    expect(first.migrated).toBe(true)

    const second = migrateSubblockIds(first.blocks)
    expect(second.migrated).toBe(false)
    expect(second.blocks['block-1'].subBlocks.recordType?.value).toBe('CNAME')
    expect(second.blocks['block-1'].subBlocks.recordProxied?.value).toBe('true')
  })
})
