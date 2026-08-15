/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  chipVariants: () => 'chip',
}))

import { OAuthConnectLink } from '@/app/credential-groups/enroll/[token]/oauth-reconnect-link'

describe('OAuthConnectLink', () => {
  it('presents an unconnected authorization as Connect', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => root.render(<OAuthConnectLink href='/oauth/start' />))

    const link = container.querySelector('a')
    expect(link?.textContent).toBe('Connect')
    expect(link?.getAttribute('href')).toBe('/oauth/start')
    act(() => root.unmount())
  })

  it('presents a connected authorization as Reconnect', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    const root = createRoot(container)

    act(() => root.render(<OAuthConnectLink href='/oauth/start' reconnect />))

    const link = container.querySelector('a')
    expect(link?.textContent).toBe('Reconnect')
    expect(link?.getAttribute('href')).toBe('/oauth/start')
    act(() => root.unmount())
  })
})
