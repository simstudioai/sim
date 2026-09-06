/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

import {
  ProductDemoBeatProvider,
  ProductDemoCaption,
  useProductDemoBeat,
} from '@/app/(landing)/components/product-demo/components/product-demo-caption'
import styles from '@/app/(landing)/components/product-demo/components/product-demo-caption/product-demo-caption.module.css'

function BuildButton() {
  const { setBeat } = useProductDemoBeat()
  return (
    <button type='button' onClick={() => setBeat('build')}>
      build
    </button>
  )
}

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('ProductDemoCaption', () => {
  it('opens still on the describe title, then crossfades to the next beat', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    document.body.append(host)
    act(() => {
      createRoot(host).render(
        <ProductDemoBeatProvider>
          <ProductDemoCaption />
          <BuildButton />
        </ProductDemoBeatProvider>
      )
    })

    const heading = () => host.querySelector('h2#product-demo-heading')
    const titles = () => host.querySelectorAll('[data-product-demo-caption] > *')
    expect(heading()?.textContent).toBe('Describe the agent.')
    expect(heading()?.className).not.toContain(styles.enter)
    expect(titles()).toHaveLength(1)

    act(() => {
      host.querySelector('button')?.click()
    })
    expect(heading()?.textContent).toBe('Watch the workflow build.')
    expect(heading()?.className).toContain(styles.enter)
    const stacked = titles()
    expect(stacked).toHaveLength(2)
    expect(stacked[0].getAttribute('aria-hidden')).toBe('true')
    expect(stacked[0].className).toContain('opacity-0')
    expect(stacked[0].textContent).toBe('Describe the agent.')

    act(() => {
      vi.advanceTimersByTime(320)
    })
    expect(titles()).toHaveLength(1)
    expect(heading()?.textContent).toBe('Watch the workflow build.')
  })
})
