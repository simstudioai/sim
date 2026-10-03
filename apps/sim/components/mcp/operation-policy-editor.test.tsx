import type { ComponentProps } from 'react'
import type { Combobox, TagInput } from '@sim/emcn'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const { tagInput, dropdown } = vi.hoisted(() => ({
  tagInput: vi.fn<(props: ComponentProps<typeof TagInput>) => null>(() => null),
  dropdown: vi.fn<(props: ComponentProps<typeof Combobox>) => null>(() => null),
}))
vi.mock('@sim/emcn', () => ({ TagInput: tagInput, Combobox: dropdown }))

import { McpOperationPolicyEditor } from '@/components/mcp/operation-policy-editor'

describe('MCP operations access editor', () => {
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
})
