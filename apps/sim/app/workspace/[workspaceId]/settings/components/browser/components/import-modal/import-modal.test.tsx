/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import type { BrowserImportProfile } from '@sim/desktop-bridge'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** ChipSelect stands in as a native select so options are inspectable. */
vi.mock('@sim/emcn', () => ({
  ChipModal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role='dialog'>{children}</div> : null,
  ChipModalHeader: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  ChipModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalFooter: ({
    onCancel,
    primaryAction,
  }: {
    onCancel: () => void
    primaryAction: { label: ReactNode; onClick: () => void; disabled?: boolean }
  }) => (
    <footer>
      <button type='button' onClick={onCancel}>
        Cancel
      </button>
      <button type='button' disabled={primaryAction.disabled} onClick={primaryAction.onClick}>
        {primaryAction.label}
      </button>
    </footer>
  ),
  ChipModalField: ({
    title,
    options,
    value,
    onChange,
    disabled,
  }: {
    title: string
    options: Array<{ value: string; label: string }>
    value: string
    onChange: (value: string) => void
    disabled?: boolean
  }) => (
    <select
      aria-label={title}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}))

import { ImportModal } from '@/app/workspace/[workspaceId]/settings/components/browser/components/import-modal/import-modal'

function profile(
  id: string,
  browserId: string,
  browserLabel: string,
  profileLabel: string
): BrowserImportProfile {
  return { id, label: `${browserLabel} · ${profileLabel}`, browserId, browserLabel, profileLabel }
}

const PROFILES = [
  profile('chrome:Default', 'chrome', 'Chrome', 'Default'),
  profile('chrome:Profile 1', 'chrome', 'Chrome', 'sim.ai'),
  profile('arc:Default', 'arc', 'Arc', 'Default'),
  profile('arc:Profile 2', 'arc', 'Arc', 'Microtrades'),
  profile('dia:Default', 'dia', 'Dia', 'Default'),
]

let container: HTMLDivElement
let root: Root
let onImport: ReturnType<typeof vi.fn>
let onOpenChange: ReturnType<typeof vi.fn>

async function render(profiles = PROFILES, pending = false) {
  await act(async () => {
    root.render(
      <ImportModal
        open
        onOpenChange={onOpenChange}
        profiles={profiles}
        pending={pending}
        onImport={onImport}
      />
    )
  })
}

function select(label: 'Browser' | 'Profile'): HTMLSelectElement {
  const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
  if (!element) throw new Error(`No select labelled "${label}"`)
  return element
}

function optionsOf(label: 'Browser' | 'Profile'): string[] {
  return [...select(label).options].map((option) => option.textContent ?? '')
}

async function choose(label: 'Browser' | 'Profile', value: string) {
  const element = select(label)
  await act(async () => {
    element.value = value
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function buttonLabelled(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text
  )
  if (!button) throw new Error(`No button labelled "${text}"`)
  return button
}

describe('ImportModal', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onImport = vi.fn()
    onOpenChange = vi.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('lists each browser once, not once per profile', async () => {
    await render()

    expect(optionsOf('Browser')).toEqual(['Chrome', 'Arc', 'Dia'])
  })

  it('shows only the selected browser\u2019s profiles', async () => {
    await render()

    expect(optionsOf('Profile')).toEqual(['Default', 'sim.ai'])

    await choose('Browser', 'arc')

    expect(optionsOf('Profile')).toEqual(['Default', 'Microtrades'])
  })

  it('never leaves a profile selected that belongs to another browser', async () => {
    await render()
    await choose('Profile', 'chrome:Profile 1')

    await choose('Browser', 'dia')

    expect(select('Profile').value).toBe('dia:Default')
  })

  it('imports the browser and profile the user chose', async () => {
    await render()
    await choose('Browser', 'arc')
    await choose('Profile', 'arc:Profile 2')

    await act(async () => {
      buttonLabelled('Import').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'arc:Profile 2', label: 'Arc · Microtrades' })
    )
  })

  it('defaults to the first browser and its first profile', async () => {
    await render()

    expect(select('Browser').value).toBe('chrome')
    expect(select('Profile').value).toBe('chrome:Default')
  })

  it('locks the controls while an import is running', async () => {
    await render(PROFILES, true)

    expect(select('Browser').disabled).toBe(true)
    expect(select('Profile').disabled).toBe(true)
    expect(buttonLabelled('Importing...').disabled).toBe(true)
  })

  it('cannot import when nothing was discovered', async () => {
    await render([])

    expect(buttonLabelled('Import').disabled).toBe(true)
    expect(onImport).not.toHaveBeenCalled()
  })

  it('dismisses without importing', async () => {
    await render()

    await act(async () => {
      buttonLabelled('Cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onImport).not.toHaveBeenCalled()
  })
})
