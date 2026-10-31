import { describe, expect, it } from 'vitest'
import {
  parseHttpsPage,
  signInHintHost,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/sign-in-hosts'

function hintFor(url: string | undefined): string | null {
  const page = parseHttpsPage(url)
  return page ? signInHintHost(page) : null
}

describe('signInHintHost', () => {
  it.each([
    'https://accounts.google.com/v3/signin/identifier',
    'https://signin.aws.amazon.com/oauth',
    'https://us-east-1.signin.aws.amazon.com/oauth',
    'https://d-1234567890.awsapps.com/start',
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    'https://login.live.com/login.srf',
    'https://acme.okta.com/app/UserHome',
    'https://acme.oktapreview.com/',
    'https://github.com/login/oauth/authorize?client_id=x',
    'https://github.com/sessions/two-factor/webauthn',
    'https://appleid.apple.com/sign-in',
    'https://acme.us.auth0.com/u/login',
  ])('offers the hint on %s', (url) => {
    expect(hintFor(url)).toBe(new URL(url).hostname)
  })

  it.each([
    ['a lookalike that only starts with the host', 'https://accounts.google.com.evil.com/'],
    ['a lookalike that only ends with the suffix', 'https://evil-okta.com/'],
    ['the bare wildcard suffix', 'https://okta.com/'],
    ['the same host over plain http', 'http://accounts.google.com/'],
    ['a GitHub page that is not a sign-in', 'https://github.com/simstudioai/sim'],
    ['a GitHub path that only starts with login', 'https://github.com/loginx'],
    ['an ordinary site', 'https://example.com/login'],
    ['a blank tab', 'about:blank'],
    ['nothing', undefined],
    ['garbage', 'not a url'],
  ])('stays quiet on %s', (_label, url) => {
    expect(hintFor(url)).toBeNull()
  })
})
