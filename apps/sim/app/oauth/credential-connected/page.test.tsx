/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CredentialConnectedPage from '@/app/oauth/credential-connected/page'

describe('CredentialConnectedPage', () => {
  it('confirms a successful connection', async () => {
    const page = await CredentialConnectedPage({
      searchParams: Promise.resolve({ result: 'connected' }),
    })

    const markup = renderToStaticMarkup(page)
    expect(markup).toContain('Credential connected')
    expect(markup).toContain('The credential is ready to use.')
  })

  it('does not claim success when the provider returns an error', async () => {
    const page = await CredentialConnectedPage({
      searchParams: Promise.resolve({ result: 'connected', error: 'access_denied' }),
    })

    const markup = renderToStaticMarkup(page)
    expect(markup).toContain('Connection failed')
    expect(markup).not.toContain('Credential connected')
  })

  it('does not claim success without an explicit success result', async () => {
    const page = await CredentialConnectedPage({ searchParams: Promise.resolve({}) })

    const markup = renderToStaticMarkup(page)
    expect(markup).toContain('Connection failed')
    expect(markup).not.toContain('Credential connected')
  })
})
