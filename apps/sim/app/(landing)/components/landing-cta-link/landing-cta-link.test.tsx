/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCaptureClientEvent } = vi.hoisted(() => ({ mockCaptureClientEvent: vi.fn() }))

vi.mock('@/lib/posthog/client', () => ({ captureClientEvent: mockCaptureClientEvent }))

import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function renderLink(element: React.ReactElement): HTMLAnchorElement {
  act(() => root.render(element))
  const anchor = host.querySelector('a')
  if (!anchor) throw new Error('Missing anchor')
  return anchor
}

describe('LandingCtaLink', () => {
  it('hardens external destinations and leaves internal ones on the client router', () => {
    const external = renderLink(
      <LandingCtaLink href='https://docs.sim.ai/workflows'>Docs</LandingCtaLink>
    )
    expect(external.getAttribute('target')).toBe('_blank')
    expect(external.getAttribute('rel')).toBe('noopener noreferrer')

    const internal = renderLink(<LandingCtaLink href='/signup'>Sign up</LandingCtaLink>)
    expect(internal.hasAttribute('target')).toBe(false)
    expect(internal.hasAttribute('rel')).toBe(false)
  })
})
