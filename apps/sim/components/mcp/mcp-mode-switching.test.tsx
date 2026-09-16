/** @vitest-environment node */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const values: Record<string, unknown> = {}
  const modes: Record<string, 'basic' | 'advanced'> = {}
  const workflowState = { blocks: { mcp: { type: 'mcp', data: { canonicalModes: modes } } } }
  const registryState = { activeWorkflowId: 'workflow' }
  const subBlockState = {
    workflowValues: { workflow: { mcp: values } },
    getValue: (_blockId: string, field: string) => values[field],
  }
  return {
    values,
    modes,
    workflowState,
    registryState,
    subBlockState,
    setValue: vi.fn(),
    setMode: vi.fn(),
  }
})

vi.mock('@/hooks/use-collaborative-workflow', () => ({
  useCollaborativeWorkflow: () => ({
    collaborativeSetSubblockValue: mocks.setValue,
    collaborativeSetBlockCanonicalMode: mocks.setMode,
  }),
}))
vi.mock('@/providers/utils', () => ({ getProviderFromModel: vi.fn() }))
vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: Object.assign(
    (selector: (state: typeof mocks.workflowState) => unknown) => selector(mocks.workflowState),
    { getState: () => mocks.workflowState }
  ),
}))
vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: Object.assign(
    (selector: (state: typeof mocks.registryState) => unknown) => selector(mocks.registryState),
    { getState: () => mocks.registryState }
  ),
}))
vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: { getState: () => mocks.subBlockState },
}))
vi.mock('zustand/traditional', () => ({
  useStoreWithEqualityFn: (
    store: { getState: () => typeof mocks.subBlockState },
    selector: (state: typeof mocks.subBlockState) => unknown
  ) => selector(store.getState()),
}))
vi.mock('@/stores/workflow-diff/store', () => ({
  useWorkflowDiffStore: () => ({ hasActiveDiff: false, isShowingDiff: false }),
}))

import { buildSelectorRawContext } from '@/lib/selectors/context'
import { getSubBlocksDependingOnChange } from '@/lib/workflows/subblocks/dependencies'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { McpBlock } from '@/blocks/blocks/mcp'
import { getBlock } from '@/blocks/registry'

describe('MCP server mode switching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const field of Object.keys(mocks.values)) delete mocks.values[field]
    mocks.values.toolSelector = 'read'
    mocks.modes.server = 'advanced'
    mocks.modes.tool = 'basic'
    mocks.setMode.mockImplementation((_blockId, field, value) => {
      mocks.modes[field] = value
    })
    mocks.setValue.mockImplementation((blockId: string, field: string, value: unknown) => {
      mocks.values[field] = value
      for (const dependent of getSubBlocksDependingOnChange(McpBlock.subBlocks, field)) {
        if (mocks.values[dependent.id]) mocks.setValue(blockId, dependent.id, '')
      }
    })
    vi.mocked(getBlock).mockReturnValue(McpBlock)
  })

  it('preserves the exact selected operation before server dependency clearing', () => {
    let changeServer: ((value: string) => void) | undefined
    function Harness() {
      const [, setValue] = useSubBlockValue<string>('mcp', 'serverReference')
      changeServer = setValue
      return null
    }
    renderToStaticMarkup(<Harness />)
    changeServer?.('<connection.id>')
    expect(mocks.values.serverReference).toBe('<connection.id>')
    expect(mocks.values.toolSelector).toBe('')
    expect(mocks.values.toolReference).toBe('read')
    expect(mocks.modes.tool).toBe('advanced')
  })

  it('projects only the active canonical server into operation discovery', () => {
    const subBlocks = {
      serverSelector: { value: 'inactive' },
      serverReference: { value: 'mcp-cg-abcdefghijklmnopqrstu' },
    }
    const input = {
      selectorKey: 'mcp.tools' as const,
      blockType: 'mcp',
      subBlocks,
      canonicalModes: mocks.modes,
      dependsOn: ['server'],
    }
    expect(buildSelectorRawContext(input)).toEqual({ mcpServerId: 'mcp-cg-abcdefghijklmnopqrstu' })
    subBlocks.serverReference.value = '<connection.id>'
    expect(buildSelectorRawContext(input)).toEqual({})
  })
})
