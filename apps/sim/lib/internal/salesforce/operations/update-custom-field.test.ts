/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeSalesforceUpdateCustomFieldOperation } from '@/lib/internal/salesforce/operations/update-custom-field'

const PARAMS = {
  accessToken: 'salesforce-token',
  instanceUrl: 'https://example.my.salesforce.com',
  fieldId: '00N000000000001',
  label: 'Updated label',
}

describe('salesforce update custom field operation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes the execution signal to both Salesforce requests', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(Response.json({ Metadata: { type: 'Text', label: 'Old label' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const controller = new AbortController()

    await executeSalesforceUpdateCustomFieldOperation(PARAMS as never, controller.signal)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBe(controller.signal)
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      Metadata: { type: 'Text', label: 'Updated label' },
    })
  })

  it('does not patch after cancellation arrives during the metadata read', async () => {
    const fetchMock = vi.mocked(fetch)
    const controller = new AbortController()
    const reason = new DOMException('cancelled', 'AbortError')
    fetchMock.mockImplementationOnce(async () => {
      controller.abort(reason)
      return Response.json({ Metadata: { type: 'Text', label: 'Old label' } })
    })

    await expect(
      executeSalesforceUpdateCustomFieldOperation(PARAMS as never, controller.signal)
    ).rejects.toBe(reason)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails before patching when a successful metadata read is malformed JSON', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(new Response('not-json'))

    await expect(executeSalesforceUpdateCustomFieldOperation(PARAMS as never)).rejects.toThrow(
      /malformed JSON/
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails before patching when a successful read omits Metadata', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(Response.json({ Id: PARAMS.fieldId }))

    await expect(executeSalesforceUpdateCustomFieldOperation(PARAMS as never)).rejects.toThrow(
      /no custom field metadata/
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a field ID that could escape the CustomField path before provider work', async () => {
    const fetchMock = vi.mocked(fetch)

    await expect(
      executeSalesforceUpdateCustomFieldOperation({
        ...PARAMS,
        fieldId: '../CustomObject',
      } as never)
    ).rejects.toThrow('Field ID must be a 15- or 18-character Salesforce record ID')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
