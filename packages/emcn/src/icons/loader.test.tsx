/**
 * @vitest-environment jsdom
 */
import { Loader } from '@sim/emcn'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

describe('Loader', () => {
  it('keeps each rendered loader connected to its own filter', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(
      <>
        <Loader animate className='size-[14px]' />
        <Loader animate width={18} height={18} />
        <Loader />
      </>
    )

    const loaders = Array.from(container.querySelectorAll('svg'))
    const filterIds = loaders.map((loader) => loader.querySelector('filter')?.id)

    expect(loaders).toHaveLength(3)
    expect(new Set(filterIds).size).toBe(loaders.length)
    for (const loader of loaders) {
      const filterId = loader.querySelector('filter')?.id
      expect(filterId).toMatch(/^loader-relay-[a-zA-Z0-9-]+$/)
      expect(loader.querySelector('g[filter]')?.getAttribute('filter')).toBe(`url(#${filterId})`)
    }
  })
})
