/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' '),
}))
vi.mock('@/app/(landing)/components/shared/product-preview', () => ({
  ProductPreview: () => (
    <>
      <textarea aria-label='Preview composer' />
      <button type='button'>Run workflow</button>
    </>
  ),
}))

import { ProductWindow } from '@/app/(landing)/components/shared/product-window/product-window'

describe('ProductWindow accessibility', () => {
  it('isolates reused product controls inside an inert decorative region', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<ProductWindow kind='agents' />)

    for (const control of host.querySelectorAll('textarea, button')) {
      expect(control.closest('[inert][aria-hidden="true"]')).toBe(host.firstElementChild)
    }
  })
})
