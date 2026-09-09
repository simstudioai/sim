/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('next/image', () => ({
  default: ({
    alt,
    className,
    draggable,
  }: {
    alt: string
    className?: string
    draggable?: boolean
  }) => <img alt={alt} className={className} draggable={draggable} />,
}))

import { LOGOS } from '@/app/(landing)/components/logos'
import { NavMenuLogoMarquee } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-logo-marquee'

afterEach(() => {
  document.body.replaceChildren()
})

describe('NavMenuLogoMarquee', () => {
  it('loops two non-draggable logo rows and hides the second from assistive technology', () => {
    const host = document.createElement('div')
    document.body.append(host)
    act(() => {
      createRoot(host).render(<NavMenuLogoMarquee />)
    })

    const rows = host.querySelectorAll('ul')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('aria-label')).toBe(
      'Companies building and governing AI agents with Sim'
    )
    expect(rows[0].getAttribute('aria-hidden')).toBeNull()
    expect(rows[1].getAttribute('aria-hidden')).toBe('true')

    const named = [...rows[0].querySelectorAll('img')].map((img) => img.getAttribute('alt'))
    expect(named).toEqual(LOGOS.map((logo) => logo.name))
    for (const img of rows[1].querySelectorAll('img')) {
      expect(img.getAttribute('alt')).toBe('')
    }

    for (const img of host.querySelectorAll('img')) {
      expect(img.getAttribute('draggable')).toBe('false')
    }

    const track = rows[0].parentElement
    expect(track?.parentElement?.className).toContain('mask-image')
  })
})
