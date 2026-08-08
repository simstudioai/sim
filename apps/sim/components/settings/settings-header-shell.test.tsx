/**
 * @vitest-environment jsdom
 *
 * The shell renders header actions in ranked order but routes every handler
 * through `configRef.current.actions[index]` to dodge stale closures. Those two
 * facts fight each other: if the reordered render ever renumbered the indices,
 * clicking Delete would invoke Save. These tests pin the pairing at the render
 * level, which the pure-function tests cannot reach.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { SettingsAction } from '@/components/settings/settings-header'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { SettingsPanel } from '@/components/settings/settings-panel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  vi.clearAllMocks()
})

function renderHeader(actions: SettingsAction[]) {
  act(() => {
    root.render(
      <SettingsHeaderProvider>
        <SettingsHeaderShell>
          <SettingsPanel title='Thing' actions={actions}>
            <div />
          </SettingsPanel>
        </SettingsHeaderShell>
      </SettingsHeaderProvider>
    )
  })
}

/** Header chips in rendered (left→right) order. */
function chipLabels(): string[] {
  return [...container.querySelectorAll('header button, div button')]
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean)
}

function clickChip(label: string) {
  const chip = [...container.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label
  )
  if (!chip) throw new Error(`no chip labelled "${label}" (have: ${chipLabels().join(', ')})`)
  act(() => {
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('SettingsHeaderShell action routing', () => {
  it('renders Delete before Discard and Save even though the array lists it last', () => {
    const actions: SettingsAction[] = [
      ...saveDiscardActions({ dirty: true, saving: false, onSave: vi.fn(), onDiscard: vi.fn() }),
      { id: 'delete', text: 'Delete', onSelect: vi.fn() },
    ]

    renderHeader(actions)

    const labels = chipLabels()
    expect(labels.indexOf('Delete')).toBeLessThan(labels.indexOf('Discard'))
    expect(labels.indexOf('Discard')).toBeLessThan(labels.indexOf('Save'))
  })

  it('invokes the action that was clicked, not the one at that render position', () => {
    const onSave = vi.fn()
    const onDiscard = vi.fn()
    const onDelete = vi.fn()

    renderHeader([
      ...saveDiscardActions({ dirty: true, saving: false, onSave, onDiscard }),
      { id: 'delete', text: 'Delete', onSelect: onDelete },
    ])

    // Delete renders first but lives at source index 2.
    clickChip('Delete')
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()

    clickChip('Save')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('stays correctly bound when a conditional action shifts every index', () => {
    // Sandboxes: Discard only exists while dirty, so Delete moves 2 -> 1.
    const onSave = vi.fn()
    const onDelete = vi.fn()

    renderHeader([
      ...saveDiscardActions({ dirty: false, saving: false, onSave, onDiscard: vi.fn() }),
      { id: 'delete', text: 'Delete', onSelect: onDelete },
    ])

    clickChip('Delete')

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
