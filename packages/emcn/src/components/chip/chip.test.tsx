/** @vitest-environment jsdom */
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Chip, ChipLink, chipVariants } from './chip'
import { chipGeometryClass, chipGeometryUnroundedClass } from './chip-chrome'

describe('Chip geometry', () => {
  it.each([undefined, 'lg'] as const)(
    'uses one height for raw variants, buttons and links at size %s',
    (size) => {
      const height = size === 'lg' ? 'h-9' : 'h-[30px]'
      expect(
        chipVariants({ size })
          .split(' ')
          .filter((token) => token.startsWith('h-'))
      ).toEqual([height])
      for (const node of [
        <Chip key='button' size={size}>
          Continue
        </Chip>,
        <ChipLink key='link' size={size} href='/workspace'>
          Continue
        </ChipLink>,
      ]) {
        const markup = renderToStaticMarkup(node)
        expect(markup).toContain(height)
        expect(markup).not.toContain(size === 'lg' ? 'h-[30px]' : 'h-9')
        expect(markup).not.toMatch(/ size=/)
      }
      expect(chipGeometryUnroundedClass).toContain('h-[30px]')
      expect(chipGeometryClass).toContain('h-[30px]')
      expect(chipGeometryClass).toContain('rounded-lg')
    }
  )

  it('centers the icon and label without preventing long text from shrinking', () => {
    const markup = renderToStaticMarkup(
      <Chip fullWidth align='center' leftAdornment={<svg aria-hidden />}>
        Continue with your identity provider
      </Chip>
    )
    expect(markup).toContain('justify-center')
    expect(markup).toContain('flex-initial')
    expect(markup).toContain('min-w-0')
    expect(markup).not.toContain('flex-none')
    expect(markup).not.toMatch(/ align=/)
  })

  it('preserves native refs, focus, submission, disabled actions and link navigation', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const button = createRef<HTMLButtonElement>()
    const link = createRef<HTMLAnchorElement>()
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
            <Chip ref={button} size='lg' align='center' fullWidth type='submit' disabled={disabled}>
              <strong>Continue</strong>
            </Chip>
            <ChipLink ref={link} size='lg' align='center' href='/workspace'>
              <strong>Workspace</strong>
            </ChipLink>
          </form>
        )
      )
    try {
      render(false)
      button.current?.focus()
      expect(document.activeElement).toBe(button.current)
      act(() => button.current?.click())
      expect(submissions).toBe(1)
      expect(link.current?.getAttribute('href')).toBe('/workspace')
      render(true)
      act(() => button.current?.click())
      expect(submissions).toBe(1)
      expect(button.current?.disabled).toBe(true)
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
