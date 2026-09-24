/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MemberAvatar } from '@/components/member-avatar/member-avatar'

describe('MemberAvatar', () => {
  it('falls back to the initial on the neutral disc, with no per-person color', () => {
    const markup = renderToStaticMarkup(<MemberAvatar name='ada lovelace' image={null} />)
    expect(markup).toContain('>A<')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain('style=')
  })
})
