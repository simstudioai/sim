/** @vitest-environment node */
import type { ComponentProps } from 'react'
import type { ChipCombobox } from '@sim/emcn'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  combobox: vi.fn<(props: ComponentProps<typeof ChipCombobox>) => null>(() => null),
  setValue: vi.fn(),
  longInput: vi.fn(() => null),
  shortInput: vi.fn(() => null),
  values: {} as Record<string, unknown>,
  modes: { server: 'basic', tool: 'basic' } as Record<string, 'basic' | 'advanced'>,
  baselineModes: undefined as Record<string, 'basic' | 'advanced'> | undefined,
}))
vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (
    selector: (state: {
      blocks: Record<string, { data: { canonicalModes: typeof mocks.modes } }>
    }) => unknown
  ) => selector({ blocks: { 'block-1': { data: { canonicalModes: mocks.modes } } } }),
}))
vi.mock('@/stores/workflow-diff/store', () => ({
  useWorkflowDiffStore: (
    selector: (state: {
      hasActiveDiff: boolean
      isShowingDiff: boolean
      baselineWorkflow: {
        blocks: Record<string, { data: { canonicalModes: typeof mocks.baselineModes } }>
      }
    }) => unknown
  ) =>
    selector({
      hasActiveDiff: !!mocks.baselineModes,
      isShowingDiff: false,
      baselineWorkflow: {
        blocks: { 'block-1': { data: { canonicalModes: mocks.baselineModes } } },
      },
    }),
}))
vi.mock('@sim/emcn', () => ({ ChipCombobox: mocks.combobox, Label: () => null }))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/long-input/long-input',
  () => ({ LongInput: mocks.longInput })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/short-input/short-input',
  () => ({ ShortInput: mocks.shortInput })
)
vi.mock('@/tools/params', () => ({ formatParameterLabel: (name: string) => name }))
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }))
vi.mock('@/hooks/queries/mcp', () => ({
  useMcpToolServers: () => ({ data: [{ id: 'server-1', name: 'Server one', enabled: true }] }),
}))
vi.mock('@/hooks/mcp/use-mcp-tools', () => ({
  useMcpTools: () => ({
    mcpTools: [
      {
        id: 'server-1-read',
        name: 'read',
        serverId: 'server-1',
        canonicalServerId: 'canonical-1',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        id: 'server-1-write',
        name: 'write',
        serverId: 'server-1',
        canonicalServerId: 'canonical-1',
        inputSchema: { type: 'object' },
      },
    ],
    refreshTools: vi.fn(),
  }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: (_blockId: string, id: string) => [
      mocks.values[id],
      (value: unknown) => mocks.setValue(id, value),
    ],
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider',
  () => ({ useActiveSearchTarget: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight',
  () => ({ getWorkflowSearchLabelHighlight: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text',
  () => ({ formatDisplayText: (text: string) => text })
)

import { McpDynamicArgs } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/mcp-dynamic-args/mcp-dynamic-args'
import { McpServerSelector } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/mcp-server-modal/mcp-server-selector'
import { McpToolSelector } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/mcp-server-modal/mcp-tool-selector'

describe('MCP selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.values = { serverSelector: 'server-1', toolSelector: 'read' }
    mocks.modes = { server: 'basic', tool: 'basic' }
    mocks.baselineModes = undefined
  })

  it('uses a searchable configured connection picker in Basic mode', () => {
    renderToStaticMarkup(
      <McpServerSelector
        blockId='block-1'
        subBlock={{ id: 'serverSelector', type: 'mcp-server-selector' }}
      />
    )
    const props = mocks.combobox.mock.calls[0][0]
    expect(props.value).toBe('Server one')
    expect(props.editable).toBe(false)
    expect(props.searchable).toBe(true)
    expect(props.filterOptions).toBe(false)
    props.onChange?.('server-1')
    expect(mocks.setValue).toHaveBeenCalledWith('serverSelector', 'server-1')
  })

  it('lists all authorized operations on the selected connection and caches the selected schema', () => {
    mocks.values.operationPolicy = { mode: 'allow', operations: [] }
    renderToStaticMarkup(
      <McpToolSelector
        blockId='block-1'
        subBlock={{ id: 'toolSelector', type: 'mcp-tool-selector' }}
      />
    )
    const props = mocks.combobox.mock.calls[0][0]
    expect(props.options.map((option) => option.value)).toEqual(['read', 'write'])
    expect(props.searchable).toBe(true)
    expect(props.filterOptions).toBe(false)
    props.onChange?.('read')
    expect(mocks.setValue).toHaveBeenCalledWith('toolSelector', 'read')
    expect(mocks.setValue).toHaveBeenCalledWith('_toolSchema', { type: 'object', properties: {} })
  })

  it('keeps missing selections visible without filtering out replacement operations', () => {
    mocks.values.toolSelector = 'disappeared'
    renderToStaticMarkup(
      <McpToolSelector
        blockId='block-1'
        subBlock={{ id: 'toolSelector', type: 'mcp-tool-selector' }}
      />
    )
    const props = mocks.combobox.mock.calls[0][0]
    expect(props.overlayLabel).toBe('disappeared')
    expect(props.filterOptions).toBe(false)
    expect(props.options).toHaveLength(2)
  })

  it.each(['server', 'tool'] as const)('uses JSON arguments for a dynamic %s', (field) => {
    mocks.values[field === 'server' ? 'serverReference' : 'toolReference'] = '<upstream.value>'
    mocks.modes[field] = 'advanced'
    renderToStaticMarkup(<McpDynamicArgs blockId='block-1' subBlockId='arguments' />)
    expect(mocks.longInput).toHaveBeenCalled()
    expect(mocks.shortInput).not.toHaveBeenCalled()
  })

  it('uses JSON arguments for an Advanced literal operation with a discovered schema', () => {
    mocks.values.toolReference = 'read'
    mocks.modes.tool = 'advanced'
    renderToStaticMarkup(<McpDynamicArgs blockId='block-1' subBlockId='arguments' />)
    expect(mocks.longInput).toHaveBeenCalled()
    expect(mocks.shortInput).not.toHaveBeenCalled()
  })

  it('keeps generated fields for Basic operations with a saved schema', () => {
    mocks.values.toolSelector = 'fixed_operation'
    mocks.values._toolSchema = { type: 'object', properties: { query: { type: 'string' } } }
    renderToStaticMarkup(<McpDynamicArgs blockId='block-1' subBlockId='arguments' />)
    expect(mocks.shortInput).toHaveBeenCalled()
    expect(mocks.longInput).not.toHaveBeenCalled()
  })

  it('uses snapshot modes for previews with populated dormant Basic fields', () => {
    const previewContextValues = {
      serverSelector: { value: 'wrong-server' },
      serverReference: { value: 'server-1' },
      toolSelector: { value: 'wrong-operation' },
      toolReference: { value: 'read' },
      __canonicalModes: { server: 'advanced', tool: 'advanced' },
    }
    renderToStaticMarkup(
      <McpToolSelector
        blockId='block-1'
        subBlock={{ id: 'toolSelector', type: 'mcp-tool-selector' }}
        isPreview
        previewContextValues={previewContextValues}
      />
    )
    expect(mocks.combobox.mock.calls[0][0].options).toHaveLength(2)
    renderToStaticMarkup(
      <McpDynamicArgs
        blockId='block-1'
        subBlockId='arguments'
        isPreview
        previewContextValues={previewContextValues}
      />
    )
    expect(mocks.longInput).toHaveBeenCalled()
    expect(mocks.shortInput).not.toHaveBeenCalled()
  })

  it('uses baseline modes with baseline diff values', () => {
    mocks.baselineModes = { server: 'advanced', tool: 'advanced' }
    mocks.values.serverReference = 'server-1'
    mocks.values.toolReference = 'read'
    renderToStaticMarkup(<McpDynamicArgs blockId='block-1' subBlockId='arguments' />)
    expect(mocks.longInput).toHaveBeenCalled()
    expect(mocks.shortInput).not.toHaveBeenCalled()
  })
})
