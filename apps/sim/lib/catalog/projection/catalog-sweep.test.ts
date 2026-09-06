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
  v2ToolDetailSchema,
  v2ToolSummarySchema,
} from '@/lib/api/contracts/v2/catalog'
import { projectBlockDetail } from '@/lib/catalog/projection/block-detail'
import { projectBlockSummary } from '@/lib/catalog/projection/block-summary'
import { projectConnectorType } from '@/lib/catalog/projection/connector-type'
import type { CatalogDeployment } from '@/lib/catalog/projection/tool'
import { projectToolDetail, projectToolSummaryById } from '@/lib/catalog/projection/tool'
import { buildCustomBlockConfig } from '@/blocks/custom/build-config'
import { getBlockRegistry } from '@/blocks/registry'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { getHostedModels } from '@/providers/models'
import { getToolIds } from '@/tools/tool-ids'

/** Hosted deployment: the state under which every declared hosted key is published. */
const HOSTED: CatalogDeployment = { hostedKeys: true }

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
      const detail = projectBlockDetail(block, { deployment: HOSTED })
      expectSerializable(detail, `block detail ${block.type}`)
      expectPublishedIntact(v2BlockDetailSchema, detail, `block detail ${block.type}`)
    }
  })
})

/**
 * Pinned shapes of two real registry blocks, where a projection rule is only
 * visible against an authored block rather than a synthetic fixture.
 */
describe('block detail regressions', () => {
  const registry = getBlockRegistry()
  const registered = (type: string) => {
    const block = registry[type]
    if (!block) throw new Error(`block ${type} is not registered`)
    return block
  }

  it('keys operation inputs by the sub-block id an apply accepts, not the canonical param id', () => {
    const detail = projectBlockDetail(registered('table_v2'), { deployment: HOSTED })
    const inputKeys = Object.keys(detail.operations.query_rows?.inputs ?? {})
    expect(inputKeys).toContain('filter')
    expect(inputKeys).not.toContain('filterInput')
    expect(inputKeys).not.toContain('sortInput')
  })

  /**
   * `blocks get agent` reported `apiKey`, `vertexCredential`, `bedrockAccessKeyId`,
   * `conversationId`, … as `required: true`, because each is authored
   * `required: true` behind a condition the projection flattened away. A field
   * required only under some configuration is optional at the block level, and
   * the condition that requires it is published alongside.
   */
  it('publishes the agent’s conditionally required fields as optional with their condition', () => {
    const detail = projectBlockDetail(registered('agent'), { deployment: HOSTED })
    const byId = new Map(detail.inputSchema.map((field) => [field.id, field]))

    for (const id of ['apiKey', 'vertexCredential', 'vertexProject', 'bedrockAccessKeyId']) {
      const field = byId.get(id)
      expect(field, id).toBeDefined()
      expect(field?.required, id).toBe(false)
      expect(field?.requiredWhen, id).toMatchObject({ field: expect.any(String) })
    }
    expect(byId.get('conversationId')).toMatchObject({
      required: false,
      requiredWhen: { field: expect.any(String) },
    })
    expect(detail.inputSchema.some((field) => field.required === true)).toBe(true)
  })

  it('publishes the agent model picker’s options with the hosted models marked', () => {
    const detail = projectBlockDetail(registered('agent'), { deployment: HOSTED })
    const model = detail.inputSchema.find((field) => field.id === 'model')
    const hosted = new Set(getHostedModels().map((id) => id.toLowerCase()))

    expect(model?.options?.length).toBeGreaterThan(10)
    expect(model?.options?.some((option) => option.hosted === true)).toBe(true)
    for (const option of model?.options ?? []) {
      expect(option.hosted === true, option.id).toBe(hosted.has(option.id.toLowerCase()))
    }
  })

  /**
   * `blocks get table` handed an agent a detail whose `sunset` sat below the
   * operations it had already read, and it built with the superseded block.
   */
  it('leads a sunset block’s detail with its lifecycle state and successor', () => {
    const detail = projectBlockDetail(registered('table'), { deployment: HOSTED })
    expect(Object.keys(detail)[0]).toBe('sunset')
    expect(detail.sunset).toEqual({ status: 'legacy', replacedBy: 'table_v2' })
    expect(detail.description.startsWith('Legacy — replaced by table_v2. ')).toBe(true)
    // utils-lint-allow: verify the actual JSON wire representation, including dropped undefined fields.
    expect(v2BlockDetailSchema.parse(JSON.parse(JSON.stringify(detail))).description).toBe(
      detail.description
    )

    const current = projectBlockDetail(registered('table_v2'), { deployment: HOSTED })
    expect(current.sunset).toBeUndefined()
    expect(current.description.startsWith('Legacy')).toBe(false)
  })

  it('publishes a triggers-category block’s trigger-mode fields as its input schema', () => {
    const detail = projectBlockDetail(registered('schedule'), { deployment: HOSTED })
    const ids = detail.inputSchema.map((field) => field.id)
    expect(ids).toEqual(expect.arrayContaining(['scheduleType', 'cronExpression', 'timezone']))
    expect(ids).not.toContain('scheduleInfo')
  })
})

/**
 * Custom (deploy-as-block) blocks, which the registry sweep above cannot reach.
 *
 * `projectCustomBlockDetail` is a separate branch with its own field set — it
 * publishes `mode: 'trigger'` sub-blocks in `inputSchema`, as the main branch
 * does only for `triggers`-category blocks — yet
 * it is caller-reachable through `GET /api/v2/blocks/custom_block_*`. Built from
 * the same `buildCustomBlockConfig` the overlay uses, so a change to the synthesized
 * shape shows up here rather than as a 500 on a well-formed request.
 */
const CUSTOM_BLOCK_FIXTURES = [
  {
    label: 'curated outputs and every input field kind',
    row: {
      type: 'custom_block_reports',
      name: 'Reports',
      description: 'Run the reports workflow.',
      workflowId: 'workflow-1',
      workspaceName: 'Analytics',
      exposedOutputs: [{ blockId: 'block-1', path: 'result.summary', name: 'summary' }],
    },
    fields: [
      { id: 'field-1', name: 'Region', type: 'string', required: true, placeholder: 'us-east' },
      { id: 'field-2', name: 'Rows', type: 'number', description: 'How many rows.' },
      { id: 'field-3', name: 'Dry run', type: 'boolean' },
      { id: 'field-4', name: 'Filters', type: 'object' },
      { id: 'field-5', name: 'Attachments', type: 'file[]' },
    ],
  },
  {
    label: 'no curated outputs and no input fields',
    row: {
      type: 'custom_block_empty',
      name: 'Empty',
      description: 'A block with nothing curated.',
      workflowId: 'workflow-2',
    },
    fields: [],
  },
] as const

describe('custom block catalog projection sweep', () => {
  const icon = (() => null) as unknown as Parameters<typeof buildCustomBlockConfig>[2]['icon']

  it.each(CUSTOM_BLOCK_FIXTURES)(
    'projects a custom block with $label to a publishable summary and detail',
    ({ row, fields }) => {
      const block = buildCustomBlockConfig(row, [...fields], { icon })

      const summary = projectBlockSummary(block)
      expect(summary.source).toBe('custom')
      expectSerializable(summary, `custom block summary ${row.type}`)
      expectPublishedIntact(v2BlockSummarySchema, summary, `custom block summary ${row.type}`)

      const detail = projectBlockDetail(block, { deployment: HOSTED })
      expectSerializable(detail, `custom block detail ${row.type}`)
      expectPublishedIntact(v2BlockDetailSchema, detail, `custom block detail ${row.type}`)

      /** A custom block runs a bound workflow, so it publishes no operations or tools. */
      expect(detail.operations).toEqual({})
      expect(detail.tools).toEqual([])
      /** Hidden wiring sub-blocks stay out of the published shape. */
      expect(detail.inputSchema.map((field) => field.id)).toEqual(fields.map((field) => field.id))
    }
  )
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
      const summary = projectToolSummaryById(toolId, HOSTED)
      expect(summary, `tool ${toolId} has no metadata`).toBeDefined()
      expectPublishedIntact(v2ToolSummarySchema, summary, `tool summary ${toolId}`)

      const detail = projectToolDetail(toolId, HOSTED)
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
