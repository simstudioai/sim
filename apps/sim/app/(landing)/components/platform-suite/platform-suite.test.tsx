/**
 * @vitest-environment jsdom
 */
import { type AnchorHTMLAttributes, act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: ReactNode; href: string } & Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    'href'
  >) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/app/(landing)/components/placement-frame', () => ({
  PlacementFrame: ({ className }: { className?: string }) => <div className={className} />,
}))

vi.mock('@/app/(landing)/components/shared/product-window', () => ({
  ProductWindow: ({ kind }: { kind: string }) => <div data-preview-kind={kind} />,
}))

import { PlatformSuite } from '@/app/(landing)/components/platform-suite/platform-suite'

afterEach(() => {
  document.body.replaceChildren()
})

describe('PlatformSuite', () => {
  it('balances the card copy and redistributes card width on hover', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(<PlatformSuite />)
    })

    expect(host.textContent).toContain('One Platform for every AI Agent')
    expect(host.textContent).toContain(
      'Build and deploy agents in one collaborative workspace, with centralized control over access, spend, data, and performance.'
    )
    expect(host.textContent).toContain('Build agents')
    expect(host.textContent).toContain('Govern at scale')

    const buildCard = host.querySelector('[data-platform-card="0"]') as HTMLElement
    const governCard = host.querySelector('[data-platform-card="1"]') as HTMLElement
    expect(buildCard.tagName).toBe('DIV')
    expect(buildCard.querySelector('h3 a')?.getAttribute('href')).toBe('/workflows')
    expect(buildCard.querySelector('h3 a')?.className).toContain('after:absolute after:inset-0')
    expect(governCard.querySelector('h3 a')?.getAttribute('href')).toBe('/enterprise')
    expect(buildCard.querySelector('svg.iso-integrate-illustration')).not.toBeNull()
    expect(governCard.querySelector('svg.iso-monitor-illustration')).not.toBeNull()
    const buildMark = buildCard.querySelector('svg') as SVGElement
    const buildTitle = buildCard.querySelector('h3') as HTMLElement
    expect(
      buildMark.compareDocumentPosition(buildTitle) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    const governContent = governCard.querySelector('[data-platform-card-content]') as HTMLElement
    expect(governContent.className).not.toContain('opacity-40')

    expect(buildCard.className).toContain('md:grow')
    expect(governCard.className).toContain('md:grow')

    act(() => {
      buildCard.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(buildCard.className).toContain('md:grow-[1.25]')
    expect(governCard.className).toContain('md:grow-[0.75]')
    expect(governContent.className).toContain('opacity-40')
    expect(
      (buildCard.querySelector('[data-platform-card-content]') as HTMLElement).className
    ).not.toContain('opacity-40')

    act(() => {
      buildCard.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
      )
    })

    expect(buildCard.className).toContain('md:grow')
    expect(governCard.className).toContain('md:grow')

    act(() => {
      root.unmount()
    })
  })
})
