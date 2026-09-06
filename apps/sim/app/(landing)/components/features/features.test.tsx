/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Features } from '@/app/(landing)/components/features/features'

const MODULES = [
  { title: 'CLI', href: 'https://docs.sim.ai/cli' },
  { title: 'Workflows', href: '/workflows' },
  { title: 'Knowledge Base', href: '/knowledge' },
  { title: 'Tables', href: '/tables' },
  { title: 'Files', href: '/files' },
  { title: 'Logs', href: '/logs' },
] as const

describe('Features', () => {
  it('renders every core Sim module as a crawlable tall card', () => {
    const html = renderToStaticMarkup(<Features />)

    expect(html).toContain('Everything AI agents need to do real work')
    expect(html).toContain('aspect-[5/6]')
    expect(html).toContain('rounded-[12px]')
    expect(html).toContain('overflow-x-auto')

    for (const module of MODULES) {
      expect(html).toContain(`>${module.title}</h3>`)
      expect(html).toContain(`href="${module.href}"`)
    }
  })
})
