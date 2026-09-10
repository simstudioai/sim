/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

vi.mock('@/lib/workflows/search-replace/indexer', () => ({
  getToolInputParamConfigs: vi.fn(),
}))

import { buildWorkflowImportPlan } from '@/lib/workflows/references/import-plan'
import { buildWorkflowReferenceManifest } from '@/lib/workflows/references/manifest'
import {
  applyDependentOverrides,
  readTargetDraftDependentValue,
  remapForkSubBlocks,
} from '@/lib/workflows/references/remap-references'
import { sanitizeForExport } from '@/lib/workflows/sanitization/json-sanitizer'
import { getToolInputParamConfigs } from '@/lib/workflows/search-replace/indexer'
import { getBlock } from '@/blocks/registry'

const configs: Record<string, SubBlockConfig[]> = {
  agent: [{ id: 'tools', type: 'tool-input', title: 'Tools' }],
  function: [
    { id: 'code', type: 'code', title: 'Code' },
    { id: 'files', type: 'file-upload', title: 'Files' },
  ],
  logs: [
    {
      id: 'workflowSelector',
      type: 'dropdown',
      title: 'Workflows',
      selectorKey: 'sim.workflows',
      multiSelect: true,
      canonicalParamId: 'workflowIds',
      mode: 'basic',
    },
    {
      id: 'manualWorkflowIds',
      type: 'short-input',
      title: 'Workflows',
      canonicalParamId: 'workflowIds',
      mode: 'advanced',
    },
  ],
}

function workflow(type: string, values: Record<string, unknown>): WorkflowState {
  return {
    blocks: {
      source: {
        id: 'source',
        type,
        name: type,
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: Object.fromEntries(
          Object.entries(values).map(([id, value]) => [
            id,
            {
              id,
              type: configs[type].find((field) => field.id === id)!.type,
              value: value as WorkflowState['blocks'][string]['subBlocks'][string]['value'],
            },
          ])
        ),
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}

beforeEach(() => {
  vi.mocked(getBlock).mockImplementation((type) =>
    configs[type] ? ({ subBlocks: configs[type] } as BlockConfig) : undefined
  )
  vi.mocked(getToolInputParamConfigs).mockImplementation(({ tool }) =>
    (configs[tool.type] ?? []).map((config) => ({
      paramId: config.id,
      config,
      authoritative: true,
      value: tool.params?.[config.id],
    }))
  )
})

describe('portable reference occurrence codecs', () => {
  it.each([false, true])(
    'binds repeated nested environment names independently (serialized=%s)',
    (serialized) => {
      const tools = [
        { type: 'function', params: { code: 'return "{{SECRET}}"' } },
        { type: 'function', params: { code: 'return "{{SECRET}}"' } },
      ]
      const source = workflow('agent', { tools: serialized ? JSON.stringify(tools) : tools })
      const manifest = buildWorkflowReferenceManifest(source.blocks)
      expect(manifest.references).toHaveLength(1)
      expect(manifest.references[0].occurrences.map((occurrence) => occurrence.valuePath)).toEqual([
        [0, 'params', 'code'],
        [1, 'params', 'code'],
      ])
      const exported = {
        ...sanitizeForExport(source, { includeReferences: true }),
        referenceManifest: manifest,
      }
      const plan = buildWorkflowImportPlan(exported, {
        bindings: manifest.references[0].occurrences.map((occurrence, index) => ({
          ...occurrence,
          kind: 'env-var',
          targetId: index === 0 ? 'FIRST_SECRET' : 'SECOND_SECRET',
        })),
      })
      expect(plan.unresolvedBindings).toEqual([])
      const result = plan.state.blocks.source.subBlocks.tools.value
      expect(typeof result === 'string' ? JSON.parse(result) : result).toEqual([
        { type: 'function', params: { code: 'return "{{FIRST_SECRET}}"' } },
        { type: 'function', params: { code: 'return "{{SECOND_SECRET}}"' } },
      ])
    }
  )

  it.each([false, true])(
    'keeps nested file occurrences and repeated positions (serialized=%s)',
    (serialized) => {
      const files = [{ key: 'source/file' }, { key: 'source/file' }]
      const tools = [
        { type: 'function', params: { files } },
        { type: 'function', params: { files: JSON.stringify(files) } },
      ]
      const source = workflow('agent', { tools: serialized ? JSON.stringify(tools) : tools })
      const manifest = buildWorkflowReferenceManifest(source.blocks)
      expect(
        manifest.references[0].occurrences.map(({ valuePath, positions }) => ({
          valuePath,
          positions,
        }))
      ).toEqual([
        { valuePath: [0, 'params', 'files'], positions: [0, 1] },
        { valuePath: [1, 'params', 'files'], positions: [0, 1] },
      ])
      const plan = buildWorkflowImportPlan(
        { ...sanitizeForExport(source, { includeReferences: true }), referenceManifest: manifest },
        {
          mappings: [{ kind: 'file', sourceId: 'source/file', targetId: 'target/file' }],
        }
      )
      const result = plan.state.blocks.source.subBlocks.tools.value
      expect(typeof result === 'string' ? JSON.parse(result) : result).toEqual([
        { type: 'function', params: { files: [{ key: 'target/file' }, { key: 'target/file' }] } },
        { type: 'function', params: { files: [{ key: 'target/file' }, { key: 'target/file' }] } },
      ])
    }
  )

  it.each(['workflow-a,workflow-b', ['workflow-a', 'workflow-b']])(
    'discovers registered workflow dropdown selections %j',
    (value) => {
      const source = workflow('logs', { workflowSelector: value })
      const manifest = buildWorkflowReferenceManifest(source.blocks)
      expect(manifest.references.map((reference) => reference.sourceId)).toEqual([
        'workflow-a',
        'workflow-b',
      ])
      const plan = buildWorkflowImportPlan(source, {
        mappings: manifest.references.map((reference) => ({
          kind: 'workflow',
          sourceId: reference.sourceId,
          targetId: `target-${reference.sourceId}`,
        })),
      })
      expect(plan.state.blocks.source.subBlocks.workflowSelector.value).toEqual(
        Array.isArray(value)
          ? ['target-workflow-a', 'target-workflow-b']
          : 'target-workflow-a,target-workflow-b'
      )
    }
  )

  it('keeps manual workflow selectors outside resource mapping', () => {
    const source = workflow('logs', {
      workflowSelector: 'old-workflow',
      manualWorkflowIds: 'manual-workflow',
    })
    source.blocks.source.data = { canonicalModes: { workflowIds: 'advanced' } }
    expect(buildWorkflowReferenceManifest(source.blocks).references).toEqual([])
  })

  it('preserves own prototype-named data without exposing unsafe manifest locators', () => {
    const source = workflow('function', {
      code: JSON.parse('{"__proto__":{"polluted":"{{SECRET}}"},"safe":"{{SECRET}}"}'),
    })
    const remapped = remapForkSubBlocks(source.blocks.source.subBlocks, () => 'TARGET', 'promote', {
      blockType: 'function',
    })
    const value = remapped.subBlocks.code.value as Record<string, unknown>
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect(value.__proto__).toEqual({ polluted: '{{TARGET}}' })
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
    expect(
      buildWorkflowReferenceManifest(source.blocks).references[0].occurrences.map(
        (occurrence) => occurrence.valuePath
      )
    ).toEqual([['safe']])
  })

  it('applies legacy MCP tool-name overrides using the mapped server', () => {
    const type = 'mcp'
    const source = workflow('agent', {
      tools: [
        { type, toolId: 'stale-tool', params: { serverId: 'target-server', toolName: null } },
      ],
    })
    const result = applyDependentOverrides(
      source.blocks.source.subBlocks,
      'agent',
      new Map([
        ['tools[0].toolName', 'lookup'],
        ['tools[0].serverId', 'forbidden-server'],
      ])
    )
    expect(result.tools.value).toEqual([
      {
        type,
        toolId: 'mcp-target-server-lookup',
        params: { serverId: 'target-server', toolName: 'lookup' },
      },
    ])
  })

  it('does not add an individual tool selection to an advanced MCP server binding', () => {
    const source = workflow('agent', {
      tools: [{ type: 'mcp-server-advanced', params: { serverId: 'target-server' } }],
    })
    const result = applyDependentOverrides(
      source.blocks.source.subBlocks,
      'agent',
      new Map([['tools[0].toolName', 'lookup']])
    )
    expect(result.tools.value).toEqual(source.blocks.source.subBlocks.tools.value)
  })

  it.each([{ value: ['first', 'second'] }, { value: [] }])(
    'reads string-array dependent selections at both field levels: $value',
    ({ value }) => {
      const fields = {
        columns: { value },
        tools: { value: [{ type: 'function', params: { columns: value } }] },
      }
      expect(readTargetDraftDependentValue(fields, fields, 'columns')).toBe(value.join(','))
      expect(readTargetDraftDependentValue(fields, fields, 'tools[0].columns')).toBe(
        value.join(',')
      )
    }
  )

  it('rejects mixed arrays and objects when reading dependent selections', () => {
    for (const value of [['first', 1], { column: 'first' }]) {
      const fields = {
        columns: { value },
        tools: { value: [{ type: 'function', params: { columns: value } }] },
      }
      expect(readTargetDraftDependentValue(fields, fields, 'columns')).toBe('')
      expect(readTargetDraftDependentValue(fields, fields, 'tools[0].columns')).toBe('')
    }
  })
})
