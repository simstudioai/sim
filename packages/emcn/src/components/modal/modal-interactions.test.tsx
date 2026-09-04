/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, useState } from 'react'
import {
  ChipCombobox,
  ChipDropdown,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalHeader,
  Popover,
  PopoverContent,
  PopoverFolder,
  PopoverTrigger,
} from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/workspace/test/home' }))

const OPTIONS = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Beta', value: 'beta' },
]

let root: Root
let container: HTMLDivElement

interface ModalFieldsProps {
  onChange?: (value: string) => void
  dismissDisabled?: boolean
}

function ModalFields({ onChange, dismissDisabled }: ModalFieldsProps) {
  const [open, setOpen] = useState(true)
  return (
    <ChipModal
      open={open}
      onOpenChange={setOpen}
      srTitle='Connector settings'
      dismissDisabled={dismissDisabled}
    >
      <ChipModalHeader onClose={() => setOpen(false)}>Connector settings</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title='Account'>
          <ChipCombobox options={OPTIONS} onChange={onChange} data-testid='account' searchable />
        </ChipModalField>
        <ChipModalField type='custom' title='Folder'>
          <ChipCombobox options={OPTIONS} data-testid='folder' />
        </ChipModalField>
        <ChipModalField type='custom' title='Access'>
          <ChipDropdown options={OPTIONS} placeholder='Access' />
        </ChipModalField>
        <p data-testid='description'>Choose the source to synchronize.</p>
      </ChipModalBody>
    </ChipModal>
  )
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}

async function mount(node: ReactNode) {
  act(() => root.render(node))
  await settle()
}

function element(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector)
  if (!node) throw new Error(`Missing ${selector}`)
  return node
}

function combobox(name: string) {
  return element(`[data-testid="${name}"] [role="combobox"]`)
}

/** Includes native pointer bubbling; click-only tests miss Radix outside dismissal. */
async function click(node: HTMLElement) {
  act(() => {
    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    const allowFocus = node.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    )
    if (allowFocus) node.focus()
    node.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }))
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  act(() => root.unmount())
  await act(async () => {
    await vi.runOnlyPendingTimersAsync()
  })
  container.remove()
  document.body.removeAttribute('style')
  vi.useRealTimers()
})

describe('modal floating controls', () => {
  it('closes the previous combobox when a sibling opens without dismissing the modal', async () => {
    await mount(<ModalFields />)
    await click(combobox('account'))
    expect(combobox('account').getAttribute('aria-expanded')).toBe('true')

    await click(combobox('folder'))

    expect(combobox('account').getAttribute('aria-expanded')).toBe('false')
    expect(combobox('folder').getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('dismisses a dropdown when clicking non-focusable content inside the modal', async () => {
    await mount(<ModalFields />)
    await click(combobox('account'))

    await click(element('[data-testid="description"]'))

    expect(combobox('account').getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('still toggles the same trigger closed without reopening it', async () => {
    await mount(<ModalFields />)
    await click(combobox('account'))
    await click(combobox('account'))

    expect(combobox('account').getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('keeps portaled options interactive and closes only the picker on selection', async () => {
    const onChange = vi.fn()
    await mount(<ModalFields onChange={onChange} />)
    await click(combobox('account'))
    const option = element('[role="option"]')
    expect(getComputedStyle(option).pointerEvents).toBe('auto')

    await click(option)

    expect(onChange).toHaveBeenCalledExactlyOnceWith('alpha')
    expect(combobox('account').getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('dismisses the picker before the modal on successive outside clicks', async () => {
    await mount(<ModalFields />)
    await click(combobox('account'))
    await click(document.body)
    expect(combobox('account').getAttribute('aria-expanded')).toBe('false')

    await click(document.body)

    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('closes only the top layer with Escape', async () => {
    await mount(<ModalFields />)
    await click(combobox('account'))
    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    )
    await settle()
    expect(combobox('account').getAttribute('aria-expanded')).toBe('false')

    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    )
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('closes a combobox when a sibling menu opens', async () => {
    await mount(<ModalFields />)
    await click(combobox('account'))

    await click(element('button[aria-haspopup="menu"]'))

    expect(combobox('account').getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('does not lose the next outside click after interacting inside the search field', async () => {
    await mount(<ModalFields />)
    await click(combobox('account'))
    await click(element('input'))

    await click(document.body)

    expect(combobox('account').getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('closes a sibling menu when a combobox opens', async () => {
    await mount(<ModalFields />)
    await click(element('button[aria-haspopup="menu"]'))
    expect(document.querySelector('[role="menu"]')).not.toBeNull()

    await click(combobox('folder'))

    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(combobox('folder').getAttribute('aria-expanded')).toBe('true')
  })

  it('preserves disabled modal dismissal while still dismissing its dropdown', async () => {
    await mount(<ModalFields dismissDisabled />)
    await click(combobox('account'))
    await click(document.body)
    expect(combobox('account').getAttribute('aria-expanded')).toBe('false')
    await click(document.body)

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('keeps a popover open when interacting with its portaled hover submenu', async () => {
    await mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Nested controls'>
        <Popover>
          <PopoverTrigger asChild>
            <button type='button' data-testid='parent'>
              Parent
            </button>
          </PopoverTrigger>
          <PopoverContent>
            <PopoverFolder id='folder' title='Folder' expandOnHover data-testid='hover-folder'>
              <button type='button' data-testid='branch-action'>
                Action
              </button>
            </PopoverFolder>
          </PopoverContent>
        </Popover>
      </ChipModal>
    )
    await click(element('[data-testid="parent"]'))
    act(() =>
      element('[data-testid="hover-folder"]').dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true })
      )
    )
    await settle()
    await click(element('[data-testid="branch-action"]'))

    expect(element('[data-testid="parent"]').getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-testid="branch-action"]')).not.toBeNull()
  })

  it('keeps a parent popover open while interacting with its nested popover', async () => {
    await mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Nested controls'>
        <Popover>
          <PopoverTrigger asChild>
            <button type='button' data-testid='parent'>
              Parent
            </button>
          </PopoverTrigger>
          <PopoverContent>
            <Popover>
              <PopoverTrigger asChild>
                <button type='button' data-testid='child'>
                  Child
                </button>
              </PopoverTrigger>
              <PopoverContent>
                <button type='button' data-testid='nested-action'>
                  Action
                </button>
              </PopoverContent>
            </Popover>
          </PopoverContent>
        </Popover>
      </ChipModal>
    )
    await click(element('[data-testid="parent"]'))
    await click(element('[data-testid="child"]'))
    await click(element('[data-testid="nested-action"]'))

    expect(element('[data-testid="parent"]').getAttribute('aria-expanded')).toBe('true')
    expect(element('[data-testid="child"]').getAttribute('aria-expanded')).toBe('true')
  })
})
