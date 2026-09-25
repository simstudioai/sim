/** @vitest-environment node */
import type { BlockState } from '@sim/workflow-types/workflow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  v2InspectWorkflowQuerySchema,
  v2WorkflowInspectionSchema,
} from '@/lib/api/contracts/v2/workflow-inspection'
import { presentWorkflowInspection } from '@/lib/workflows/api/workflow-inspection'
import type { ReadWorkflowGraphResult } from '@/lib/workflows/application/read-workflow-graph'
import * as credentialExtractor from '@/lib/workflows/credentials/credential-extractor'
import { getBlock } from '@/blocks/registry'

function graph(): ReadWorkflowGraphResult {
  const block: BlockState = {
    id: 'block-1',
    name: 'Format report',
    type: 'test-block',
    enabled: false,
    position: { x: 0, y: 0 },
    outputs: {},
    subBlocks: {
      code: { id: 'code', type: 'code', value: 'return 42' },
      apiKey: { id: 'apiKey', type: 'short-input', value: 'secret-value' },
      headers: { id: 'headers', type: 'table', value: [['Authorization', 'private-value']] },
      text: { id: 'text', type: 'long-input', value: 'A report' },
      operation: { id: 'operation', type: 'dropdown', value: 'send' },
      unknown: { id: 'unknown', type: 'short-input', value: 'unrecognized-private-value' },
      empty: { id: 'empty', type: 'short-input', value: null },
    },
  }
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    blocks: { 'block-1': block },
    edges: [{ id: 'edge-1', source: 'block-1', target: 'block-2', sourceHandle: 'source' }],
    loops: {},
    parallels: {},
    variables: {},
  }
}

describe('workflow diagnostic projection', () => {
  beforeEach(() => {
    vi.mocked(getBlock).mockReturnValue({
      subBlocks: [
        { id: 'code', type: 'code' },
        { id: 'apiKey', type: 'short-input', password: true },
        { id: 'headers', type: 'table' },
        { id: 'text', type: 'long-input' },
        { id: 'operation', type: 'dropdown' },
        { id: 'empty', type: 'short-input' },
      ],
    } as never)
  })

  it('returns canonical topology and nonempty inputs without credentials, code, UI state, or mutation', () => {
    const source = graph()
    const original = structuredClone(source)
    const result = presentWorkflowInspection(source, { includeCode: false })
    expect(v2WorkflowInspectionSchema.parse(result)).toEqual(result)
    expect(result.blocks).toEqual([
      {
        id: 'block-1',
        name: 'Format report',
        type: 'test-block',
        enabled: false,
        parentId: null,
        inputs: { text: 'A report', operation: 'send' },
        omittedInputs: ['code', 'apiKey', 'headers', 'unknown'],
      },
    ])
    expect(result.edges).toEqual([
      { source: 'block-1', target: 'block-2', sourceHandle: 'source', targetHandle: null },
    ])
    expect(JSON.stringify(result)).not.toContain('secret-value')
    expect(JSON.stringify(result)).not.toContain('private-value')
    expect(source).toEqual(original)
  })

  it('includes code only when requested, redacting recognizable embedded secrets', () => {
    const source = graph()
    source.blocks['block-1'].subBlocks.code.value =
      'const apiKey = "sk_abcdefghijklmnopqrstuvwxyz"; return apiKey'
    const result = presentWorkflowInspection(source, { includeCode: true })
    expect(result.blocks[0].inputs.code).toContain('[REDACTED]')
    expect(JSON.stringify(result)).not.toContain('sk_abcdefghijklmnopqrstuvwxyz')
    expect(result.blocks[0].omittedInputs).not.toContain('code')
  })

  it('bounds oversized and deeply nested inputs and marks truncation', () => {
    const source = graph()
    source.blocks['block-1'].subBlocks.text.value = 'x'.repeat(100_000)
    source.blocks['block-1'].subBlocks.operation.value = {
      a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } },
    }
    const result = presentWorkflowInspection(source, { includeCode: true })
    expect(result.truncated).toBe(true)
    expect(String(result.blocks[0].inputs.text).length).toBeLessThanOrEqual(4096)
    expect(JSON.stringify(result)).not.toContain('deep')
    expect(JSON.stringify(result)).toContain('[TRUNCATED]')
  })

  it('focuses on one block and rejects unknown block IDs', () => {
    const source = graph()
    source.blocks['block-2'] = { ...source.blocks['block-1'], id: 'block-2', enabled: true }
    source.edges.push({ id: 'edge-2', source: 'block-3', target: 'block-4' })
    const result = presentWorkflowInspection(source, { blockId: 'block-2', includeCode: false })
    expect(result.blocks.map(({ id }) => id)).toEqual(['block-2'])
    expect(result.edges).toHaveLength(1)
    expect(() =>
      presentWorkflowInspection(source, { blockId: 'missing', includeCode: false })
    ).toThrow('Block not found')
  })

  it('uses registered code types even when stored type metadata is stale', () => {
    vi.mocked(getBlock).mockReturnValue({
      subBlocks: [
        { id: 'body', type: 'code' },
        { id: 'tools', type: 'tool-input' },
      ],
    } as never)
    const source = graph()
    source.blocks['block-1'].subBlocks = {
      body: { id: 'body', type: 'short-input', value: 'return "private source"' },
      tools: { id: 'tools', type: 'short-input', value: [] },
    }
    const result = presentWorkflowInspection(source, { includeCode: false })
    expect(result.blocks[0].inputs).toEqual({})
    expect(result.blocks[0].omittedInputs).toEqual(['body', 'tools'])
  })

  it('counts keys and stops projecting after the shared budget is exhausted', () => {
    const source = graph()
    source.blocks['block-1'].subBlocks.text.value = { ['k'.repeat(100_000)]: 'value' }
    source.blocks['block-1'].subBlocks.operation.value = Array.from({ length: 50 }, () =>
      'x'.repeat(4096)
    )
    const result = presentWorkflowInspection(source, { includeCode: true })
    expect(result.truncated).toBe(true)
    expect(JSON.stringify(result.blocks[0].inputs).length).toBeLessThan(66_000)
    expect(result.blocks[0].inputs.text).toEqual({})
    expect(result.blocks[0].inputs.operation).toHaveLength(16)
  })

  it('defaults to withholding code and validates boolean and unknown options', () => {
    expect(v2InspectWorkflowQuerySchema.parse({})).toEqual({ includeCode: false })
    expect(v2InspectWorkflowQuerySchema.parse({ includeCode: 'false' }).includeCode).toBe(false)
    expect(v2InspectWorkflowQuerySchema.safeParse({ includeCode: 'yes' }).success).toBe(false)
    expect(v2InspectWorkflowQuerySchema.safeParse({ blockId: '' }).success).toBe(false)
    expect(v2InspectWorkflowQuerySchema.safeParse({ raw: true }).success).toBe(false)
  })

  it('bounds omitted input names as well as projected values', () => {
    const source = graph()
    const oversizedKey = 'unknown_'.repeat(100_000)
    source.blocks['block-1'].subBlocks = {
      [oversizedKey]: { id: oversizedKey, type: 'short-input', value: 'private-input-value' },
      ...Object.fromEntries(
        Array.from({ length: 3000 }, (_, index) => {
          const key = `unknown_${index}`
          return [key, { id: key, type: 'short-input', value: 'private-input-value' }]
        })
      ),
    }

    const result = presentWorkflowInspection(source, { includeCode: false })

    expect(result.truncated).toBe(true)
    expect(result.blocks[0].inputs).toEqual({})
    expect(result.blocks[0].omittedInputs).toHaveLength(2000)
    expect(result.blocks[0].omittedInputs).not.toContain(oversizedKey)
    expect(JSON.stringify(result)).not.toContain('private-input-value')
    expect(JSON.stringify(result).length).toBeLessThan(66_000)
  })

  it('skips malformed persisted sub-block entries without losing valid inputs or mutating state', () => {
    const source = graph()
    source.blocks['block-1'].subBlocks = {
      text: { id: 'text', type: 'long-input', value: 'A report' },
      nullEntry: null,
      numberEntry: 42,
      stringEntry: 'stale',
      arrayEntry: [],
    } as never
    const before = structuredClone(source)

    const result = presentWorkflowInspection(source, { includeCode: false })

    expect(result.blocks[0].inputs).toEqual({ text: 'A report' })
    expect(result.blocks[0].omittedInputs).toEqual([])
    expect(source).toEqual(before)
  })

  it('reads only the first 50 own values of a wide sanitized input', () => {
    const source = graph()
    const readValue = vi.fn(() => 'diagnostic value')
    const wide: Record<string, unknown> = Object.create({ inherited: 'not an input' })
    for (let index = 0; index < 5000; index++) {
      Object.defineProperty(wide, `entry_${index}`, { enumerable: true, get: readValue })
    }
    source.blocks['block-1'].subBlocks = {
      text: { id: 'text', type: 'long-input', value: wide },
    }
    vi.spyOn(credentialExtractor, 'sanitizeWorkflowForSharing').mockReturnValueOnce({
      blocks: source.blocks,
    })

    const result = presentWorkflowInspection(source, { includeCode: false })

    expect(readValue).toHaveBeenCalledTimes(50)
    expect(Object.keys(result.blocks[0].inputs.text as Record<string, unknown>)).toHaveLength(50)
    expect(result.blocks[0].inputs.text).not.toHaveProperty('inherited')
    expect(result.truncated).toBe(true)
  })
})
