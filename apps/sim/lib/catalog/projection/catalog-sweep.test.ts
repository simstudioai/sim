/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * Sweeps every code-defined catalog through its projection and its published
 * response schema.
 *
 * v2 `.parse`s a response on the way out, so a projection that emits a field the
 * schema does not declare, or that throws while resolving one, is a 500 on a
 * perfectly well-formed request — the highest-severity defect class on the
 * surface. These sweeps make that a CI failure at authoring time instead.
 *
 * Three specific hazards are pinned here rather than defended against at
 * runtime, because each is a registry-authoring bug that should fail loudly:
 *
 * 1. A sub-block `condition` declared as `(values?) => …` is called with no
 *    arguments. One that dereferences `values` unguarded throws.
 * 2. A projected field the response schema does not declare is silently
 *    stripped by Zod on the way out, so the round-trip comparison below is what
 *    detects it.
 * 3. `getToolIds()` hands out a frozen array, so an in-place `sort()` throws.
 */
vi.unmock('@/blocks/registry')

import {
  v2BlockDetailSchema,
  v2BlockSummarySchema,
  v2ConnectorTypeSchema,
  v2EnrichmentSchema,
  v2ToolDetailSchema,
  v2ToolSummarySchema,
} from '@/lib/api/contracts/v2/catalog'
import { projectBlockDetail } from '@/lib/catalog/projection/block-detail'
import { projectBlockSummary } from '@/lib/catalog/projection/block-summary'
import { projectConnectorType } from '@/lib/catalog/projection/connector-type'
import { projectEnrichment } from '@/lib/catalog/projection/enrichment'
import { projectToolDetail, projectToolSummaryById } from '@/lib/catalog/projection/tool'
import { getBlockRegistry } from '@/blocks/registry'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { ALL_ENRICHMENTS } from '@/enrichments/registry'
import { getToolIds } from '@/tools/tool-ids'

/**
 * Parses a projection against its published schema and asserts nothing was
 * stripped.
 *
 * `.parse` alone is not enough: a response schema is not deeply strict, so an
 * undeclared field passes validation and is quietly dropped from the body the
 * caller receives. Comparing the parsed output against the JSON round-trip of
 * the input catches that at every nesting level.
 */
function expectPublishedIntact(
  schema: { parse: (value: unknown) => unknown },
  projection: unknown,
  label: string
): void {
  /**
   * The exact bytes the route would send, read back. Not a deep clone: a v2
   * response is serialized by `NextResponse.json`, so this is what the caller
   * actually receives, and comparing the parsed schema output against it is
   * what makes a stripped field visible.
   */
  const wire = JSON.stringify(projection)
  const serialized = JSON.parse(wire)
  let parsed: unknown
  try {
    parsed = schema.parse(serialized)
  } catch (error) {
    throw new Error(`${label} failed its response schema: ${(error as Error).message}`)
  }
  expect(parsed, `${label} projects fields its response schema does not declare`).toEqual(
    serialized
  )
}

/**
 * Every value a projection produces must survive JSON, so no closure or React
 * component leaks out of a registry entry.
 *
 * Cycles are tracked against the current ancestor chain rather than a global
 * seen-set: a projection legitimately shares one field object across several
 * operations, and a seen-set reports that ordinary reuse as a cycle.
 */
function expectSerializable(projection: unknown, label: string): void {
  const ancestors = new Set<unknown>()
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'function') throw new Error(`${label} leaks a function at ${path}`)
    if (!value || typeof value !== 'object') return
    if (ancestors.has(value)) throw new Error(`${label} is cyclic at ${path}`)
    ancestors.add(value)
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`))
    } else {
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`)
    }
    ancestors.delete(value)
  }
  walk(projection, label)
}

describe('block catalog projection sweep', () => {
  const blocks = Object.values(getBlockRegistry())

  it('has a non-empty registry to sweep', () => {
    expect(blocks.length).toBeGreaterThan(100)
  })

  it('projects every registered block to a publishable summary', () => {
    for (const block of blocks) {
      const summary = projectBlockSummary(block)
      expectSerializable(summary, `block summary ${block.type}`)
      expectPublishedIntact(v2BlockSummarySchema, summary, `block summary ${block.type}`)
    }
  })

  it('projects every registered block to a publishable detail', () => {
    for (const block of blocks) {
      const detail = projectBlockDetail(block)
      expectSerializable(detail, `block detail ${block.type}`)
      expectPublishedIntact(v2BlockDetailSchema, detail, `block detail ${block.type}`)
    }
  })
})

describe('tool catalog projection sweep', () => {
  const toolIds = getToolIds()

  it('hands out a frozen id list, so a caller must copy before sorting', () => {
    expect(Object.isFrozen(toolIds)).toBe(true)
    expect(() => (toolIds as string[]).sort()).toThrow(TypeError)
    expect(() => [...toolIds].sort()).not.toThrow()
  })

  it('projects every registered tool to a publishable summary and detail', () => {
    expect(toolIds.length).toBeGreaterThan(1000)
    for (const toolId of toolIds) {
      const summary = projectToolSummaryById(toolId)
      expect(summary, `tool ${toolId} has no metadata`).toBeDefined()
      expectPublishedIntact(v2ToolSummarySchema, summary, `tool summary ${toolId}`)

      const detail = projectToolDetail(toolId)
      expect(detail, `tool ${toolId} has no detail`).toBeDefined()
      expectSerializable(detail, `tool detail ${toolId}`)
      expectPublishedIntact(v2ToolDetailSchema, detail, `tool detail ${toolId}`)
    }
  })
})

describe('connector-type catalog projection sweep', () => {
  it('projects every registered connector type to a publishable entry', () => {
    const entries = Object.entries(CONNECTOR_META_REGISTRY)
    expect(entries.length).toBeGreaterThan(10)
    for (const [connectorType, meta] of entries) {
      const projected = projectConnectorType(connectorType, meta)
      expectSerializable(projected, `connector ${connectorType}`)
      expectPublishedIntact(v2ConnectorTypeSchema, projected, `connector ${connectorType}`)
    }
  })
})

describe('enrichment catalog projection sweep', () => {
  it('projects every registered enrichment to a publishable entry', () => {
    expect(ALL_ENRICHMENTS.length).toBeGreaterThan(0)
    for (const enrichment of ALL_ENRICHMENTS) {
      const projected = projectEnrichment(enrichment)
      expectSerializable(projected, `enrichment ${enrichment.id}`)
      expectPublishedIntact(v2EnrichmentSchema, projected, `enrichment ${enrichment.id}`)
    }
  })
})
