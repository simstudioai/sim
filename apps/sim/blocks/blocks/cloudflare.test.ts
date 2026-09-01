/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudflareBlock } from '@/blocks/blocks/cloudflare'

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
    vi.clearAllMocks()
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

    /**
     * The headline defect: a proxied A record recreated unproxied publishes the
     * origin IP in public DNS and bypasses the WAF/CDN.
     */
    it('carries a proxied flag saved under the legacy `proxied` id onto the wire', () => {
      const mapped = runPipeline(
        blockState({
          ...CREDENTIALS,
          operation: 'create_dns_record',
          zoneId: 'zone-1',
          type: 'A',
          name: 'app.example.com',
          content: '192.0.2.1',
          proxied: 'true',
        })
      )

      expect(mapped.proxied).toBe(true)
    })

    it('carries tags saved under the legacy `tags` id onto the wire', () => {
      const mapped = runPipeline(
        blockState({
          ...CREDENTIALS,
          operation: 'create_dns_record',
          zoneId: 'zone-1',
          type: 'A',
          name: 'app.example.com',
          content: '192.0.2.1',
          tags: 'production',
        })
      )

      expect(mapped.tags).toBe('production')
    })

    it('carries every field of one shipped proxied A record', () => {
      const mapped = runPipeline(
        blockState({
          ...CREDENTIALS,
          operation: 'create_dns_record',
          zoneId: 'zone-1',
          type: 'A',
          name: 'app.example.com',
          content: '192.0.2.1',
          ttl: '300',
          proxied: 'true',
          comment: 'edge',
          tags: 'production',
        })
      )

      expect(mapped).toMatchObject({
        operation: 'create_dns_record',
        zoneId: 'zone-1',
        type: 'A',
        name: 'app.example.com',
        content: '192.0.2.1',
        ttl: 300,
        proxied: true,
        comment: 'edge',
        tags: 'production',
      })
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

  describe('update_dns_record', () => {
    it('carries content saved under the legacy `content` id onto the wire', () => {
      const mapped = runPipeline(
        blockState({
          ...CREDENTIALS,
          operation: 'update_dns_record',
          zoneId: 'zone-1',
          recordId: 'record-1',
          content: '203.0.113.9',
        })
      )

      expect(mapped.content).toBe('203.0.113.9')
    })

    it('carries type, name, proxied, and tags saved under their legacy ids', () => {
      const mapped = runPipeline(
        blockState({
          ...CREDENTIALS,
          operation: 'update_dns_record',
          zoneId: 'zone-1',
          recordId: 'record-1',
          type: 'A',
          name: 'app.example.com',
          content: '203.0.113.9',
          proxied: 'true',
          tags: 'production',
        })
      )

      expect(mapped).toMatchObject({
        type: 'A',
        name: 'app.example.com',
        content: '203.0.113.9',
        proxied: true,
        tags: 'production',
      })
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

    it('carries a certificate status saved under the legacy `status` id onto the wire', () => {
      const mapped = runPipeline(
        blockState({
          ...CREDENTIALS,
          operation: 'list_certificates',
          zoneId: 'zone-1',
          status: 'active',
        })
      )

      expect(mapped.status).toBe('active')
    })
  })
})

/**
 * The renamed ids all stayed live for a different operation. The migration is
 * scoped so those value spaces are untouched.
 */
describe('Cloudflare value spaces the rename left alone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBlock.mockReturnValue(CloudflareBlock)
  })

  it('still filters a DNS record list by type, name, content, and proxied', () => {
    const mapped = runPipeline(
      blockState({
        ...CREDENTIALS,
        operation: 'list_dns_records',
        zoneId: 'zone-1',
        type: 'MX',
        name: 'mail.example.com',
        content: 'mx1.example.com',
        proxied: 'false',
      })
    )

    expect(mapped).toMatchObject({
      type: 'MX',
      name: 'mail.example.com',
      content: 'mx1.example.com',
      proxied: false,
    })
  })

  it('still purges cache by the tags stored under `tags`', () => {
    const mapped = runPipeline(
      blockState({
        ...CREDENTIALS,
        operation: 'purge_cache',
        zoneId: 'zone-1',
        tags: 'static,images',
      })
    )

    expect(mapped.tags).toBe('static,images')
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
    vi.clearAllMocks()
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

  it('does not promote a stale list name filter onto a record rename', () => {
    const mapped = runPipeline(
      modernBlockState({
        ...CREDENTIALS,
        operation: 'update_dns_record',
        zoneId: 'zone-1',
        recordId: 'record-1',
        name: 'ci-pipeline',
      })
    )

    expect(mapped.name).toBeUndefined()
  })

  it('does not promote a stale purge tag list onto a create record', () => {
    const mapped = runPipeline(
      modernBlockState({
        ...CREDENTIALS,
        operation: 'create_dns_record',
        zoneId: 'zone-1',
        name: 'app.example.com',
        content: '192.0.2.1',
        tags: 'static,images',
      })
    )

    expect(mapped.tags).toBeUndefined()
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

  it('reports no migration for state that already uses the current ids', () => {
    const { migrated } = migrateSubblockIds({
      'block-1': modernBlockState({
        ...CREDENTIALS,
        operation: 'create_dns_record',
        zoneId: 'zone-1',
        recordType: 'CNAME',
      }),
    })

    expect(migrated).toBe(false)
  })
})

/**
 * The migration rewrites stored state, so running it twice must be a no-op —
 * otherwise every load would rewrite the row and re-fire the persist.
 */
describe('Cloudflare migration convergence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
