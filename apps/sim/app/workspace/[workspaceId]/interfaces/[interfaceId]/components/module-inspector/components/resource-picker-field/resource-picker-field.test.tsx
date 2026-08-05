/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleResourceKind } from '@/components/resources/interface-view/module-resource-copy'
import { ResourcePickerField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/resource-picker-field/resource-picker-field'

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

function render(kind: ModuleResourceKind = 'workflow') {
  act(() => {
    root.render(
      <ResourcePickerField
        kind={kind}
        items={[{ id: 'wf-1', name: 'Onboarding' }]}
        isLoading={false}
        value='wf-1'
        onChange={vi.fn()}
      />
    )
  })
}

function combobox(): HTMLElement {
  const elements = container.querySelectorAll<HTMLElement>('[role="combobox"]')
  expect(elements).toHaveLength(1)
  return elements[0]
}

describe('ResourcePickerField accessible names', () => {
  it('names the combobox from the kind title', () => {
    render()
    expect(combobox()).toHaveAccessibleName('Workflow')
  })

  it('puts the name on the combobox itself, not the layout wrapper', () => {
    render('table')
    const named = Array.from(container.querySelectorAll<HTMLElement>('[aria-label]'))
    expect(named).toHaveLength(1)
    expect(named[0]).toBe(combobox())
  })

  it('keeps the combobox ARIA and focus contract intact', () => {
    render()
    const element = combobox()
    expect(element).toHaveAttribute('aria-expanded', 'false')
    expect(element).toHaveAttribute('aria-haspopup', 'listbox')
    expect(element).toHaveAttribute('aria-controls')
    expect(element).toHaveAttribute('tabindex', '0')
  })
})
