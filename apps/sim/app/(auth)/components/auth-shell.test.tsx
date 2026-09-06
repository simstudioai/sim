/** @vitest-environment node */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { AuthShell } from '@/app/(auth)/components/auth-shell'

vi.mock('next/link', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <a href='/' data-client-navigation>
      {children}
    </a>
  ),
}))
vi.mock('@/app/_shell/desktop-title-bar', () => ({ DesktopTitleBarLane: () => null }))
vi.mock('@/app/(landing)/components/navbar/components', () => ({
  LogoMark: ({ children }: { children: ReactNode }) => <>{children}</>,
  SimWordmark: () => 'Sim',
}))

it('returns home through a document link so route-specific theme defaults reinitialize', () => {
  const html = renderToStaticMarkup(<AuthShell>Sign in</AuthShell>)
  expect(html).toContain('href="/" aria-label="Sim home"')
  expect(html).not.toContain('data-client-navigation')
})
