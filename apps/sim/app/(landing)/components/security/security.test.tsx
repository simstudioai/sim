/**
 * @vitest-environment node
 */
import type { AnchorHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  ChipLink: ({
    variant: _variant,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: string }) => <a {...props} />,
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

import { Security } from '@/app/(landing)/components/security/security'

describe('Security', () => {
  it('renders the governance intro and white certification blocs', () => {
    const html = renderToStaticMarkup(<Security />)

    expect(html).toContain('id="security"')
    expect(html).not.toContain('min-h-[100dvh]')
    expect(html).toContain('>Central governance for enterprise AI</h2>')
    expect(html).toContain(
      'Sim is one place to control who can build agents, what they can use, and how the workspace runs.'
    )
    expect(html).toContain('>SOC 2 Type II</span>')
    expect(html).toContain('>ISO 27001</span>')
    expect(html).toContain('>GDPR</span>')
    expect(html).toContain('href="https://trust.sim.ai/"')
    expect(html).toContain('bg-[var(--surface-2)]')
    expect(html).toContain('aspect-[5/6]')
    expect(html).toContain('rounded-[10px]')
    expect(html).not.toContain('rounded-[12px]')
    expect(html).not.toContain('How the workspace runs')
    expect(html).not.toContain('Self-hosting')
    expect(html).not.toContain('SOC2 compliant')
    expect(html).not.toContain('HIPAA')
    expect(html).not.toContain('CCPA')
  })
})
