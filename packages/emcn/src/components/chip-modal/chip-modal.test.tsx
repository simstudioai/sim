/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal, ModalContent, ModalHeader } from '../modal/modal'
import {
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from './chip-modal'

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/home',
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

/** The dialog panel Radix renders, which owns the Escape/outside-click handlers. */
function dialog(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!node) throw new Error('Dialog did not render')
  return node
}

function buttonByText(text: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text)
  )
  if (!match) throw new Error(`No button containing "${text}"`)
  return match as HTMLButtonElement
}

function closeButton(): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll('button')).find((button) =>
    button.querySelector('.sr-only')?.textContent?.includes('Close')
  )
  if (!match) throw new Error('Close button did not render')
  return match as HTMLButtonElement
}

function pressEscape() {
  act(() => {
    dialog().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
  })
}

function Harness({
  onOpenChange,
  dismissDisabled,
}: {
  onOpenChange: (open: boolean) => void
  dismissDisabled?: boolean
}) {
  return (
    <ChipModal
      open
      onOpenChange={onOpenChange}
      srTitle='Test modal'
      dismissDisabled={dismissDisabled}
    >
      <ChipModalHeader onClose={() => onOpenChange(false)}>Title</ChipModalHeader>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        primaryAction={{ label: 'Save', onClick: () => {} }}
      />
    </ChipModal>
  )
}

describe('ChipModal dismissDisabled', () => {
  it('closes through every path when not set', () => {
    const onOpenChange = vi.fn()
    mount(<Harness onOpenChange={onOpenChange} />)

    expect(closeButton().disabled).toBe(false)
    expect(buttonByText('Cancel').disabled).toBe(false)

    pressEscape()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // Outside-click is guarded by the same flag but jsdom cannot drive Radix's
  // outside-interaction path, so asserting it here could never fail.
  it('blocks the close button, Cancel and Escape when set', () => {
    const onOpenChange = vi.fn()
    mount(<Harness onOpenChange={onOpenChange} dismissDisabled />)

    expect(closeButton().disabled).toBe(true)
    expect(buttonByText('Cancel').disabled).toBe(true)

    pressEscape()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  // Either flag disables: an explicit `false` must not re-enable a button whose
  // click Radix has already been told to ignore.
  it('cannot be re-enabled by an explicit closeDisabled or cancelDisabled of false', () => {
    const onOpenChange = vi.fn()
    mount(
      <ChipModal open onOpenChange={onOpenChange} srTitle='Test modal' dismissDisabled>
        <ChipModalHeader onClose={() => onOpenChange(false)} closeDisabled={false}>
          Title
        </ChipModalHeader>
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          cancelDisabled={false}
          primaryAction={{ label: 'Save', onClick: () => {} }}
        />
      </ChipModal>
    )

    expect(closeButton().disabled).toBe(true)
    expect(buttonByText('Cancel').disabled).toBe(true)
  })

  it('still lets an explicit true disable a button on its own', () => {
    const onOpenChange = vi.fn()
    mount(
      <ChipModal open onOpenChange={onOpenChange} srTitle='Test modal'>
        <ChipModalHeader onClose={() => onOpenChange(false)} closeDisabled>
          Title
        </ChipModalHeader>
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          primaryAction={{ label: 'Save', onClick: () => {} }}
        />
      </ChipModal>
    )

    expect(closeButton().disabled).toBe(true)
    expect(buttonByText('Cancel').disabled).toBe(false)
  })
})

describe('ModalContent dismissDisabled', () => {
  it('runs a consumer escape handler without letting it drop the guard', () => {
    const onOpenChange = vi.fn()
    const onEscapeKeyDown = vi.fn()
    mount(
      <Modal open onOpenChange={onOpenChange}>
        <ModalContent srTitle='Guarded' dismissDisabled onEscapeKeyDown={onEscapeKeyDown}>
          <input aria-label='Field' />
        </ModalContent>
      </Modal>
    )

    pressEscape()
    expect(onEscapeKeyDown).toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('disables the built-in ModalHeader close button', () => {
    const onOpenChange = vi.fn()
    mount(
      <Modal open onOpenChange={onOpenChange}>
        <ModalContent srTitle='Guarded' dismissDisabled>
          <ModalHeader>Title</ModalHeader>
        </ModalContent>
      </Modal>
    )

    expect(closeButton().disabled).toBe(true)
  })
})

describe('ChipConfirmModal pending', () => {
  it('holds every exit shut while the confirm runs', () => {
    const onOpenChange = vi.fn()
    mount(
      <ChipConfirmModal
        open
        onOpenChange={onOpenChange}
        title='Delete key'
        text='This cannot be undone.'
        confirm={{ label: 'Delete', onClick: () => {}, pending: true, pendingLabel: 'Deleting...' }}
      />
    )

    expect(closeButton().disabled).toBe(true)
    expect(buttonByText('Cancel').disabled).toBe(true)
    expect(buttonByText('Deleting...').disabled).toBe(true)

    pressEscape()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('dismisses normally when the confirm is idle', () => {
    const onOpenChange = vi.fn()
    mount(
      <ChipConfirmModal
        open
        onOpenChange={onOpenChange}
        title='Delete key'
        text='This cannot be undone.'
        confirm={{ label: 'Delete', onClick: () => {} }}
      />
    )

    expect(closeButton().disabled).toBe(false)
    act(() => closeButton().click())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe("ChipModalField inputType='password'", () => {
  const MASK_CLASS = '[-webkit-text-security:disc]'

  function passwordInput(): HTMLInputElement {
    // Index 1: Radix autofocuses the first field on open, so the fixture leads
    // with a plain field the way the real Add-user modal leads with Name.
    const node = document.querySelectorAll<HTMLInputElement>('input')[1]
    if (!node) throw new Error('Password input did not render')
    return node
  }

  function mountPasswordField(value: string) {
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Add user'>
        <ChipModalBody>
          <ChipModalField type='input' title='Name' value='Canary' onChange={() => {}} />
          <ChipModalField
            type='input'
            inputType='password'
            title='Password'
            value={value}
            onChange={() => {}}
          />
        </ChipModalBody>
      </ChipModal>
    )
  }

  it('masks the value until the field is focused, and re-masks on blur', () => {
    mountPasswordField('hunter2-secret')
    expect(passwordInput().className).toContain(MASK_CLASS)

    act(() => passwordInput().focus())
    expect(passwordInput().className).not.toContain(MASK_CLASS)
    expect(passwordInput().readOnly).toBe(false)

    act(() => passwordInput().blur())
    expect(passwordInput().className).toContain(MASK_CLASS)
  })

  it('renders a read-only text input rather than a native password field', () => {
    mountPasswordField('hunter2-secret')

    // `type='password'` could not be revealed in place, and a writable field
    // invites a password manager to autofill the operator's own credentials.
    expect(passwordInput().type).toBe('text')
    expect(passwordInput().readOnly).toBe(true)
  })

  it('offers the eye toggle only once there is something to reveal', () => {
    mountPasswordField('')
    expect(document.querySelector('[aria-label="Show password"]')).toBeNull()

    act(() => root?.unmount())
    mountPasswordField('hunter2-secret')

    const toggle = document.querySelector<HTMLButtonElement>('[aria-label="Show password"]')
    if (!toggle) throw new Error('Reveal toggle did not render')

    act(() => toggle.click())
    expect(passwordInput().className).not.toContain(MASK_CLASS)
    expect(document.querySelector('[aria-label="Hide password"]')).not.toBeNull()
  })

  it('keeps the toggle label honest when a keyboard moves focus to it', () => {
    mountPasswordField('hunter2-secret')
    act(() => passwordInput().focus())

    // Tabbing to the toggle blurs the input, which re-masks — so by the time a
    // keyboard can activate the button it already reads "Show password", and
    // activating it reveals. The label must never disagree with what is on
    // screen, in either direction.
    const focusedToggle = document.querySelector<HTMLButtonElement>('[aria-label="Hide password"]')
    if (!focusedToggle) throw new Error('Toggle should read "Hide password" while focused')
    act(() => focusedToggle.focus())
    expect(passwordInput().className).toContain(MASK_CLASS)

    const toggle = document.querySelector<HTMLButtonElement>('[aria-label="Show password"]')
    if (!toggle) throw new Error('Toggle should read "Show password" once the input has blurred')

    // Enter/Space on a focused button dispatch a plain click, with no mousedown.
    act(() => toggle.click())
    expect(passwordInput().className).not.toContain(MASK_CLASS)
    expect(document.querySelector('[aria-label="Hide password"]')).not.toBeNull()
  })

  it('hides a revealed password on keyboard activation when the input is not focused', () => {
    mountPasswordField('hunter2-secret')

    const reveal = document.querySelector<HTMLButtonElement>('[aria-label="Show password"]')
    if (!reveal) throw new Error('Reveal toggle did not render')
    act(() => reveal.click())
    expect(passwordInput().className).not.toContain(MASK_CLASS)

    const hide = document.querySelector<HTMLButtonElement>('[aria-label="Hide password"]')
    if (!hide) throw new Error('Hide toggle did not render')
    act(() => hide.click())
    expect(passwordInput().className).toContain(MASK_CLASS)
  })

  it('hides a focused password instead of re-revealing it', () => {
    mountPasswordField('hunter2-secret')
    act(() => passwordInput().focus())

    const toggle = document.querySelector<HTMLButtonElement>('[aria-label="Hide password"]')
    if (!toggle) throw new Error('Hide toggle did not render')

    // jsdom does not move focus on mousedown, so model what a browser does: the
    // press blurs the input unless the handler prevents the default. Without the
    // control's preventDefault that blur re-masks first, and the click then
    // toggles back to revealed — leaving the password on screen.
    act(() => {
      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      toggle.dispatchEvent(press)
      if (!press.defaultPrevented) passwordInput().blur()
      toggle.click()
    })

    expect(passwordInput().className).toContain(MASK_CLASS)
    expect(document.querySelector('[aria-label="Show password"]')).not.toBeNull()
  })
})
