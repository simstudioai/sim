/**
 * @vitest-environment jsdom
 */
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AuthLoadingAlternateActions,
  AuthLoadingField,
  AuthLoadingFrame,
  AuthLoadingSkeleton,
} from '@/app/(auth)/components/auth-loading-skeleton'

function render(element: ReactElement): HTMLDivElement {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(element)
  return container
}

describe('auth loading skeletons', () => {
  it.each([
    ['title', 'h-[38px]', 'rounded-[4px]'],
    ['label', 'h-[14px]', 'rounded-[4px]'],
    ['control', 'h-[44px]', 'rounded-[10px]'],
    ['divider', 'h-[1px]', 'rounded-[1px]'],
  ] as const)('retains the %s placeholder geometry', (shape, height, radius) => {
    const container = render(<AuthLoadingSkeleton shape={shape} className='w-[93px]' />)
    const skeleton = container.firstElementChild

    expect(skeleton?.classList.contains('animate-pulse')).toBe(true)
    expect(skeleton?.classList.contains('bg-[var(--surface-active)]')).toBe(true)
    expect(skeleton?.classList.contains(height)).toBe(true)
    expect(skeleton?.classList.contains(radius)).toBe(true)
    expect(skeleton?.classList.contains('w-[93px]')).toBe(true)
  })

  it('keeps one label, three controls, and one divider in the shared field and actions', () => {
    const container = render(
      <AuthLoadingFrame>
        <AuthLoadingField labelWidthClassName='w-[86px]' />
        <AuthLoadingAlternateActions />
      </AuthLoadingFrame>
    )
    const frame = container.firstElementChild
    const skeletons = Array.from(container.querySelectorAll('.animate-pulse'))

    expect(frame?.classList.contains('flex-col')).toBe(true)
    expect(skeletons).toHaveLength(5)
    expect(skeletons.filter((el) => el.classList.contains('h-[14px]'))).toHaveLength(1)
    expect(skeletons.filter((el) => el.classList.contains('h-[44px]'))).toHaveLength(3)
    expect(skeletons.filter((el) => el.classList.contains('h-[1px]'))).toHaveLength(1)
    expect(skeletons[0].classList.contains('w-[86px]')).toBe(true)
  })
})
