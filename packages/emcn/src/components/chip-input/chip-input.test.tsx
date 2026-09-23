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
  it.each([undefined, 'lg'] as const)(
    'emits a single height for size %s without forwarding it to the native field',
    (size) => {
      const input = mount(<ChipInput size={size} disabled aria-label='Search' />)
      const heights = input.parentElement?.className
        .split(' ')
        .filter((token) => token.startsWith('h-'))
      expect(heights).toEqual([size === 'lg' ? 'h-9' : 'h-[30px]'])
      expect(input.hasAttribute('size')).toBe(false)
      expect(input.disabled).toBe(true)
    }
  )

  it('keeps the focused input mounted when custom leading content changes', () => {
    const input = mount()
    const render = (color: string) => (
      <ChipInput
        aria-label='Color'
        startAdornment={<span aria-hidden style={{ backgroundColor: color }} />}
        endAdornment={<button type='button'>Reset</button>}
      />
    )
    act(() => root?.render(render('#123456')))
    input.focus()
    input.value = '#123456'
    act(() => root?.render(render('#abcdef')))

    expect(container?.querySelector('input')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('#123456')
    expect(input.previousElementSibling?.getAttribute('style')).toContain('rgb(171, 205, 239)')
    expect(input.nextElementSibling?.textContent).toBe('Reset')
  })

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
          size='lg'
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
    expect(input.parentElement?.className).toContain('h-9')
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
