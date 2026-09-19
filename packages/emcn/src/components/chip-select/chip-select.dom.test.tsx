/**
 * @vitest-environment jsdom
 */
import { act, createRef, type ReactNode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChipModal } from '../chip-modal/chip-modal'
import { ChipSelect, type ChipSelectProps } from './chip-select'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mountNode(node: ReactNode): HTMLButtonElement {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(node))
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
  if (!trigger) throw new Error('ChipSelect did not render a trigger')
  return trigger
}

function mount(
  fullWidth: boolean,
  aria: Pick<ChipSelectProps, 'aria-required' | 'aria-invalid' | 'aria-describedby'> = {}
) {
  return mountNode(
    <ChipSelect
      value='workflow'
      options={[{ value: 'workflow', label: 'Workflow' }]}
      fullWidth={fullWidth}
      aria-label='Principal type'
      {...aria}
    />
  )
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10)
  })
}

async function key(node: Element, key: string) {
  act(() => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
  await settle()
}

function menuItem(label: string, role = 'menuitem') {
  const item = [...document.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find(
    (item) => item.textContent === label
  )
  if (!item) throw new Error(`Missing menu item ${label}`)
  return item
}

function changeSearch(value: string) {
  const input = document.querySelector('input')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.removeAttribute('style')
  vi.useRealTimers()
})

describe('ChipSelect', () => {
  it('fills its container when fullWidth is enabled', () => {
    expect(mount(true).className).toContain('w-full')
  })

  it('keeps its intrinsic width by default', () => {
    expect(mount(false).className).not.toContain('w-full')
  })

  it('renders its text trigger through the fade-only overflow primitive', () => {
    const label = mount(true).querySelector<HTMLElement>('[data-overflow-text]')

    expect(label?.textContent).toBe('Workflow')
    expect(label?.className).toContain('text-clip')
    expect(label?.className).not.toContain('truncate')
  })

  it.each([true, 'true'] as const)(
    'announces %s field states alongside the supplied error description',
    (state) => {
      const trigger = mount(true, {
        'aria-required': state,
        'aria-invalid': state,
        'aria-describedby': 'field-error',
      })
      const error = document.createElement('p')
      error.id = 'field-error'
      error.textContent = 'Choose an available principal.'
      container?.appendChild(error)

      const description = trigger
        .getAttribute('aria-describedby')!
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .join(' ')

      expect(description).toBe('Choose an available principal. Required. Invalid selection.')
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
      expect(trigger.hasAttribute('aria-required')).toBe(false)
      expect(trigger.hasAttribute('aria-invalid')).toBe(false)
      expect(trigger.textContent).toBe('Workflow')
    }
  )

  it.each([false, 'false'] as const)(
    'keeps the original description when field states are %s',
    (state) => {
      const trigger = mount(true, {
        'aria-required': state,
        'aria-invalid': state,
        'aria-describedby': 'field-hint',
      })

      expect(trigger.getAttribute('aria-describedby')).toBe('field-hint')
      expect(container?.textContent).toBe('Workflow')
    }
  )
})

describe('ChipSelect menu interactions', () => {
  it.each([true, false])(
    'selects by keyboard, skips disabled rows and restores focus (modal=%s)',
    async (modal) => {
      vi.useFakeTimers()
      const onChange = vi.fn()
      const trigger = mountNode(
        <ChipSelect
          modal={modal}
          onChange={onChange}
          options={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta', disabled: true },
            { value: 'c', label: 'Gamma' },
          ]}
        />
      )
      await key(trigger, 'ArrowDown')
      expect(document.activeElement).toBe(menuItem('Alpha'))
      await key(document.activeElement!, 'ArrowDown')
      expect(document.activeElement).toBe(menuItem('Gamma'))
      await key(document.activeElement!, 'Enter')
      expect(onChange).toHaveBeenCalledExactlyOnceWith('c')
      expect(document.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    }
  )

  it('keeps multiple selection open and clears to the explicit all/empty state', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    function Picker() {
      const [values, setValues] = useState<string[]>([])
      return (
        <ChipSelect
          multiSelect
          multiSelectValues={values}
          onMultiSelectChange={(next) => {
            setValues(next)
            onChange(next)
          }}
          showAllOption
          allOptionLabel='All owners'
          options={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta', disabled: true },
          ]}
        />
      )
    }
    const trigger = mountNode(<Picker />)
    expect(trigger.textContent).toBe('All owners')
    await key(trigger, 'ArrowDown')
    act(() => menuItem('Beta', 'menuitemcheckbox').click())
    expect(onChange).not.toHaveBeenCalled()
    act(() => menuItem('Alpha', 'menuitemcheckbox').click())
    await settle()
    expect(onChange).toHaveBeenLastCalledWith(['a'])
    expect(trigger.textContent).toBe('Alpha')
    expect(menuItem('Alpha', 'menuitemcheckbox').getAttribute('aria-checked')).toBe('true')
    act(() => menuItem('All owners', 'menuitemcheckbox').click())
    expect(onChange).toHaveBeenLastCalledWith([])
    expect(trigger.textContent).toBe('All owners')
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('searches grouped rich labels using aliases, clears search on Escape and restores the trigger', async () => {
    vi.useFakeTimers()
    const trigger = mountNode(
      <ChipSelect
        searchable
        groups={[
          {
            section: 'Cloud',
            items: [
              {
                value: 'gcp',
                label: <strong>Google Cloud</strong>,
                searchTerms: ['Google Cloud', 'gcloud'],
              },
            ],
          },
          { section: 'Source', items: [{ value: 'gh', label: 'GitHub' }] },
        ]}
      />
    )
    await key(trigger, 'ArrowDown')
    changeSearch('cloud')
    expect(menuItem('Google Cloud').querySelector('strong')).not.toBeNull()
    changeSearch('gcloud')
    expect(menuItem('Google Cloud').querySelector('strong')).not.toBeNull()
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('Source')
    changeSearch('missing')
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('No results')
    await key(document.querySelector('input')!, 'Escape')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await key(trigger, 'ArrowDown')
    expect(document.querySelector('input')?.value).toBe('')
    expect(menuItem('GitHub')).toBeTruthy()
  })

  it('preserves rich labels, trigger refs, selected checks and explicit menu width', async () => {
    vi.useFakeTimers()
    const ref = createRef<HTMLButtonElement>()
    const trigger = mountNode(
      <ChipSelect
        ref={ref}
        id='status'
        aria-labelledby='status'
        showSelectedCheck
        dropdownWidth={280}
        value=''
        options={[
          {
            value: '',
            label: <span>None</span>,
            searchTerms: ['None'],
            iconElement: <span data-testid='avatar' />,
          },
        ]}
      />
    )
    expect(ref.current).toBe(trigger)
    expect(trigger.textContent).toBe('None')
    expect(trigger.getAttribute('aria-labelledby')).toBe('status')
    await key(trigger, 'ArrowDown')
    expect(document.querySelector('[role="menu"]')?.getAttribute('style')).toContain('width: 280px')
    expect(menuItem('None').querySelector('[data-testid="avatar"]')).not.toBeNull()
    expect(menuItem('None').querySelector('svg')).not.toBeNull()
  })

  it('keeps an empty selection distinct from All when no reset row is offered', async () => {
    vi.useFakeTimers()
    const trigger = mountNode(
      <ChipSelect
        multiSelect
        multiSelectValues={[]}
        placeholder='Select workspaces'
        options={[{ value: 'a', label: 'Alpha' }]}
      />
    )
    expect(trigger.textContent).toBe('Select workspaces')
    await key(trigger, 'ArrowDown')
    expect(document.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(1)
  })

  it('closes only the menu with Escape inside a modal and restores the nested trigger', async () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    mountNode(
      <ChipModal open onOpenChange={dismiss} srTitle='Settings'>
        <ChipSelect
          modal={false}
          searchable
          placeholder='Access'
          options={[{ value: 'a', label: 'Alpha' }]}
        />
      </ChipModal>
    )
    await settle()
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await key(trigger, 'ArrowDown')
    await key(document.querySelector('input')!, 'Escape')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(dismiss).not.toHaveBeenCalled()
  })
})
