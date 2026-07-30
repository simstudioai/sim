/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { RESEND_API_KEY: 're_test' },
}))

import {
  createOrSegmentNewsletterContact,
  ensureNewsletterContactProperties,
  getResendExcludedEmails,
  getResendSuppressedEmails,
} from '@/lib/newsletters/resend'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('newsletter Resend service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('creates missing newsletter contact properties', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'property-1', key: 'sim_user_id' }],
          has_more: false,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'property-2' }, 201))

    await ensureNewsletterContactProperties()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.resend.com/contact-properties?limit=100',
      expect.objectContaining({ method: 'GET' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.resend.com/contact-properties',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ key: 'newsletter_run_id', type: 'string' }),
      })
    )
  })

  it('creates a new contact with properties and segment membership', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'contact-1' }, 201))

    const result = await createOrSegmentNewsletterContact({
      email: ' User@Example.com ',
      name: 'Ada Lovelace',
      userId: 'user-1',
      runId: 'run-1',
      segmentId: 'segment-1',
    })

    expect(result).toEqual({ status: 'created', contactId: 'contact-1' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/contacts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'user@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
          properties: {
            sim_user_id: 'user-1',
            newsletter_run_id: 'run-1',
          },
          segments: [{ id: 'segment-1' }],
        }),
      })
    )
  })

  it('updates properties and segment membership for an existing contact', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Contact already exists' }, 409))
      .mockResolvedValueOnce(jsonResponse({ id: 'contact-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'segment-1' }))

    const result = await createOrSegmentNewsletterContact({
      email: 'user@example.com',
      name: 'Ada Lovelace',
      userId: 'user-1',
      runId: 'run-1',
      segmentId: 'segment-1',
    })

    expect(result).toEqual({ status: 'updated', contactId: 'contact-1' })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.resend.com/contacts/user%40example.com',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            sim_user_id: 'user-1',
            newsletter_run_id: 'run-1',
          },
        }),
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.resend.com/contacts/user%40example.com/segments/segment-1',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('normalizes suppressed email addresses', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: 'suppression-1', email: ' First@Example.com ' },
          { id: 'suppression-2', email: 'second@example.com' },
        ],
        has_more: false,
      })
    )

    const emails = await getResendSuppressedEmails()

    expect(emails).toEqual(new Set(['first@example.com', 'second@example.com']))
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/suppressions?limit=100',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('paginates through all suppressed email addresses', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'suppression-1', email: 'first@example.com' }],
          has_more: true,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'suppression-2', email: 'second@example.com' }],
          has_more: false,
        })
      )

    const emails = await getResendSuppressedEmails()

    expect(emails).toEqual(new Set(['first@example.com', 'second@example.com']))
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.resend.com/suppressions?limit=100&after=suppression-1',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('combines suppressions with globally unsubscribed contacts', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'suppression-1', email: 'suppressed@example.com' }],
          has_more: false,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 'contact-1', email: 'subscribed@example.com', unsubscribed: false },
            {
              id: 'contact-2',
              email: ' Unsubscribed@Example.com ',
              unsubscribed: true,
            },
          ],
          has_more: false,
        })
      )

    const emails = await getResendExcludedEmails()

    expect(emails).toEqual(new Set(['suppressed@example.com', 'unsubscribed@example.com']))
  })

  it('fails closed when Resend contact pagination has no cursor', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ data: [], has_more: true }))

    await expect(getResendExcludedEmails()).rejects.toThrow(
      'Resend contact pagination returned no cursor'
    )
  })

  it('fails closed on a malformed suppression response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    await expect(getResendSuppressedEmails()).rejects.toThrow(
      'Resend suppression list response was malformed'
    )
  })

  it('fails closed on a malformed contact entry', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [], has_more: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'contact-1', email: 'user@example.com' }],
          has_more: false,
        })
      )

    await expect(getResendExcludedEmails()).rejects.toThrow(
      'Resend contact list response was malformed'
    )
  })
})
