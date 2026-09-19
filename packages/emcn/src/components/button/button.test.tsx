/** @vitest-environment node */
/** biome-ignore assist/source/organizeImports: Preserve the documented core/external/UI import order. */
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
