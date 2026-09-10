/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getOption } = vi.hoisted(() => ({ getOption: vi.fn() }))
vi.mock('@/lib/selectors/application/get-selector-option', () => ({
  getSelectorOption: { execute: getOption },
}))

import {
  selectedReferenceValues,
  workflowSelectorValidator,
} from '@/lib/workflows/references/selector-values'

const principal = { kind: 'personal_api_key', userId: 'user', keyId: 'key' } as const

describe('workflow selector validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOption.mockImplementation(async ({ input }) => ({ id: input.id, label: input.id }))
  })
  it('validates each selected ID and deduplicates shared requests', async () => {
    const validate = workflowSelectorValidator(principal, 'destination')
    const field = {
      selectorKey: 'table.outputColumns',
      context: { tableId: 'table' },
      title: 'Columns',
      value: 'first, second,first',
      multiSelect: true,
    }
    expect(await validate(field)).toBe(true)
    expect(await validate(field)).toBe(true)
    expect(getOption.mock.calls.map(([args]) => args.input.id)).toEqual(['first', 'second'])
    expect(getOption.mock.calls[0][0]).toMatchObject({
      principal,
      input: { scope: { kind: 'workspace', workspaceId: 'destination' } },
    })
  })
  it('rejects a multi-selection with an unavailable member', async () => {
    getOption.mockResolvedValueOnce({ id: 'first', label: 'First' }).mockResolvedValueOnce(null)
    expect(
      await workflowSelectorValidator(
        principal,
        'destination'
      )({
        selectorKey: 'table.outputColumns',
        context: { tableId: 'table' },
        title: 'Columns',
        value: 'first, missing',
        multiSelect: true,
      })
    ).toBe(false)
  })
  it('keeps a comma inside a single selector ID', () => {
    expect(selectedReferenceValues('last, first')).toEqual(['last, first'])
  })
  it.each(['tool', 'server-tool', 'mcp-server-tool'])(
    'normalizes MCP selection %s to the destination tool name',
    async (value) => {
      expect(
        await workflowSelectorValidator(
          principal,
          'destination'
        )({ selectorKey: 'mcp.tools', context: { mcpServerId: 'server' }, title: 'Tool', value })
      ).toBe(true)
      expect(getOption).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ id: 'tool' }) })
      )
    }
  )
  it('refuses unavailable dependencies before provider discovery', async () => {
    await expect(
      workflowSelectorValidator(
        principal,
        'destination'
      )({ selectorKey: 'mcp.tools', context: {}, title: 'Tool', value: 'name' })
    ).rejects.toThrow('dependencies')
    expect(getOption).not.toHaveBeenCalled()
  })
})
