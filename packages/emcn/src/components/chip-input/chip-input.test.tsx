/**
 * @vitest-environment jsdom
 */
import { act, createRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChipTextarea } from '../chip-textarea/chip-textarea'
import { ChipInput } from './chip-input'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(node: ReactNode = <ChipInput aria-label='Search' />): HTMLInputElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(node))

  const input = container.querySelector<HTMLInputElement>('input')
  if (!input) throw new Error('ChipInput did not render an input')
  return input
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ChipInput', () => {
  it('reserves paintable clearance for a leading glyph without shifting its alignment', () => {
    const input = mount()

    expect(input.className).toContain('-ml-1')
    expect(input.className).toContain('indent-1')
  })
})

describe('chip form controls', () => {
  it('forwards native field refs, labels, validation and form submission without losing height constraints', () => {
    const inputRef = createRef<HTMLInputElement>()
    const textareaRef = createRef<HTMLTextAreaElement>()
    const submit = vi.fn((event) => event.preventDefault())
    const input = mount(
      <form onSubmit={submit}>
        <label htmlFor='email'>Work email</label>
        <ChipInput
          ref={inputRef}
          id='email'
          name='email'
          type='email'
          required
          error
          aria-invalid
          aria-describedby='error'
          className='h-[34px]'
        />
        <p id='error'>Enter a work email</p>
        <ChipTextarea
          ref={textareaRef}
          name='description'
          rows={3}
          className='min-h-[80px]'
          defaultValue='Description'
        />
        <button type='submit'>Continue</button>
      </form>
    )
    expect(inputRef.current).toBe(input)
    expect(input.labels?.[0].textContent).toBe('Work email')
    expect(input.getAttribute('aria-describedby')).toBe('error')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.parentElement?.className).toContain('h-[34px]')
    expect(input.parentElement?.className).toContain('border-[var(--text-error)]')
    expect(textareaRef.current?.rows).toBe(3)
    expect(textareaRef.current?.className).toContain('min-h-[80px]')
    act(() => container?.querySelector('button')?.click())
    expect(submit).not.toHaveBeenCalled()
    input.value = 'review@example.com'
    act(() => container?.querySelector('button')?.click())
    expect(submit).toHaveBeenCalledOnce()
    const data = new FormData(container!.querySelector('form')!)
    expect(data.get('email')).toBe('review@example.com')
    expect(data.get('description')).toBe('Description')
  })
})
