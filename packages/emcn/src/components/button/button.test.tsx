/** @vitest-environment jsdom */
/** biome-ignore assist/source/organizeImports: Preserve the documented core/external/UI import order. */
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from '@sim/emcn'

function normalizeClasses(markup: string) {
  return markup.replace(
    /class="([^"]+)"/g,
    (_, classes: string) => `class="${classes.split(/\s+/).sort().join(' ')}"`
  )
}

/** The three existing Button treatments used by compact product actions. */
const TREATMENTS = [
  { size: undefined, variant: 'ghost' },
  { size: 'sm', variant: 'ghost-secondary' },
  { size: 'icon', variant: 'ghost' },
] as const

describe('Button iconSize', () => {
  for (const [iconSize, previousClass] of [
    ['compact', 'size-6 p-0'],
    ['compact-fixed', 'size-[24px] p-0'],
    ['regular', 'size-7 p-0'],
    ['roomy', 'size-8 p-0'],
    ['touch', 'size-10 p-0'],
  ] as const) {
    it.each(TREATMENTS)(
      `preserves the ${iconSize} treatment with size=$size and variant=$variant`,
      (treatment) => {
        const icon = <svg className='size-[14px]' strokeWidth={1.55} aria-hidden='true' />
        const before = renderToStaticMarkup(
          <Button
            {...treatment}
            type='button'
            aria-label='Previous match'
            className={`${previousClass} shrink-0`}
          >
            {icon}
          </Button>
        )
        const after = renderToStaticMarkup(
          <Button
            {...treatment}
            type='button'
            aria-label='Previous match'
            iconSize={iconSize}
            className='shrink-0'
          >
            {icon}
          </Button>
        )
        expect(normalizeClasses(after)).toBe(normalizeClasses(before))
      }
    )
  }

  it('allows explicit padding and consumer width to take precedence', () => {
    const markup = renderToStaticMarkup(
      <Button iconSize='compact-fixed' iconPadding='sm' className='w-[40px]!' aria-label='Run' />
    )
    expect(markup).toContain('size-[24px]')
    expect(markup).toContain('w-[40px]!')
    expect(markup).toContain('p-1')
    expect(markup).not.toContain('p-0')
    expect(markup).not.toContain('iconSize')
    expect(markup).not.toContain('iconPadding')
  })
})

describe('Button shared action geometry', () => {
  it('composes responsive geometry, explicit padding and round shape without changing icon treatment', () => {
    const markup = renderToStaticMarkup(
      <Button
        variant='ghost'
        size='icon'
        iconSize={{ base: 'touch', sm: 'regular' }}
        iconPadding='sm'
        shape='round'
        aria-label='Edit'
      >
        <svg strokeWidth={1.55} />
      </Button>
    )
    expect(markup).toContain('size-10')
    expect(markup).toContain('sm:size-7')
    expect(markup).not.toContain('size-[20px]')
    expect(markup).toContain('p-1')
    expect(markup).not.toContain('p-0')
    expect(markup).toContain('rounded-full')
    expect(markup).not.toContain('rounded-sm')
    expect(markup).toContain('[stroke-width:1.25]')
    expect(markup).toContain('text-[var(--text-icon-muted)]')
    expect(markup).not.toMatch(/(?:iconSize|iconPadding|shape)=/)
  })

  it('retains an inline caption size and supports a base-only responsive value', () => {
    const inline = renderToStaticMarkup(<Button size='inline'>Generate</Button>)
    expect(inline).toContain('h-[20px]')
    expect(inline).toContain('text-caption')
    expect(inline).toContain('px-1.5 py-0')
    const baseOnly = renderToStaticMarkup(<Button iconSize={{ base: 'roomy' }} aria-label='Run' />)
    expect(baseOnly).toContain('size-8')
    expect(baseOnly).not.toContain('sm:size')
  })

  it('offers the existing muted keyboard ring without changing the default', () => {
    const before = renderToStaticMarkup(
      <Button
        variant='ghost'
        size='sm'
        className='focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text-muted)_30%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)]'
      >
        Open
      </Button>
    )
    const after = renderToStaticMarkup(
      <Button variant='ghost' size='sm' focusRing='muted'>
        Open
      </Button>
    )
    expect(normalizeClasses(after)).toBe(normalizeClasses(before))
    expect(after).not.toContain('focusRing=')
    expect(renderToStaticMarkup(<Button>Open</Button>)).not.toContain('focus-visible:ring-2')
  })

  it('forwards refs and native focus, submission and disabled behavior with responsive sizing', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const ref = createRef<HTMLButtonElement>()
    let submissions = 0
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const render = (disabled: boolean) =>
      act(() =>
        root.render(
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submissions++
            }}
          >
            <Button
              ref={ref}
              type='submit'
              iconSize={{ base: 'touch', sm: 'regular' }}
              disabled={disabled}
              aria-label='Apply'
            />
          </form>
        )
      )
    try {
      render(false)
      ref.current?.focus()
      expect(document.activeElement).toBe(ref.current)
      act(() => ref.current?.click())
      expect(submissions).toBe(1)
      render(true)
      act(() => ref.current?.click())
      expect(submissions).toBe(1)
      expect(ref.current?.disabled).toBe(true)
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
