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
    mocks.values = { server: 'server-1', operationPolicy: { mode: 'all' } }
  })

  it('persists a runtime server reference instead of only changing display text', () => {
    renderToStaticMarkup(
      <McpServerSelector
        blockId='block-1'
        subBlock={{ id: 'server', type: 'mcp-server-selector' }}
      />
    )
    expect(mocks.combobox.mock.calls[0][0].value).toBe('Server one')
    mocks.combobox.mock.calls[0][0].onChange?.('<upstream.server>')
    expect(mocks.setValue).toHaveBeenCalledWith('server', '<upstream.server>')
  })

  it('persists a runtime operation reference and clears the fixed schema cache', () => {
    mocks.values.tool = '<saved.operation>'
    renderToStaticMarkup(
      <McpToolSelector blockId='block-1' subBlock={{ id: 'tool', type: 'mcp-tool-selector' }} />
    )
    expect(mocks.combobox.mock.calls[0][0].value).toBe('<saved.operation>')
    mocks.combobox.mock.calls[0][0].onChange?.('<upstream.operation>')
    expect(mocks.setValue).toHaveBeenCalledWith('tool', '<upstream.operation>')
    expect(mocks.setValue).toHaveBeenCalledWith('_toolSchema', null)
  })

  it('lists only operations allowed by the block on the canonical server', () => {
    mocks.values.operationPolicy = {
      mode: 'allow',
      operations: [{ serverId: 'canonical-1', name: 'read' }],
    }
    renderToStaticMarkup(
      <McpToolSelector blockId='block-1' subBlock={{ id: 'tool', type: 'mcp-tool-selector' }} />
    )
    expect(mocks.combobox.mock.calls[0][0].options.map((option) => option.value)).toEqual(['read'])
    mocks.combobox.mock.calls[0][0].onChange?.('read')
    expect(mocks.setValue).toHaveBeenCalledWith('tool', 'read')
    expect(mocks.setValue).toHaveBeenCalledWith('_toolSchema', { type: 'object', properties: {} })
  })

  it.each(['server', 'connection', 'tool'])('uses JSON arguments for a dynamic %s', (field) => {
    mocks.values.tool = 'read'
    mocks.values[field] = '<upstream.value>'
    renderToStaticMarkup(<McpDynamicArgs blockId='block-1' subBlockId='arguments' />)
    expect(mocks.longInput).toHaveBeenCalled()
    expect(mocks.shortInput).not.toHaveBeenCalled()
  })

  it('keeps generated fields for fixed operations with a saved schema', () => {
    mocks.values.tool = 'fixed_operation'
    mocks.values._toolSchema = { type: 'object', properties: { query: { type: 'string' } } }
    renderToStaticMarkup(<McpDynamicArgs blockId='block-1' subBlockId='arguments' />)
    expect(mocks.shortInput).toHaveBeenCalled()
  })
})
