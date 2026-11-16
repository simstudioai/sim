/**
 * Registry-wide properties of the block catalog projection.
 *
 * Every assertion runs over the whole live registry rather than fixtures, so a new block that a
 * projection rule cannot handle fails here at authoring time. Set `CATALOG_REPORT_PATH` to write
 * the opaque-site report and the measured core-shard size as JSON.
 */
import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import type { CatalogBlock, CatalogSubBlock } from '@sim/workflow-code'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { v2BlockCatalogSchema } from '@/lib/api/contracts/v2/block-catalog'
import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
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

function isOpaque(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'opaque' in value
}

function siteKey(block: string, subBlock: string, field: string): string {
  return `${block}\u0000${subBlock}\u0000${field}`
}

describe('block catalog projection over the whole registry', () => {
  it('projects every block, subBlock and referenced trigger', () => {
    for (const block of registryBlocks) {
      const projected = catalog.blocks[block.type]
      expect(projected, block.type).toBeDefined()
      expect(projected.subBlocks.map((subBlock) => subBlock.id)).toEqual(
        block.subBlocks.map((subBlock) => subBlock.id)
      )
      if (block.triggers?.enabled) {
        for (const id of block.triggers.available) {
          if (registryTrigger(id))
            expect(catalog.triggers[id], `${block.type} → ${id}`).toBeDefined()
        }
      }
    }
    expect(catalog.blocks.loop.graph.container).toBe('loop')
    expect(catalog.blocks.parallel.graph.container).toBe('parallel')
  })

  it('keeps canonicalParamId pairs consistent with the registry', () => {
    const problems: string[] = []
    for (const block of registryBlocks) {
      const projected = catalog.blocks[block.type]
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
    for (const block of Object.values(catalog.blocks)) visit(block.type, block.subBlocks)
    for (const trigger of Object.values(catalog.triggers)) {
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
      for (const subBlock of catalog.blocks[block.type].subBlocks) {
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
      expect(catalog.blocks[builder.type], path).toBeDefined()
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
    const { addable, ...rest } = scoped.catalog.blocks[first.type]
    expect(addable).toBe(false)
    const { addable: _ignored, ...original }: CatalogBlock = catalog.blocks[first.type]
    expect(rest).toEqual(original)
    expect(scoped.catalog.hash).not.toBe(catalog.hash)
  })

  it('passes through the v2 response schema unchanged, so no projected field is stripped', () => {
    expect(v2BlockCatalogSchema.parse(catalog)).toEqual(catalog)
  })

  it('records the core shard size', () => {
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
            subBlocks: Object.values(catalog.blocks).reduce((n, b) => n + b.subBlocks.length, 0),
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
    expect(gzipped.length).toBeGreaterThan(0)
  })
})
