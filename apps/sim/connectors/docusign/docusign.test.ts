import { knowledgeDocumentsUtilsMock } from '@sim/testing/mocks/knowledge-documents-utils.mock'
import {
  knowledgeSecureFetchMock,
  knowledgeSecureFetchMockFns,
} from '@sim/testing/mocks/knowledge-secure-fetch.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/utils', () => knowledgeDocumentsUtilsMock)
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)

import { docusignConnector } from '@/connectors/docusign/docusign'

const mockFetchWithRetry = knowledgeSecureFetchMockFns.mockFetchWithRetry

const DEFAULT_ACCOUNT = '99999999-0000-0000-0000-000000000001'
const PINNED_ACCOUNT = '99999999-0000-0000-0000-000000000002'
/** A production account, pinned, while the deployment's OAuth host stays on demo. */
const BOUND_BASE = `https://na3.docusign.net/restapi/v2.1/accounts/${PINNED_ACCOUNT}`

function reply(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

/** Answers userinfo with a demo default account and every envelope listing with one envelope. */
function mockDocuSign() {
  mockFetchWithRetry.mockImplementation(async (url: string) => {
    if (url.endsWith('/oauth/userinfo')) {
      return reply({
        accounts: [
          { account_id: DEFAULT_ACCOUNT, is_default: true, base_uri: 'https://demo.docusign.net' },
        ],
      })
    }
    return reply({
      envelopes: [{ envelopeId: 'env-1', emailSubject: 'Offer', status: 'sent' }],
      totalSetSize: '1',
    })
  })
}

describe('docusign connector account binding', () => {
  it("lists the JWT credential's pinned account in its own environment, never the deployment default", async () => {
    mockDocuSign()

    const result = await docusignConnector.listDocuments('jwt-token', {}, undefined, {
      credentialInstanceUrl: BOUND_BASE,
    })

    const urls = mockFetchWithRetry.mock.calls.map(([url]) => String(url))
    expect(urls.some((url) => url.endsWith('/oauth/userinfo'))).toBe(false)
    expect(urls[0].startsWith(`${BOUND_BASE}/envelopes?`)).toBe(true)
    expect(result.documents[0]?.sourceUrl).toBe('https://app.docusign.com/documents/details/env-1')
  })

  it('resolves an OAuth token through userinfo on the deployment host as before', async () => {
    mockDocuSign()

    const result = await docusignConnector.listDocuments('oauth-token', {}, undefined, {})

    const urls = mockFetchWithRetry.mock.calls.map(([url]) => String(url))
    expect(urls[0]).toBe('https://account-d.docusign.com/oauth/userinfo')
    expect(
      urls[1].startsWith(`https://demo.docusign.net/restapi/v2.1/accounts/${DEFAULT_ACCOUNT}/`)
    ).toBe(true)
    expect(result.documents[0]?.sourceUrl).toBe(
      'https://appdemo.docusign.com/documents/details/env-1'
    )
  })

  it('validates a JWT credential without asking the deployment host', async () => {
    mockDocuSign()

    await expect(
      docusignConnector.validateConfig('jwt-token', {}, { credentialInstanceUrl: BOUND_BASE })
    ).resolves.toEqual({ valid: true })
    expect(mockFetchWithRetry).not.toHaveBeenCalled()
  })

  it.each([
    'https://evil.example.com/restapi/v2.1/accounts/x',
    `http://na3.docusign.net/restapi/v2.1/accounts/${PINNED_ACCOUNT}`,
  ])('fails closed on a seeded account base of the wrong shape: %s', async (bound) => {
    mockDocuSign()

    await expect(
      docusignConnector.listDocuments('jwt-token', {}, undefined, { credentialInstanceUrl: bound })
    ).rejects.toThrow('DocuSign credential account URL is invalid')
    await expect(
      docusignConnector.validateConfig('jwt-token', {}, { credentialInstanceUrl: bound })
    ).resolves.toMatchObject({ valid: false })
    expect(mockFetchWithRetry).not.toHaveBeenCalled()
  })
})
