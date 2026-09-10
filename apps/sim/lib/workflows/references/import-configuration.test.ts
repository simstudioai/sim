/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockConfig } from '@/blocks/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const { getOption } = vi.hoisted(() => ({ getOption: vi.fn() }))
vi.mock('@/lib/selectors/application/get-selector-option', () => ({
  getSelectorOption: { execute: getOption },
}))
vi.mock('@/lib/workflows/search-replace/indexer', () => ({
  getToolInputParamConfigs: vi.fn(() => []),
}))

import {
  inspectImportConfiguration,
  validateImportSelectorValues,
} from '@/lib/workflows/references/import-configuration'
import { buildWorkflowImportPlan } from '@/lib/workflows/references/import-plan'
import { getBlock } from '@/blocks/registry'

const principal = { kind: 'personal_api_key', userId: 'user', keyId: 'key' } as const
const agent = { type: 'agent', subBlocks: [{ id: 'tools', type: 'tool-input' }] } as BlockConfig
const mcp = {
  type: 'mcp',
  subBlocks: [
    { id: 'server', type: 'mcp-server-selector', required: true },
    {
      id: 'tool',
      type: 'mcp-tool-selector',
      selectorKey: 'mcp.tools',
      dependsOn: ['server'],
      required: true,
    },
  ],
} as BlockConfig
function source(toolName: string | null): WorkflowState {
  return {
    blocks: {
      agent: {
        id: 'agent',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        enabled: true,
        outputs: {},
        subBlocks: {
          tools: {
            id: 'tools',
            type: 'tool-input',
            value: [{ type: 'mcp', params: { serverId: 'source-server', toolName } }],
          },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}
const mappings = [
  { kind: 'mcp-server' as const, sourceId: 'source-server', targetId: 'destination-server' },
]
describe('mapped import configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBlock).mockImplementation((type) =>
      type === 'agent' ? agent : type === 'mcp' ? mcp : undefined
    )
    getOption.mockImplementation(async ({ input }) => ({ id: input.id, label: input.id }))
  })
  it('requires the lost MCP tool name in a legacy export and accepts a source-indexed repair', async () => {
    const plan = buildWorkflowImportPlan(source(null), { mappings })
    expect(await inspectImportConfiguration(plan, { mappings }, 'destination')).toEqual([
      expect.objectContaining({
        blockId: 'agent',
        subBlockKey: 'tools[0].toolName',
        required: true,
        configured: false,
        selectorKey: 'mcp.tools',
        context: { mcpServerId: 'destination-server' },
      }),
    ])
    const options = {
      mappings,
      dependentValues: [{ blockId: 'agent', subBlockKey: 'tools[0].toolName', value: 'search' }],
    }
    const repaired = buildWorkflowImportPlan(source(null), options)
    const fields = await inspectImportConfiguration(repaired, options, 'destination')
    await validateImportSelectorValues(principal, 'destination', fields, options)
    expect(fields[0].configured).toBe(true)
    expect(repaired.state.blocks.agent.subBlocks.tools.value).toEqual([
      expect.objectContaining({
        toolId: 'mcp-destination-server-search',
        params: { serverId: 'destination-server', toolName: 'search' },
      }),
    ])
  })
  it('marks a preserved MCP name unavailable when the destination does not offer it', async () => {
    getOption.mockResolvedValue(null)
    const plan = buildWorkflowImportPlan(source('old-tool'), { mappings })
    const fields = await inspectImportConfiguration(plan, { mappings }, 'destination')
    await validateImportSelectorValues(principal, 'destination', fields, { mappings })
    expect(fields[0]).toMatchObject({ required: true, configured: false })
  })
  it('does not require a tool name for an advanced server-wide binding', async () => {
    const state = source(null)
    state.blocks.agent.subBlocks.tools.value = [
      { type: 'mcp-server-advanced', params: { serverId: 'source-server' } },
    ]
    const plan = buildWorkflowImportPlan(state, { mappings })
    expect(await inspectImportConfiguration(plan, { mappings }, 'destination')).toEqual([])
  })
})
