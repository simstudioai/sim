/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { transformBlockTool } from '@/providers/utils'
import { normalizeToolId } from '@/tools/normalize'

const mockResolve = vi.fn()

const options = {
  getAllBlocks: () => [
    {
      type: 'custom_block_test',
      name: 'The Elder',
      description: 'Ask the elder',
      tools: { access: ['workflow_executor'] },
      subBlocks: [],
    },
  ],
  getTool: (id: string) =>
    id === 'deployed_block_executor'
      ? { id: 'deployed_block_executor', description: 'exec' }
      : undefined,
  resolveCustomBlockBinding: mockResolve,
}

describe('transformBlockTool — custom blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds an id-keyed deployed_block_executor tool and omits file[] fields', async () => {
    mockResolve.mockResolvedValue({
      workflowId: 'wf-src',
      inputFields: [
        { id: 'q', name: 'Question', type: 'string', required: true },
        { id: 'f', name: 'Files', type: 'file[]' },
      ],
      requiredInputIds: ['q'],
    })

    const tool = await transformBlockTool(
      { type: 'custom_block_test', params: { q: 'hi' } },
      options
    )

    expect(tool).not.toBeNull()
    // Unique per block, name/description from the block (never the source workflow).
    expect(tool!.id).toBe('deployed_block_executor_custom_block_test')
    expect(tool!.name).toBe('The Elder')
    // Baked params: block type + assembled (id-keyed) input mapping.
    expect(tool!.params.blockType).toBe('custom_block_test')
    expect(tool!.params.inputMapping).toBe('{"q":"hi"}')
    // LLM schema: inputMapping object keyed by field id, file[] omitted, required honored.
    const inputMapping = tool!.parameters.properties.inputMapping
    expect(Object.keys(inputMapping.properties)).toEqual(['q'])
    expect(inputMapping.required).toEqual(['q'])
    expect(tool!.parameters.required).toEqual(['inputMapping'])

    expect(mockResolve).toHaveBeenCalledWith('custom_block_test')
  })

  it('keeps the tool id out of the user-defined custom-tool namespace', async () => {
    mockResolve.mockResolvedValue({
      workflowId: 'wf-src',
      inputFields: [{ id: 'q', name: 'Question', type: 'string' }],
      requiredInputIds: [],
    })

    const tool = await transformBlockTool({ type: 'custom_block_test', params: {} }, options)

    // `custom_` is the custom-tool prefix (`isCustomTool`). Colliding with it makes
    // executeTool resolve via the DB custom-tool lookup, skip internal-field
    // stripping, and let `disableCustomTools` block deploy-as-block tools.
    expect(tool!.id.startsWith('custom_')).toBe(false)
    expect(normalizeToolId(tool!.id)).toBe('deployed_block_executor')
  })

  it('does not offer the tool when a required file input has no preset value', async () => {
    mockResolve.mockResolvedValue({
      workflowId: 'wf-src',
      inputFields: [{ id: 'f', name: 'Files', type: 'file[]' }],
      requiredInputIds: ['f'],
    })

    const tool = await transformBlockTool({ type: 'custom_block_test', params: {} }, options)
    expect(tool).toBeNull()
  })

  it('still offers the tool when a required file input is pre-filled on the block', async () => {
    mockResolve.mockResolvedValue({
      workflowId: 'wf-src',
      inputFields: [{ id: 'f', name: 'Files', type: 'file[]' }],
      requiredInputIds: ['f'],
    })

    const tool = await transformBlockTool(
      { type: 'custom_block_test', params: { f: [{ id: 'file-1' }] } },
      options
    )
    expect(tool).not.toBeNull()
    // The preset value rides the baked mapping; the schema still omits the file field.
    expect(tool!.params.inputMapping).toContain('file-1')
    expect(Object.keys(tool!.parameters.properties.inputMapping.properties)).toEqual([])
  })

  it('returns null (tool not offered) when the binding cannot be resolved', async () => {
    mockResolve.mockResolvedValue(null)
    const tool = await transformBlockTool({ type: 'custom_block_test', params: {} }, options)
    expect(tool).toBeNull()
  })

  it('returns null when no resolver is injected (non-server callers)', async () => {
    const tool = await transformBlockTool(
      { type: 'custom_block_test', params: {} },
      { ...options, resolveCustomBlockBinding: undefined }
    )
    expect(tool).toBeNull()
  })
})
