/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormField } from '@/lib/interfaces/types'
import { FormFieldRow } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/form-module-fields/components/form-field-row/form-field-row'

const FIELD: FormField = {
  id: 'field-1',
  name: 'email',
  label: 'Email',
  type: 'short-text',
  required: false,
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(field: FormField = FIELD) {
  act(() => {
    root.render(
      <FormFieldRow
        field={field}
        duplicateName={false}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
        canMoveUp={false}
        canMoveDown={false}
      />
    )
  })
}

/** The `ChipDropdown` trigger — the only button rendering the selected type label. */
function typeTrigger(): HTMLElement {
  const buttons = Array.from(container.querySelectorAll<HTMLElement>('button'))
  const match = buttons.filter((button) => button.textContent?.includes('Short text'))
  expect(match).toHaveLength(1)
  return match[0]
}

describe('FormFieldRow accessible names', () => {
  it('names the type ChipDropdown trigger from its aria-label', () => {
    render()
    expect(typeTrigger()).toHaveAccessibleName('Type for Email')
  })

  it('keeps the ChipDropdown trigger a menu button', () => {
    render()
    const trigger = typeTrigger()
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('type', 'button')
  })

  it('names the default-value ChipSelect trigger from its aria-label', () => {
    render({ ...FIELD, type: 'dropdown', options: ['Yes', 'No'] })
    const trigger = Array.from(container.querySelectorAll<HTMLElement>('button')).find((button) =>
      button.textContent?.includes('None')
    )
    expect(trigger).toHaveAccessibleName('Default value for Email')
  })
})
