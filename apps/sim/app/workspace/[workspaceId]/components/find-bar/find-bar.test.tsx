/**
 * @vitest-environment jsdom
 *
 * The find bar's contract with the user: results follow typing (no Enter to
 * discover), the counter says which state the search is in, and Enter navigates
 * rather than submits.
 */
import { act, createRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' '),
  Button: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  ChipInput: ({
    endAdornment,
    icon: _icon,
    ...props
  }: { endAdornment?: ReactNode } & Record<string, unknown>) => (
    <>
      <input {...props} />
      {endAdornment}
    </>
  ),
}))

vi.mock('@sim/emcn/icons', () => ({
  ChevronDown: () => <span data-icon='chevron-down' />,
  ChevronRight: () => <span data-icon='chevron-right' />,
  ChevronUp: () => <span data-icon='chevron-up' />,
  Loader: () => <span data-icon='loader' />,
  Search: () => <span data-icon='search' />,
  X: () => <span data-icon='x' />,
}))

import {
  FindBar,
  type FindBarProps,
} from '@/app/workspace/[workspaceId]/components/find-bar/find-bar'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function render(overrides: Partial<FindBarProps> = {}) {
  const props: FindBarProps = {
    ariaLabel: 'Find in table',
    query: '',
    onQueryChange: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onSubmit: vi.fn(),
    onClose: vi.fn(),
    count: 0,
    currentIndex: 0,
    truncated: false,
    isLoading: false,
    inputRef: createRef<HTMLInputElement>(),
    ...overrides,
  }
  act(() => root.render(<FindBar {...props} />))
  return props
}

function input(): HTMLInputElement {
  const el = container.querySelector('input')
  if (!el) throw new Error('find input not rendered')
  return el
}

function counterText(): string | null {
  return container.querySelector('[aria-live="polite"]')?.textContent ?? null
}

function buttonByLabel(label: string): HTMLButtonElement {
  const el = container.querySelector(`button[aria-label="${label}"]`)
  if (!el) throw new Error(`no button labelled ${label}`)
  return el as HTMLButtonElement
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
  })
}

describe('FindBar counter', () => {
  it('shows nothing before the user has typed', () => {
    render({ query: '' })
    expect(counterText()).toBe('')
  })

  it('counts matches as 1-based', () => {
    render({ query: 'a', count: 12, currentIndex: 0 })
    expect(counterText()).toBe('1 of 12')
    render({ query: 'a', count: 12, currentIndex: 11 })
    expect(counterText()).toBe('12 of 12')
  })

  it('marks a server-capped result set', () => {
    render({ query: 'a', count: 1000, currentIndex: 0, truncated: true })
    expect(counterText()).toBe('1 of 1000+')
  })

  it('says No results only once the search has settled', () => {
    render({ query: 'zzz', count: 0, isLoading: true })
    expect(counterText()).toBe('')
    expect(container.querySelector('[data-icon="loader"]')).not.toBeNull()

    render({ query: 'zzz', count: 0, isLoading: false })
    expect(counterText()).toBe('No results')
  })

  // Blanking the tally on each keystroke reads as the search breaking; the
  // previous term's count holds until the new one lands.
  it('keeps the previous count visible while the next result set loads', () => {
    render({ query: 'ab', count: 3, currentIndex: 1, isLoading: true })
    expect(counterText()).toBe('2 of 3')
  })

  it('keeps the counter mounted and width-reserved before the user types', () => {
    render({ query: '' })
    const region = container.querySelector('[aria-live="polite"]')
    expect(region).not.toBeNull()
    expect(region?.className).toContain('min-w-[64px]')
  })
})

describe('FindBar keyboard', () => {
  it('navigates on Enter rather than submitting a search', () => {
    const props = render({ query: 'a', count: 3 })
    press('Enter')
    expect(props.onNext).toHaveBeenCalledTimes(1)
    expect(props.onPrev).not.toHaveBeenCalled()
  })

  it('steps backwards on Shift+Enter', () => {
    const props = render({ query: 'a', count: 3 })
    press('Enter', { shiftKey: true })
    expect(props.onPrev).toHaveBeenCalledTimes(1)
    expect(props.onNext).not.toHaveBeenCalled()
  })

  // Committing makes the typed and submitted terms agree instantly, but the
  // matches on screen still belong to the previous term until the request
  // lands — stepping there would select a cell the box no longer names.
  it('does not step while the committed term is still loading', () => {
    const props = render({ query: 'abcd', count: 3, isStale: false, canNavigate: false })
    press('Enter')
    expect(props.onNext).not.toHaveBeenCalled()
    expect(props.onSubmit).not.toHaveBeenCalled()

    press('Enter', { shiftKey: true })
    expect(props.onPrev).not.toHaveBeenCalled()
  })

  it('disables the arrows until the results describe the term', () => {
    render({ query: 'abcd', count: 3, canNavigate: false })
    expect(buttonByLabel('Next match').disabled).toBe(true)
    expect(buttonByLabel('Previous match').disabled).toBe(true)
  })

  it('closes on Escape', () => {
    const props = render({ query: 'a', count: 3 })
    press('Escape')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it.each(['Next match', 'Previous match', 'Clear search', 'Close find'])(
    'handles Escape from the focused %s button',
    (label) => {
      const props = render({ query: 'a', count: 3 })
      const button = buttonByLabel(label)
      button.focus()
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
      const parentKeyDown = vi.fn()
      document.body.addEventListener('keydown', parentKeyDown)
      act(() => button.dispatchEvent(event))
      document.body.removeEventListener('keydown', parentKeyDown)
      expect(props.onClose).toHaveBeenCalledOnce()
      expect(event.defaultPrevented).toBe(true)
      expect(parentKeyDown).not.toHaveBeenCalled()
    }
  )

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'does not close while Escape belongs to composition (%j)',
    (init) => {
      const props = render({ query: 'a', count: 3 })
      press('Escape', init)
      expect(props.onClose).not.toHaveBeenCalled()
    }
  )

  it.each(['Replace', 'All'])('retains focus after %s disables the last match', (label) => {
    const replace = {
      value: 'beta',
      onChange: vi.fn(),
      onReplace: vi.fn(),
      onReplaceAll: vi.fn(),
      canReplace: true,
      canReplaceAll: true,
    }
    const props = render({ query: 'alpha', count: 1, replace })
    act(() => buttonByLabel('Show replace').click())
    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === label
    )!
    button.focus()
    act(() => button.click())
    render({
      ...props,
      count: 0,
      replace: { ...replace, canReplace: false, canReplaceAll: false },
    })
    const replacement = container.querySelector('input[aria-label="Replace in document"]')
    expect(document.activeElement).toBe(replacement)
    act(() =>
      replacement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    )
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  // Mid-debounce the visible matches still belong to the previous term, so
  // stepping through them would land on a cell the box no longer describes.
  it('commits instead of stepping while the results are stale', () => {
    const props = render({ query: 'abcd', count: 3, isStale: true })
    press('Enter')
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
    expect(props.onNext).not.toHaveBeenCalled()

    press('Enter', { shiftKey: true })
    expect(props.onSubmit).toHaveBeenCalledTimes(2)
    expect(props.onPrev).not.toHaveBeenCalled()
  })

  // A surface that matches synchronously passes neither flag; Enter must still
  // step rather than stall on the defaults.
  it('steps on Enter when the surface declares no staleness model', () => {
    const props = render({ query: 'a', count: 3, onSubmit: undefined })
    press('Enter')
    expect(props.onNext).toHaveBeenCalledTimes(1)
  })
})

describe('FindBar controls', () => {
  it('offers a clear button only once there is text', () => {
    render({ query: '' })
    expect(container.querySelector('button[aria-label="Clear search"]')).toBeNull()

    const props = render({ query: 'abc' })
    act(() => buttonByLabel('Clear search').click())
    expect(props.onQueryChange).toHaveBeenCalledWith('')
  })

  it('disables navigation while there is nothing to navigate', () => {
    render({ query: 'zzz', count: 0 })
    expect(buttonByLabel('Next match').disabled).toBe(true)
    expect(buttonByLabel('Previous match').disabled).toBe(true)

    render({ query: 'a', count: 2 })
    expect(buttonByLabel('Next match').disabled).toBe(false)
    expect(buttonByLabel('Previous match').disabled).toBe(false)
  })

  it('reveals bounded replace controls without changing find-only surfaces', () => {
    render()
    expect(container.querySelector('input[aria-label="Replace in document"]')).toBeNull()

    const onReplace = vi.fn()
    const onReplaceAll = vi.fn()
    render({
      query: 'alpha',
      count: 2,
      replace: {
        value: 'beta',
        onChange: vi.fn(),
        onReplace,
        onReplaceAll,
        canReplace: true,
        canReplaceAll: true,
      },
    })
    act(() => buttonByLabel('Show replace').click())
    const replaceInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Replace in document"]'
    )
    expect(replaceInput?.value).toBe('beta')
    act(() =>
      replaceInput?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })
      )
    )
    expect(onReplace).not.toHaveBeenCalled()
    act(() =>
      replaceInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(onReplace).toHaveBeenCalledTimes(1)
    act(() => {
      const all = Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'All'
      )
      all?.click()
    })
    expect(onReplaceAll).toHaveBeenCalledTimes(1)
  })
})
