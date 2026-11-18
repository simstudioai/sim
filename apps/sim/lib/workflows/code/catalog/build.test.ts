/**
 * Registry-wide properties of the block catalog projection.
 *
 * Every assertion runs over the whole live registry rather than fixtures, so a new block that a
 * projection rule cannot handle fails here at authoring time. Set `CATALOG_REPORT_PATH` to write
 * the opaque-site counts and the measured core-shard size as JSON.
 */
import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import {
  type CatalogSubBlock,
  type ExpandedBlockCatalog,
  expandBlockCatalog,
  stableStringify,
} from '@sim/workflow-code'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')

import { v2SourceCatalogSchema } from '@/lib/api/contracts/v2/source-catalog'
import {
  buildBlockCatalog,
  projectBlockCatalog,
  withNotAddableBlocks,
} from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { operationOptions } from '@/lib/workflows/code/catalog/sdk-names'
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

const registryBlocks = Object.values(getBlockRegistry())
const registryInput = { blocks: registryBlocks, trigger: registryTrigger, sdkNames: SDK_NAMES }
const catalog = buildBlockCatalog(registryInput)
/** What every consumer reads: the core shard expanded through the package's catalog view. */
const view = expandBlockCatalog(catalog)
/** The projection before encoding. */
const projection = projectBlockCatalog(registryInput)

/**
 * `catalog` with every non-`operation` block option label read as its id: the labels the core
 * shard drops (a block's trigger run keeps its trigger's labels, so both sides are normalized).
 */
function withBlockLabelsAsIds<C extends Omit<ExpandedBlockCatalog, 'hash'>>(catalog: C): C {
  const blocks = Object.fromEntries(
    Object.entries(catalog.blocks).map(([type, block]) => [
      type,
      {
        ...block,
        subBlocks: block.subBlocks.map((subBlock) =>
          Array.isArray(subBlock.options) && subBlock.id !== 'operation'
            ? { ...subBlock, options: subBlock.options.map(({ id }) => ({ id, label: id })) }
            : subBlock
        ),
      },
    ])
  )
  return { ...catalog, blocks }
}

function isOpaque(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'opaque' in value
}

function siteKey(block: string, subBlock: string, field: string): string {
  return `${block}\u0000${subBlock}\u0000${field}`
}

/**
 * The gzipped core shard every SDK client downloads. Measured at 1,105,482 bytes over 513 blocks;
 * the budget leaves about 8% for growth. Shrinking the catalog should lower it; raise it only with
 * a measured reason recorded here.
 */
const CORE_SHARD_GZIP_BUDGET_BYTES = 1_200_000

describe('block catalog projection over the whole registry', () => {
  it('projects every block, subBlock and referenced trigger', () => {
    for (const block of registryBlocks) {
      const projected = view.blocks[block.type]
      expect(projected, block.type).toBeDefined()
      expect(projected.subBlocks.map((subBlock) => subBlock.id)).toEqual(
        block.subBlocks.map((subBlock) => subBlock.id)
      )
      if (block.triggers?.enabled) {
        for (const id of block.triggers.available) {
          if (registryTrigger(id)) expect(view.triggers[id], `${block.type} → ${id}`).toBeDefined()
        }
      }
    }
    expect(view.blocks.loop.graph.container).toBe('loop')
    expect(view.blocks.parallel.graph.container).toBe('parallel')
  })

  it('keeps canonicalParamId pairs consistent with the registry', () => {
    const problems: string[] = []
    for (const block of registryBlocks) {
      const projected = view.blocks[block.type]
      block.subBlocks.forEach((subBlock, index) => {
        if (projected.subBlocks[index].canonicalParamId !== subBlock.canonicalParamId) {
          problems.push(`${block.type}.${subBlock.id}: canonicalParamId changed`)
        }
      })
      const bySurface = new Map<string, CatalogSubBlock[]>()
      for (const subBlock of projected.subBlocks) {
        const surface = subBlock.surface ?? 'action'
        bySurface.set(surface, [...(bySurface.get(surface) ?? []), subBlock])
      }
      for (const [surface, subBlocks] of bySurface) {
        const groups = new Map<string, CatalogSubBlock[]>()
        for (const subBlock of subBlocks) {
          if (!subBlock.canonicalParamId) continue
          groups.set(subBlock.canonicalParamId, [
            ...(groups.get(subBlock.canonicalParamId) ?? []),
            subBlock,
          ])
        }
        for (const [canonicalId, members] of groups) {
          const foreign = subBlocks.find(
            (subBlock) => subBlock.id === canonicalId && subBlock.canonicalParamId !== canonicalId
          )
          if (foreign)
            problems.push(`${block.type} ${surface}: ${canonicalId} is also a foreign id`)
          const memberIds = new Set(members.map((member) => member.id))
          if (memberIds.size < 2) continue
          const selectorMembers = members.filter((member) =>
            ['resource', 'picked', 'upload'].includes(member.valueKind)
          )
          const basicIds = new Set(
            selectorMembers
              .filter((member) => member.mode !== 'advanced' && member.mode !== 'trigger-advanced')
              .map((member) => member.id)
          )
          if (selectorMembers.length > 0 && basicIds.size === 0) {
            problems.push(`${block.type} ${surface}: ${canonicalId} has no basic selector member`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('marks a condition, requirement or option list opaque only where the registry holds a function', () => {
    const misplaced: string[] = []
    const check = (owner: string, configs: SubBlockConfig[], projected: CatalogSubBlock[]) => {
      configs.forEach((config, index) => {
        for (const field of ['condition', 'required', 'options'] as const) {
          if (isOpaque(projected[index][field]) && typeof config[field] !== 'function') {
            misplaced.push(siteKey(owner, config.id, field))
          }
        }
      })
    }
    for (const block of registryBlocks) {
      check(block.type, block.subBlocks, view.blocks[block.type].subBlocks)
    }
    for (const [id, trigger] of Object.entries(view.triggers)) {
      const config = registryTrigger(id)
      if (config) check(`trigger:${id}`, config.subBlocks, trigger.subBlocks)
    }
    expect(misplaced).toEqual([])
  })

  it('pre-expands operation-only conditions for exactly the block operations', () => {
    for (const block of registryBlocks) {
      const operations = operationOptions(block).map((operation) => operation.id)
      for (const subBlock of view.blocks[block.type].subBlocks) {
        if (!subBlock.visibleFor) continue
        expect(isOpaque(subBlock.condition), `${block.type}.${subBlock.id}`).toBe(true)
        expect(Object.keys(subBlock.visibleFor)).toEqual(operations)
      }
    }
  })

  it('records what an operation returns and which credentials a credential field takes', () => {
    const send = view.blocks.slack_v2.operationOutputs?.send
    expect(send?.names).toContain('ts')
    expect(send?.names).not.toContain('canvas_id')
    expect(view.blocks.table_v2.operationOutputs?.query_rows?.nullable).toEqual(['nextCursor'])
    const gmailCredential = view.blocks.gmail_v2.subBlocks.find(
      (subBlock) => subBlock.type === 'oauth-input'
    )
    expect(gmailCredential?.credentialProviders).toEqual(['google-email', 'google-service-account'])
  })

  it('gives every operation a builder that pins it', () => {
    const missing: string[] = []
    for (const block of registryBlocks) {
      const pinned = new Set(
        Object.values(catalog.builders)
          .filter((builder) => builder.type === block.type && !builder.triggerMode)
          .map((builder) => builder.operation)
      )
      for (const operation of operationOptions(block)) {
        if (!pinned.has(operation.id)) missing.push(`${block.type}.${operation.id}`)
      }
    }
    expect(missing).toEqual([])
    for (const [path, builder] of Object.entries(catalog.builders)) {
      expect(view.blocks[builder.type], path).toBeDefined()
    }
  })

  it('is deterministic: rebuilt from fresh config objects in reverse order, the hash matches', () => {
    const fresh: BlockConfig[] = [...registryBlocks].reverse().map((block) => ({ ...block }))
    const again = buildBlockCatalog({ ...registryInput, blocks: fresh })
    expect(again.hash).toBe(catalog.hash)
    expect(JSON.stringify(again)).toBe(JSON.stringify(catalog))
  })

  it('overlays stored-only types as not addable without changing anything else about them', () => {
    const stored = registryBlocks.find(
      (block) => block.triggers?.enabled && SDK_NAMES.blocks[block.type] && !block.hideFromToolbar
    )
    if (!stored) throw new Error('The registry has no named block with triggers')
    const base = buildBlockCatalog({
      ...registryInput,
      blocks: registryBlocks.filter((block) => block !== stored),
    })
    const baseBytes = JSON.stringify(base)

    const overlaid = withNotAddableBlocks(base, [stored], registryInput)
    const expanded = expandBlockCatalog(overlaid)

    const { addable, ...rest } = expanded.blocks[stored.type]
    expect(addable).toBe(false)
    expect(rest).toEqual(projection.blocks[stored.type])
    for (const id of stored.triggers?.available ?? []) {
      expect(expanded.triggers[id]).toEqual(view.triggers[id])
    }
    const storedBuilders = Object.entries(catalog.builders).filter(
      ([, builder]) => builder.type === stored.type
    )
    expect(storedBuilders.length).toBeGreaterThan(0)
    for (const [path, builder] of storedBuilders) expect(overlaid.builders[path]).toEqual(builder)
    expect(expanded.blocks).toMatchObject(
      Object.fromEntries(Object.keys(base.blocks).map((type) => [type, view.blocks[type]]))
    )

    expect(JSON.stringify(base)).toBe(baseBytes)
    expect(overlaid.hash).not.toBe(base.hash)
    expect(withNotAddableBlocks(base, [stored], registryInput).hash).toBe(overlaid.hash)
    expect(withNotAddableBlocks(base, [], registryInput)).toBe(base)
  })

  it('encodes the projection losslessly but for the block option labels it drops', () => {
    const { hash, ...expanded } = view
    expect(hash).toBe(catalog.hash)
    const served = withBlockLabelsAsIds(expanded)
    const projected = withBlockLabelsAsIds(projection)
    const mismatched = Object.keys(projected.blocks).filter(
      (type) => stableStringify(served.blocks[type]) !== stableStringify(projected.blocks[type])
    )
    expect(mismatched).toEqual([])
    expect(Object.keys(served.blocks)).toEqual(Object.keys(projected.blocks))
    expect(served).toEqual(projected)
  })

  it('stores no trigger subBlock twice: every trigger-surface run that matches is a reference', () => {
    const full = view
    const triggerKeys = new Set(
      Object.values(full.triggers).flatMap((trigger) =>
        trigger.subBlocks.map((subBlock) => stableStringify({ ...subBlock, surface: 'trigger' }))
      )
    )
    const copied: string[] = []
    for (const [type, block] of Object.entries(catalog.blocks)) {
      let index = 0
      for (const entry of block.subBlocks) {
        if ('trigger' in entry) {
          index += entry.count
          continue
        }
        const expanded = full.blocks[type].subBlocks[index]
        if (expanded.surface === 'trigger' && triggerKeys.has(stableStringify(expanded))) {
          copied.push(`${type}.${expanded.id}`)
        }
        index += 1
      }
    }
    expect(copied).toEqual([])
  })

  it('passes through the v2 response schema unchanged, so no projected field is stripped', () => {
    expect(v2SourceCatalogSchema.parse(catalog)).toEqual(catalog)
  })

  it('keeps the core shard under its gzip budget', () => {
    const raw = Buffer.from(JSON.stringify(catalog))
    const gzipped = gzipSync(raw)
    const reportPath = process.env.CATALOG_REPORT_PATH
    if (reportPath) {
      const byField: Record<string, number> = {}
      const subBlocks = [
        ...Object.values(view.blocks).flatMap((block) => block.subBlocks),
        ...Object.values(view.triggers).flatMap((trigger) => trigger.subBlocks),
      ]
      for (const subBlock of subBlocks) {
        for (const field of ['condition', 'required', 'options'] as const) {
          if (!isOpaque(subBlock[field])) continue
          const key = field === 'condition' && subBlock.visibleFor ? 'condition (expanded)' : field
          byField[key] = (byField[key] ?? 0) + 1
        }
      }
      byField.tool = Object.values(view.blocks).filter(
        (block) => block.tools.selector === 'opaque'
      ).length
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            hash: catalog.hash,
            blocks: Object.keys(catalog.blocks).length,
            triggers: Object.keys(catalog.triggers).length,
            builders: Object.keys(catalog.builders).length,
            subBlocks: Object.values(view.blocks).reduce((n, b) => n + b.subBlocks.length, 0),
            coreShardBytes: raw.length,
            coreShardGzipBytes: gzipped.length,
            opaqueByField: byField,
          },
          null,
          2
        )
      )
    }
    expect(gzipped.length).toBeLessThanOrEqual(CORE_SHARD_GZIP_BUDGET_BYTES)
  })
})
