/** @vitest-environment node */
import type { ComponentProps } from 'react'
import type { ChipDropdown, TagInput } from '@sim/emcn'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tagInput, dropdown } = vi.hoisted(() => ({
  tagInput: vi.fn<(props: ComponentProps<typeof TagInput>) => null>(() => null),
  dropdown: vi.fn<(props: ComponentProps<typeof ChipDropdown>) => null>(() => null),
}))
vi.mock('@sim/emcn', () => ({ TagInput: tagInput, ChipDropdown: dropdown }))

import { McpOperationPolicyEditor } from '@/components/mcp/operation-policy-editor'

describe('MCP operations access editor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts exact names without a catalog and preserves absent deny entries', () => {
    const onChange = vi.fn()
    renderToStaticMarkup(
      <McpOperationPolicyEditor
        value={{ mode: 'deny', operations: ['temporarily_missing'] }}
        onChange={onChange}
      />
    )
    const props = tagInput.mock.calls[0][0]
    expect(props.items).toEqual([{ value: 'temporarily_missing', isValid: true }])
    expect(props.onAdd('read')).toBe(true)
    expect(onChange).toHaveBeenCalledWith({
      mode: 'deny',
      operations: ['temporarily_missing', 'read'],
    })
  })

  it('adds multiple literal names in one update and deduplicates them', () => {
    const onChange = vi.fn()
    renderToStaticMarkup(
      <McpOperationPolicyEditor
        value={{ mode: 'allow', operations: ['read'] }}
        onChange={onChange}
      />
    )
    tagInput.mock.calls[0][0].onAddMany?.(['read', ' write ', 'write'])
    expect(onChange).toHaveBeenCalledWith({ mode: 'allow', operations: ['read', 'write'] })
  })

  it('allows removing the last entry without switching to unrestricted access', () => {
    const onChange = vi.fn()
    renderToStaticMarkup(
      <McpOperationPolicyEditor
        value={{ mode: 'allow', operations: ['read'] }}
        onChange={onChange}
      />
    )
    tagInput.mock.calls[0][0].onRemove('read', 0, true)
    expect(onChange).toHaveBeenCalledWith({ mode: 'allow', operations: [] })
  })

  it.each(['<upstream.tool>', '{{tool}}', '', 'x'.repeat(257)])(
    'refuses invalid tool ID %s',
    (name) => {
      const onChange = vi.fn()
      renderToStaticMarkup(
        <McpOperationPolicyEditor value={{ mode: 'allow', operations: [] }} onChange={onChange} />
      )
      expect(tagInput.mock.calls[0][0].onAdd(name)).toBe(false)
      expect(onChange).not.toHaveBeenCalled()
    }
  )

  it('shows all three modes and hides tool IDs for all permitted', () => {
    renderToStaticMarkup(
      <McpOperationPolicyEditor value={{ mode: 'all' }} onChange={vi.fn()} disabled />
    )
    expect(dropdown.mock.calls[0][0].options.map((option) => option.label)).toEqual([
      'Only selected',
      'All except selected',
      'All permitted',
    ])
    expect(dropdown.mock.calls[0][0].disabled).toBe(true)
    expect(tagInput).not.toHaveBeenCalled()
  })
})
