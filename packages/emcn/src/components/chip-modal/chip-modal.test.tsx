/**
 * @vitest-environment jsdom
 */
import { act, type FormEvent, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChipInput } from '../chip-input/chip-input'
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
  vi.restoreAllMocks()
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
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    )
  })
}

function pressEnter(target: HTMLElement, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...init,
  })
  act(() => target.dispatchEvent(event))
  return event
}

function makeElementsVisible(): void {
  const rect = {
    bottom: 1,
    height: 1,
    left: 0,
    right: 1,
    top: 0,
    width: 1,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } satisfies DOMRect
  const rects = {
    0: rect,
    length: 1,
    item: (index: number) => (index === 0 ? rect : null),
    [Symbol.iterator]: function* () {
      yield rect
    },
  } as DOMRectList
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue(rects)
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
        confirm={{
          label: 'Delete',
          onClick: () => {},
          pending: true,
          pendingLabel: 'Deleting...',
        }}
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

describe('ChipModal default actions', () => {
  beforeEach(makeElementsVisible)

  it('fails safe to the dismiss decision in a confirmation', () => {
    mount(
      <ChipConfirmModal
        open
        onOpenChange={() => {}}
        title='Delete key'
        confirm={{ label: 'Delete', onClick: () => {} }}
      />
    )

    expect(document.activeElement).toBe(buttonByText('Cancel'))
  })

  it('focuses an explicitly declared confirm decision', () => {
    mount(
      <ChipConfirmModal
        open
        onOpenChange={() => {}}
        title='Restore archive'
        defaultAction='confirm'
        confirm={{ label: 'Restore', onClick: () => {}, variant: 'primary' }}
      />
    )

    expect(document.activeElement).toBe(buttonByText('Restore'))
  })

  it('focuses the dialog instead of arming a decision when the policy is none', () => {
    mount(
      <ChipConfirmModal
        open
        onOpenChange={() => {}}
        title='Delete account'
        defaultAction='none'
        confirm={{ label: 'Delete account', onClick: () => {} }}
      />
    )

    expect(document.activeElement).toBe(dialog())
  })

  it('treats the regular footer primary as the default action', () => {
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Create project'>
        <ChipModalHeader onClose={() => {}}>Create project</ChipModalHeader>
        <ChipModalFooter
          onCancel={() => {}}
          primaryAction={{ label: 'Create', onClick: () => {} }}
        />
      </ChipModal>
    )

    expect(document.activeElement).toBe(buttonByText('Create'))
  })

  it('supports a form-associated primary action without product-level DOM markers', () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Deploy workflow'>
        <ChipModalHeader onClose={() => {}}>Deploy workflow</ChipModalHeader>
        <ChipModalBody>
          <form id='deploy-form' onSubmit={onSubmit}>
            <ChipInput aria-label='Name' value='Canary' onChange={() => {}} />
          </form>
        </ChipModalBody>
        <ChipModalFooter
          hideCancel
          primaryAction={{ label: 'Deploy', type: 'submit', form: 'deploy-form' }}
        />
      </ChipModal>
    )

    const submit = buttonByText('Deploy')
    expect(submit.type).toBe('submit')
    expect(submit.getAttribute('form')).toBe('deploy-form')
    act(() => submit.click())
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('supports a canonical footer with no primary decision', () => {
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Deployment status'>
        <ChipModalHeader onClose={() => {}}>Deployment status</ChipModalHeader>
        <ChipModalFooter hideCancel defaultAction='none' leadingContent={<span>Live</span>} />
      </ChipModal>
    )

    expect(document.activeElement).toBe(dialog())
    expect(dialog().textContent).toContain('Live')
  })

  it('falls back to an enabled dismiss action when the declared action is disabled', () => {
    mount(
      <ChipConfirmModal
        open
        onOpenChange={() => {}}
        title='Delete key'
        defaultAction='confirm'
        confirm={{ label: 'Delete', onClick: () => {}, disabled: true }}
      />
    )

    expect(document.activeElement).toBe(buttonByText('Cancel'))
  })

  it('falls back to the dialog when pending disables every decision', () => {
    mount(
      <ChipConfirmModal
        open
        onOpenChange={() => {}}
        title='Delete key'
        defaultAction='confirm'
        confirm={{ label: 'Delete', onClick: () => {}, pending: true }}
      />
    )

    expect(document.activeElement).toBe(dialog())
  })

  it('ignores hidden policies and activates the visible default action', () => {
    const onHidden = vi.fn()
    const onVisible = vi.fn()
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Visible action'>
        <ChipModalHeader onClose={() => {}}>Visible action</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField type='input' title='Name' value='Canary' onChange={() => {}} />
        </ChipModalBody>
        <div aria-hidden='true'>
          <ChipModalFooter
            onCancel={() => {}}
            primaryAction={{ label: 'Hidden save', onClick: onHidden }}
          />
        </div>
        <ChipModalFooter
          onCancel={() => {}}
          primaryAction={{ label: 'Visible save', onClick: onVisible }}
        />
      </ChipModal>
    )

    const input = document.querySelector<HTMLInputElement>('input')
    if (!input) throw new Error('Name input did not render')
    pressEnter(input)
    expect(onHidden).not.toHaveBeenCalled()
    expect(onVisible).toHaveBeenCalledOnce()
  })

  it('submits a canonical single-line field through the regular footer', () => {
    const onSave = vi.fn()
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Rename project'>
        <ChipModalHeader onClose={() => {}}>Rename project</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField type='input' title='Name' value='Canary' onChange={() => {}} />
        </ChipModalBody>
        <ChipModalFooter onCancel={() => {}} primaryAction={{ label: 'Save', onClick: onSave }} />
      </ChipModal>
    )

    const input = document.querySelector<HTMLInputElement>('input')
    if (!input) throw new Error('Name input did not render')
    expect(document.activeElement).toBe(input)
    expect(pressEnter(input).defaultPrevented).toBe(true)
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('submits a raw custom ChipInput through the modal fallback', () => {
    const onSave = vi.fn()
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Rename project'>
        <ChipModalHeader onClose={() => {}}>Rename project</ChipModalHeader>
        <ChipModalBody>
          <ChipInput aria-label='Name' value='Canary' onChange={() => {}} />
        </ChipModalBody>
        <ChipModalFooter onCancel={() => {}} primaryAction={{ label: 'Save', onClick: onSave }} />
      </ChipModal>
    )

    const input = document.querySelector<HTMLInputElement>('[aria-label="Name"]')
    if (!input) throw new Error('Custom input did not render')
    expect(pressEnter(input).defaultPrevented).toBe(true)
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('registers an explicit confirm decision for canonical field submission', () => {
    const onConfirm = vi.fn()
    mount(
      <ChipConfirmModal
        open
        onOpenChange={() => {}}
        title='Rename and restore'
        defaultAction='confirm'
        confirm={{ label: 'Restore', onClick: onConfirm, variant: 'primary' }}
      >
        <ChipModalField type='input' title='Name' value='Canary' onChange={() => {}} />
      </ChipConfirmModal>
    )

    const input = document.querySelector<HTMLInputElement>('input')
    if (!input) throw new Error('Name input did not render')
    pressEnter(input)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('does not register the confirm decision when dismissal remains the default', () => {
    const onConfirm = vi.fn()
    mount(
      <ChipConfirmModal
        open
        onOpenChange={() => {}}
        title='Delete key'
        confirm={{ label: 'Delete', onClick: onConfirm }}
      >
        <ChipModalField type='input' title='Name' value='Canary' onChange={() => {}} />
      </ChipConfirmModal>
    )

    const input = document.querySelector<HTMLInputElement>('input')
    if (!input) throw new Error('Name input did not render')
    expect(pressEnter(input).defaultPrevented).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('yields Enter to a native form', () => {
    const onPrimary = vi.fn()
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Native form'>
        <ChipModalHeader onClose={() => {}}>Native form</ChipModalHeader>
        <ChipModalBody>
          <form onSubmit={(event) => event.preventDefault()}>
            <ChipInput aria-label='Native field' value='Canary' onChange={() => {}} />
          </form>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => {}}
          primaryAction={{ label: 'Save', onClick: onPrimary }}
        />
      </ChipModal>
    )

    const input = document.querySelector<HTMLInputElement>('[aria-label="Native field"]')
    if (!input) throw new Error('Native form input did not render')
    expect(pressEnter(input).defaultPrevented).toBe(false)
    expect(onPrimary).not.toHaveBeenCalled()
  })

  it('yields a canonical field to its native form', () => {
    const onPrimary = vi.fn()
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Native form'>
        <ChipModalHeader onClose={() => {}}>Native form</ChipModalHeader>
        <ChipModalBody>
          <form onSubmit={(event) => event.preventDefault()}>
            <ChipModalField type='input' title='Name' value='Canary' onChange={() => {}} />
          </form>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => {}}
          primaryAction={{ label: 'Save', onClick: onPrimary }}
        />
      </ChipModal>
    )

    const input = document.querySelector<HTMLInputElement>('input')
    if (!input) throw new Error('Native form field did not render')
    expect(pressEnter(input).defaultPrevented).toBe(false)
    expect(onPrimary).not.toHaveBeenCalled()
  })

  it('yields Enter to multiline, tag-like and autocomplete controls', () => {
    const onPrimary = vi.fn()
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Owned Enter controls'>
        <ChipModalHeader onClose={() => {}}>Owned Enter controls</ChipModalHeader>
        <ChipModalBody>
          <textarea aria-label='Notes' defaultValue='Line one' />
          <ChipModalField type='custom' title='Tag' submitOnEnter={false}>
            <ChipInput aria-label='Tag' value='canary' onChange={() => {}} />
          </ChipModalField>
          <ChipInput
            aria-label='Autocomplete'
            aria-autocomplete='list'
            value='canary'
            onChange={() => {}}
          />
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => {}}
          primaryAction={{ label: 'Save', onClick: onPrimary }}
        />
      </ChipModal>
    )

    for (const label of ['Notes', 'Tag', 'Autocomplete']) {
      const control = document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
      if (!control) throw new Error(`${label} control did not render`)
      expect(pressEnter(control).defaultPrevented).toBe(false)
    }
    expect(onPrimary).not.toHaveBeenCalled()
  })

  it('honors submitOnEnter=false on canonical fields', () => {
    const onPrimary = vi.fn()
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Schedule runs'>
        <ChipModalHeader onClose={() => {}}>Schedule runs</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='input'
            title='Number of runs'
            value='2'
            onChange={() => {}}
            submitOnEnter={false}
          />
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => {}}
          primaryAction={{ label: 'Schedule', onClick: onPrimary }}
        />
      </ChipModal>
    )

    const input = document.querySelector<HTMLInputElement>('input')
    if (!input) throw new Error('Runs input did not render')
    expect(pressEnter(input).defaultPrevented).toBe(true)
    expect(onPrimary).not.toHaveBeenCalled()
  })

  it('does not activate a disabled confirm from a field', () => {
    const onConfirm = vi.fn()
    mount(
      <ChipConfirmModal
        open
        onOpenChange={() => {}}
        title='Restore archive'
        defaultAction='confirm'
        confirm={{ label: 'Restore', onClick: onConfirm, disabled: true, variant: 'primary' }}
      >
        <ChipModalField type='input' title='Name' value='Canary' onChange={() => {}} />
      </ChipConfirmModal>
    )

    const input = document.querySelector<HTMLInputElement>('input')
    if (!input) throw new Error('Name input did not render')
    expect(pressEnter(input).defaultPrevented).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('ignores composing and repeated Enter events', () => {
    const onPrimary = vi.fn()
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Rename project'>
        <ChipModalHeader onClose={() => {}}>Rename project</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField type='input' title='Name' value='Canary' onChange={() => {}} />
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => {}}
          primaryAction={{ label: 'Save', onClick: onPrimary }}
        />
      </ChipModal>
    )

    const input = document.querySelector<HTMLInputElement>('input')
    if (!input) throw new Error('Name input did not render')
    expect(pressEnter(input, { isComposing: true }).defaultPrevented).toBe(false)
    expect(pressEnter(input, { repeat: true }).defaultPrevented).toBe(false)
    expect(pressEnter(input, { shiftKey: true }).defaultPrevented).toBe(false)
    expect(pressEnter(input, { metaKey: true }).defaultPrevented).toBe(false)
    expect(onPrimary).not.toHaveBeenCalled()
  })

  it('associates confirmation copy with the dialog description', () => {
    mount(
      <ChipConfirmModal
        open
        onOpenChange={() => {}}
        title='Delete key'
        text='This immediately revokes access.'
        confirm={{ label: 'Delete', onClick: () => {} }}
      />
    )

    const descriptionId = dialog().getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId ?? '')?.textContent).toBe(
      'This immediately revokes access.'
    )
  })

  it('owns full-bleed body chrome through a semantic prop', () => {
    mount(
      <ChipModal open onOpenChange={() => {}} srTitle='Preview'>
        <ChipModalHeader onClose={() => {}}>Preview</ChipModalHeader>
        <ChipModalBody fullBleed data-testid='preview-body'>
          Preview content
        </ChipModalBody>
      </ChipModal>
    )

    const body = document.querySelector<HTMLElement>('[data-testid="preview-body"]')
    expect(body?.className).toContain('overflow-hidden')
    expect(body?.className).not.toContain('px-2')
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
      const press = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      })
      toggle.dispatchEvent(press)
      if (!press.defaultPrevented) passwordInput().blur()
      toggle.click()
    })

    expect(passwordInput().className).toContain(MASK_CLASS)
    expect(document.querySelector('[aria-label="Show password"]')).not.toBeNull()
  })
})
