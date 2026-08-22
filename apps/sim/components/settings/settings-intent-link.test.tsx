/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({
    prefetch,
    onNavigate: _onNavigate,
    ...props
  }: ComponentProps<'a'> & {
    prefetch: boolean | null
    onNavigate?: unknown
  }) => <a data-prefetch={String(prefetch)} {...props} />,
}))

import { SettingsIntentLink } from '@/components/settings/settings-intent-link'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SettingsIntentLink', () => {
  it('promotes prefetch from disabled to the Next.js default once the user signals intent', () => {
    const onIntent = vi.fn()
    act(() => {
      root.render(
        <SettingsIntentLink href='/settings/general' onIntent={onIntent}>
          General
        </SettingsIntentLink>
      )
    })

    const link = container.querySelector('a')
    expect(link).toHaveAttribute('data-prefetch', 'false')

    act(() => {
      link?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      link?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      link?.dispatchEvent(new Event('touchstart', { bubbles: true }))
    })

    expect(link).toHaveAttribute('data-prefetch', 'null')
    expect(onIntent).toHaveBeenCalledTimes(1)
  })

  it('honors a consumer preventing an intent event', () => {
    const onIntent = vi.fn()
    act(() => {
      root.render(
        <SettingsIntentLink
          href='/settings/general'
          onIntent={onIntent}
          onPointerEnter={(event) => event.preventDefault()}
        >
          General
        </SettingsIntentLink>
      )
    })

    const link = container.querySelector('a')
    act(() => link?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))

    expect(link).toHaveAttribute('data-prefetch', 'false')
    expect(onIntent).not.toHaveBeenCalled()
  })
})
