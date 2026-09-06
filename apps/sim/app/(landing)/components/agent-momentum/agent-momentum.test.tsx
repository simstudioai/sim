/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

import { AgentMomentum } from '@/app/(landing)/components/agent-momentum/agent-momentum'

describe('AgentMomentum', () => {
  it('renders the supplied savings, hours, and builders totals in order', () => {
    const markup = renderToStaticMarkup(<AgentMomentum />)

    expect(markup).toContain(
      'The world’s work is moving to AI agents. Sim gives teams one place to build, deploy, monitor and govern every agent across the business.'
    )
    expect(markup).not.toContain('<h2')
    expect(markup).toContain('100,000+')
    expect(markup).toContain('builders already using Sim to create and manage AI agents')
    expect(markup).toContain('grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-x-24')
    expect(markup).toContain('flex w-full flex-col border-[var(--border)] border-b')
    expect(markup).not.toContain('gap-x-24 border-[var(--border)] border-t')
    expect(markup).toContain('dollars saved by teams using Sim to automate their work')
    expect(markup).toContain('hours of work completed in Sim')
    expect(markup).toContain('$20,000,000')
    expect(markup).toContain('1,270,000')
    expect(markup.indexOf('dollars saved')).toBeLessThan(markup.indexOf('hours of work'))
    expect(markup.indexOf('hours of work')).toBeLessThan(markup.indexOf('builders already'))
    expect(markup).not.toContain('agent-callable tools')
    expect(markup).not.toContain('built-in integrations')
    expect(markup).toContain('aria-label="AI agent momentum"')
  })
})
