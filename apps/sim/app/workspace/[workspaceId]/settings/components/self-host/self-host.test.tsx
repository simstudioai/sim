/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SelfHost } from '@/app/workspace/[workspaceId]/settings/components/self-host/self-host'

describe('SelfHost settings section', () => {
  it('links to the managed Chat keys page', () => {
    const markup = renderToStaticMarkup(<SelfHost />)

    expect(markup).toContain('href="https://www.sim.ai/selfhost/settings/chat-keys"')
  })

  /**
   * The body is the Chat keys row and nothing else — no section label, and so
   * none of `SettingsSection`'s label/divider chrome above it.
   */
  it('renders the Chat keys row with no section header', () => {
    const markup = renderToStaticMarkup(<SelfHost />)

    expect(markup.indexOf('Chat keys')).toBeLessThan(markup.indexOf('Managed keys'))
    expect(markup).not.toContain('<section')
    expect(markup).not.toContain('bg-[var(--border)]')
  })

  /**
   * The section is deliberately only the managed link — no status readouts,
   * capability inventories, or environment-variable listings.
   */
  it('renders exactly one link and no other controls', () => {
    const markup = renderToStaticMarkup(<SelfHost />)

    expect(markup.match(/<a /g)).toHaveLength(1)
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('<input')
  })
})
