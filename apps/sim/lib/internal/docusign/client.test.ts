/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocuSignClient } from '@/lib/internal/docusign/client'

function accountResponse(): Response {
  return Response.json({
    accounts: [
      {
        is_default: true,
        account_id: 'account-1',
        base_uri: 'https://demo.docusign.net',
      },
    ],
  })
}

describe('DocuSignClient', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('resolves the default account and forwards OAuth credentials', async () => {
    fetchMock
      .mockResolvedValueOnce(accountResponse())
      .mockResolvedValueOnce(Response.json({ envelopeId: 'envelope-1' }))
    const controller = new AbortController()
    const client = await DocuSignClient.create('access-token', controller.signal)
    await client.json('/envelopes/envelope-1', {}, 'Envelope', 'Failed', controller.signal)

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer access-token' },
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://demo.docusign.net/restapi/v2.1/accounts/account-1/envelopes/envelope-1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      })
    )
  })

  it('preserves provider status and error messages', async () => {
    fetchMock
      .mockResolvedValueOnce(accountResponse())
      .mockResolvedValueOnce(Response.json({ message: 'Envelope not found' }, { status: 404 }))
    const client = await DocuSignClient.create('access-token')

    await expect(
      client.json('/envelopes/missing', {}, 'Envelope', 'Failed to get envelope')
    ).rejects.toMatchObject({
      status: 404,
      body: { success: false, error: 'Envelope not found' },
    })
  })

  it('caps binary document downloads before materializing them', async () => {
    let cancelled = false
    fetchMock.mockResolvedValueOnce(accountResponse()).mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel: () => {
            cancelled = true
          },
        }),
        { headers: { 'Content-Length': String(25 * 1024 * 1024 + 1) } }
      )
    )
    const client = await DocuSignClient.create('access-token')

    await expect(client.document('envelope-1', 'combined')).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
    })
    expect(cancelled).toBe(true)
  })

  it('does not start provider work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(DocuSignClient.create('access-token', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
