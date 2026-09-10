/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationSearchStatsPeriod } from '@/app/o/[organizationId]/settings/components/integrations/organization-search-stats-period'

let root: Root
let container: HTMLDivElement
let originalScroll: typeof HTMLElement.prototype.scrollIntoView
const onChange = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  originalScroll = HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  HTMLElement.prototype.scrollIntoView = originalScroll
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () =>
    root.render(
      <OrganizationSearchStatsPeriod
        period='custom'
        startDate='2024-09-01'
        endDate='2024-09-03'
        onChange={onChange}
      />
    )
  )
}
async function selectPeriod(label: string) {
  const trigger = container.querySelector('[role="combobox"]')
  expect(trigger).not.toBeNull()
  await act(async () =>
    trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  )
  const option = Array.from(document.querySelectorAll('[role="option"]')).find(
    (item) => item.textContent === label
  )
  expect(option).toBeDefined()
  await act(async () => option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent === label
  )
  expect(button).toBeDefined()
  await act(async () => button?.click())
}

describe('Stats date selection', () => {
  it('keeps the existing range when calendar edits are cancelled', async () => {
    await render()
    await selectPeriod('Custom range')
    expect(
      document
        .querySelector('[data-radix-popper-content-wrapper]')
        ?.contains(document.activeElement)
    ).toBe(true)
    await click('5')
    await click('8')
    expect(onChange).not.toHaveBeenCalled()
    await click('Cancel')
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(container.querySelector('[role="combobox"]'))
    )
    expect(onChange).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('Apply')
    expect(container.textContent).toContain('Sep 1 – Sep 3')
  })
  it('applies both date-only boundaries in one update and closes the calendar', async () => {
    await render()
    await selectPeriod('Custom range')
    await click('5')
    await click('8')
    await click('Apply')
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      period: 'custom',
      startDate: '2024-09-05',
      endDate: '2024-09-08',
    })
    expect(document.body.textContent).not.toContain('Apply')
  })
  it('clears custom boundaries when choosing a preset', async () => {
    await render()
    await selectPeriod('Past 3 days')
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      period: '3d',
      startDate: null,
      endDate: null,
    })
  })
  it('opens the calendar from the keyboard and restores focus on Escape', async () => {
    await render()
    const trigger = container.querySelector<HTMLElement>('[role="combobox"]')
    await act(async () => {
      trigger?.focus()
      trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    for (let index = 0; index < 6; index++) {
      await act(async () =>
        trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      )
    }
    await act(async () =>
      trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(document.body.textContent).toContain('Apply')
    expect(document.activeElement).not.toBe(trigger)
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    )
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(onChange).not.toHaveBeenCalled()
  })
})
