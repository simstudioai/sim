/**
 * Registry-wide properties of the block catalog projection.
 *
 * Every assertion runs over the whole live registry rather than fixtures, so a new block that a
 * projection rule cannot handle fails here at authoring time. Set `CATALOG_REPORT_PATH` to write
 * the opaque-site report and the measured core-shard size as JSON.
 */
import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import {
  type CatalogBlock,
  type CatalogSubBlock,
  expandBlockCatalog,
  stableStringify,
} from '@sim/workflow-code'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { v2SourceCatalogSchema } from '@/lib/api/contracts/v2/source-catalog'
import { buildBlockCatalog, projectBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { operationOptions } from '@/lib/workflows/code/catalog/sdk-names'
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'
import type { BlockConfig } from '@/blocks/types'

const registryBlocks = Object.values(getBlockRegistry())
const built = buildBlockCatalog({
  blocks: registryBlocks,
  trigger: registryTrigger,
  sdkNames: SDK_NAMES,
})
const { catalog, report } = built
/** What every consumer reads: the core shard expanded through the package's catalog view. */
const view = expandBlockCatalog(catalog)

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

  it('reports every opaque condition, requirement and option list, and nothing else', () => {
    const markers = new Set<string>()
    const visit = (owner: string, subBlocks: CatalogSubBlock[]) => {
      for (const subBlock of subBlocks) {
        if (isOpaque(subBlock.condition)) markers.add(siteKey(owner, subBlock.id, 'condition'))
        if (isOpaque(subBlock.required)) markers.add(siteKey(owner, subBlock.id, 'required'))
        if (isOpaque(subBlock.options)) markers.add(siteKey(owner, subBlock.id, 'options'))
      }
    }
    for (const block of Object.values(view.blocks)) visit(block.type, block.subBlocks)
    for (const trigger of Object.values(view.triggers)) {
      visit(`trigger:${trigger.id}`, trigger.subBlocks)
    }
    const reported = new Set(
      report.opaque
        .filter((site) => site.field !== 'tool')
        .map((site) => siteKey(site.block, site.subBlock, site.field))
    )
    expect([...reported].sort()).toEqual([...markers].sort())

    const registryFunctionConditions = registryBlocks.reduce(
      (count, block) =>
        count +
        block.subBlocks.filter((subBlock) => typeof subBlock.condition === 'function').length,
      0
    )
    const opaqueConditions = report.opaque.filter(
      (site) => site.field === 'condition' && !site.block.startsWith('trigger:')
    )
    expect(opaqueConditions.length).toBeLessThanOrEqual(registryFunctionConditions)
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
    const again = buildBlockCatalog({
      blocks: fresh,
      trigger: registryTrigger,
      sdkNames: SDK_NAMES,
    })
    expect(again.catalog.hash).toBe(catalog.hash)
    expect(JSON.stringify(again.catalog)).toBe(JSON.stringify(catalog))
  })

  it('marks stored-only types not addable without changing anything else about them', () => {
    const [first] = registryBlocks.filter((block) => !block.hideFromToolbar)
    const scoped = buildBlockCatalog({
      blocks: [first],
      notAddable: new Set([first.type]),
      trigger: registryTrigger,
      sdkNames: SDK_NAMES,
    })
    const { addable, ...rest } = expandBlockCatalog(scoped.catalog).blocks[first.type]
    expect(addable).toBe(false)
    const { addable: _ignored, ...original }: CatalogBlock = view.blocks[first.type]
    expect(rest).toEqual(original)
    expect(scoped.catalog.hash).not.toBe(catalog.hash)
  })

  it('encodes the projection losslessly: core shard plus docs expands to it for every block', () => {
    const { catalog: projection } = projectBlockCatalog({
      blocks: registryBlocks,
      trigger: registryTrigger,
      sdkNames: SDK_NAMES,
    })
    const { hash, ...expanded } = expandBlockCatalog(catalog, built.docs)
    expect(hash).toBe(catalog.hash)
    const mismatched = Object.keys(projection.blocks).filter(
      (type) => stableStringify(expanded.blocks[type]) !== stableStringify(projection.blocks[type])
    )
    expect(mismatched).toEqual([])
    expect(Object.keys(expanded.blocks)).toEqual(Object.keys(projection.blocks))
    expect(expanded).toEqual(projection)
  })

  it('stores no trigger subBlock twice: every trigger-surface run that matches is a reference', () => {
    const full = expandBlockCatalog(catalog, built.docs)
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
      for (const site of report.opaque) {
        const key =
          site.field === 'condition' && site.expanded ? 'condition (expanded)' : site.field
        byField[key] = (byField[key] ?? 0) + 1
      }
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
            opaque: report.opaque,
          },
          null,
          2
        )
      )
    }
    expect(gzipped.length).toBeLessThanOrEqual(CORE_SHARD_GZIP_BUDGET_BYTES)
  })
})
