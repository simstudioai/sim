/** @vitest-environment node */
import type { ComponentProps } from 'react'
import type { ChipCombobox, ChipDropdown } from '@sim/emcn'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { combobox, dropdown } = vi.hoisted(() => ({
  combobox: vi.fn<(props: ComponentProps<typeof ChipCombobox>) => null>(() => null),
  dropdown: vi.fn<(props: ComponentProps<typeof ChipDropdown>) => null>(() => null),
}))
vi.mock('@sim/emcn', () => ({
  ChipCombobox: combobox,
  ChipDropdown: dropdown,
  OverflowText: () => null,
}))

import { McpOperationPolicyEditor } from '@/components/mcp/operation-policy-editor'

describe('MCP operations access editor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps absent deny entries while browsing the authorized catalog', () => {
    const onChange = vi.fn()
    renderToStaticMarkup(
      <McpOperationPolicyEditor
        value={{
          mode: 'deny',
          operations: [{ serverId: 'server-1', name: 'temporarily_missing' }],
        }}
        operations={[{ serverId: 'server-1', name: 'read', description: 'Read documents' }]}
        onChange={onChange}
      />
    )
    const props = combobox.mock.calls[0][0]
    expect(props.multiSelectValues).toEqual(['["server-1","temporarily_missing"]'])
    expect(props.options.map((option) => option.label)).toEqual(['read', 'temporarily_missing'])
    props.onMultiSelectChange?.(['["server-1","temporarily_missing"]', '["server-1","read"]'])
    expect(onChange).toHaveBeenCalledWith({
      mode: 'deny',
      operations: [
        { serverId: 'server-1', name: 'temporarily_missing' },
        { serverId: 'server-1', name: 'read' },
      ],
    })
  })

  it('starts explicit selection with no operations and allows clearing the selection', () => {
    const onChange = vi.fn()
    renderToStaticMarkup(
      <McpOperationPolicyEditor
        value={{ mode: 'allow', operations: [] }}
        operations={[{ serverId: 'server-1', name: 'read' }]}
        onChange={onChange}
      />
    )
    expect(combobox.mock.calls[0][0].multiSelectValues).toEqual([])
    combobox.mock.calls[0][0].onMultiSelectChange?.([])
    expect(onChange).toHaveBeenCalledWith({ mode: 'allow', operations: [] })
  })

  it('shows all three modes and honors readonly chrome', () => {
    renderToStaticMarkup(
      <McpOperationPolicyEditor
        value={{ mode: 'all' }}
        operations={[]}
        onChange={vi.fn()}
        disabled
      />
    )
    expect(dropdown.mock.calls[0][0].options.map((option) => option.label)).toEqual([
      'Only selected',
      'All except selected',
      'All permitted',
    ])
    expect(dropdown.mock.calls[0][0].disabled).toBe(true)
    expect(combobox).not.toHaveBeenCalled()
  })
})
