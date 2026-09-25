import { describe, expect, it } from 'vitest'
import { browserPageIssueCopy } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-page-issue'

describe('browserPageIssueCopy', () => {
  it('does not offer a certificate bypass', () => {
    const copy = browserPageIssueCopy({
      kind: 'load-error',
      code: -202,
      description: 'ERR_CERT_AUTHORITY_INVALID',
      url: 'https://example.invalid',
    })

    expect(copy.headline).toBe("Your connection isn't private")
    expect(copy.suggestions.join(' ')).not.toMatch(/continue|proceed|bypass/i)
  })

  it('bounds untrusted Chromium descriptions to a safe code', () => {
    expect(
      browserPageIssueCopy({
        kind: 'load-error',
        code: -2,
        description: '<script>alert(1)</script>',
        url: 'not a valid URL',
      })
    ).toMatchObject({ detail: 'The site could not be reached.', code: 'ERR_FAILED' })
  })
})
