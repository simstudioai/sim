/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Favicon } from '@/components/favicon/favicon'

const fallback = <svg data-fallback='' />

describe('Favicon', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(() => act(() => root.unmount()))

  it('renders the fallback at once for every later icon of a host whose icon failed', () => {
    act(() => root.render(<Favicon host='no-icon.example' fallback={fallback} />))
    const failed = container.querySelector('img')
    expect(failed).not.toBeNull()
    act(() => failed?.dispatchEvent(new Event('error')))
    expect(container.querySelector('img')).toBeNull()

    act(() =>
      root.render(
        <>
          <Favicon key='other-surface' host='no-icon.example' fallback={fallback} />
          <Favicon host='has-icon.example' fallback={fallback} />
        </>
      )
    )
    expect(container.querySelectorAll('[data-fallback]')).toHaveLength(1)
    expect(
      [...container.querySelectorAll('img')].map((image) => image.getAttribute('src'))
    ).toEqual(['/api/favicon?host=has-icon.example'])
  })
})
