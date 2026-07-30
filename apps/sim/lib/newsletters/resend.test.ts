/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, sleepMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  sleepMock: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { RESEND_API_KEY: 're_test' },
}))

vi.mock('@sim/utils/helpers', () => ({
  sleep: sleepMock,
}))

import {
  createNewsletterSegment,
  createOrSegmentNewsletterContact,
  ensureNewsletterContactProperties,
  getResendExcludedEmails,
  getResendSuppressedEmails,
  isNewsletterResendError,
  NewsletterResendError,
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
    sleepMock.mockResolvedValue(undefined)
  })

  it('forwards cancellation to Resend requests', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'segment-1', name: 'Segment 1' }, 201))

    await createNewsletterSegment('Segment 1', { signal: controller.signal })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/segments',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('classifies only typed Resend service failures', () => {
    expect(isNewsletterResendError(new NewsletterResendError('provider unavailable'))).toBe(true)
    expect(isNewsletterResendError(new Error('Resend text from unrelated code'))).toBe(false)
  })

  it('does not make a Resend request when already aborted', async () => {
    const controller = new AbortController()
    controller.abort('cancelled')

    await expect(createNewsletterSegment('Segment 1', { signal: controller.signal })).rejects.toBe(
      'cancelled'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves cancellation while reading a Resend error response', async () => {
    const controller = new AbortController()
    const body = new ReadableStream({
      pull(streamController) {
        controller.abort('cancelled while reading')
        streamController.error(new Error('body read failed'))
      },
    })
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 400 }))

    await expect(createNewsletterSegment('Segment 1', { signal: controller.signal })).rejects.toBe(
      'cancelled while reading'
    )
  })

  it('does not retry after cancellation during backoff', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'retry' }, 429))
    sleepMock.mockImplementationOnce(async () => {
      controller.abort('cancelled')
    })

    await expect(createNewsletterSegment('Segment 1', { signal: controller.signal })).rejects.toBe(
      'cancelled'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

  it('does not add segment membership after cancellation', async () => {
    const controller = new AbortController()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Contact already exists' }, 409))
      .mockImplementationOnce(async () => {
        controller.abort('cancelled')
        return jsonResponse({ id: 'contact-1' })
      })

    await expect(
      createOrSegmentNewsletterContact({
        email: 'user@example.com',
        name: 'Ada Lovelace',
        userId: 'user-1',
        runId: 'run-1',
        segmentId: 'segment-1',
        signal: controller.signal,
      })
    ).rejects.toBe('cancelled')
    expect(fetchMock).toHaveBeenCalledTimes(2)
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
