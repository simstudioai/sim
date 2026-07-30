import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'

const RESEND_API_BASE = 'https://api.resend.com'
const RESEND_MAX_ATTEMPTS = 4
const RESEND_MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const RESEND_MAX_ERROR_BYTES = 64 * 1024
const RESEND_CONTACT_PROPERTY_PAGE_LIMIT = 100
const RESEND_CONTACT_PROPERTY_MAX_PAGES = 10
const RESEND_CONTACT_PAGE_LIMIT = 100
const RESEND_CONTACT_MAX_PAGES = 1000
const RESEND_SUPPRESSION_PAGE_LIMIT = 100
const RESEND_SUPPRESSION_MAX_PAGES = 1000
const NEWSLETTER_CONTACT_PROPERTY_KEYS = ['sim_user_id', 'newsletter_run_id'] as const

interface ResendErrorBody {
  message?: string
  name?: string
  error?: string
}

interface ResendSegmentResponse {
  id: string
  name: string
}

interface ResendContactResponse {
  id?: string
}

interface ResendContactPropertyListResponse {
  data?: Array<{ id?: string; key?: string }>
  has_more?: boolean
}

interface ResendRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  required?: boolean
  maxResponseBytes?: number
  signal?: AbortSignal
}

const resendSuppressionListSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1), email: z.string().min(1) })),
  has_more: z.boolean(),
})

const resendContactListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      email: z.string().min(1),
      unsubscribed: z.boolean(),
    })
  ),
  has_more: z.boolean(),
})

function getResendApiKey(required = true): string | null {
  const key = env.RESEND_API_KEY?.trim()
  if (!key || key === 'placeholder') {
    if (required) throw new Error('RESEND_API_KEY is not configured')
    return null
  }
  return key
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function readError(response: Response): Promise<string> {
  const body = await readResponseJsonWithLimit<ResendErrorBody>(response, {
    maxBytes: RESEND_MAX_ERROR_BYTES,
    label: 'Resend error response',
  }).catch(() => null)
  return (
    body?.message || body?.error || body?.name || `Resend request failed with ${response.status}`
  )
}

async function resendRequest<T>(path: string, options: ResendRequestOptions = {}): Promise<T> {
  const key = getResendApiKey(options.required)
  if (!key) return undefined as T

  for (let attempt = 0; attempt < RESEND_MAX_ATTEMPTS; attempt++) {
    options.signal?.throwIfAborted()
    const response = await fetch(`${RESEND_API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })

    if (response.ok) {
      if (response.status === 204) return {} as T
      return readResponseJsonWithLimit<T>(response, {
        maxBytes: options.maxResponseBytes ?? RESEND_MAX_RESPONSE_BYTES,
        label: 'Resend API response',
      })
    }

    if (response.status === 429 || response.status >= 500) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      await sleep(backoffWithJitter(attempt + 1, retryAfterMs, { baseMs: 250, maxMs: 5000 }))
      options.signal?.throwIfAborted()
      continue
    }

    throw new Error(await readError(response))
  }

  throw new Error('Resend request failed after retries')
}

export async function getResendSuppressedEmails(options?: {
  required?: boolean
  signal?: AbortSignal
}) {
  const emails = new Set<string>()
  let after: string | null = null
  let hasMore = false

  for (let page = 0; page < RESEND_SUPPRESSION_MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(RESEND_SUPPRESSION_PAGE_LIMIT) })
    if (after) query.set('after', after)
    const rawResponse = await resendRequest<unknown>(`/suppressions?${query.toString()}`, {
      required: options?.required ?? true,
      signal: options?.signal,
    })
    if (rawResponse === undefined) return emails
    const parsedResponse = resendSuppressionListSchema.safeParse(rawResponse)
    if (!parsedResponse.success) {
      throw new Error('Resend suppression list response was malformed')
    }
    const response = parsedResponse.data

    for (const suppression of response.data) {
      emails.add(normalizeEmail(suppression.email))
    }

    hasMore = response.has_more
    if (!hasMore) break
    after = response.data.at(-1)?.id ?? null
    if (!after) throw new Error('Resend suppression pagination returned no cursor')
  }

  if (hasMore) {
    throw new Error('Resend suppression list exceeded the pagination safety limit')
  }

  return emails
}

export async function getResendExcludedEmails(options?: {
  signal?: AbortSignal
}): Promise<Set<string>> {
  const excludedEmails = await getResendSuppressedEmails({
    required: true,
    signal: options?.signal,
  })
  let after: string | null = null
  let hasMore = false

  for (let page = 0; page < RESEND_CONTACT_MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(RESEND_CONTACT_PAGE_LIMIT) })
    if (after) query.set('after', after)
    const rawContacts = await resendRequest<unknown>(`/contacts?${query.toString()}`, {
      required: true,
      signal: options?.signal,
    })
    const parsedContacts = resendContactListSchema.safeParse(rawContacts)
    if (!parsedContacts.success) {
      throw new Error('Resend contact list response was malformed')
    }
    const contacts = parsedContacts.data

    for (const contact of contacts.data) {
      if (contact.unsubscribed) {
        excludedEmails.add(normalizeEmail(contact.email))
      }
    }

    hasMore = contacts.has_more
    if (!hasMore) break
    after = contacts.data.at(-1)?.id ?? null
    if (!after) throw new Error('Resend contact pagination returned no cursor')
  }

  if (hasMore) {
    throw new Error('Resend contact list exceeded the pagination safety limit')
  }

  return excludedEmails
}

export async function createNewsletterSegment(
  name: string,
  options?: { signal?: AbortSignal }
): Promise<ResendSegmentResponse> {
  return resendRequest<ResendSegmentResponse>('/segments', {
    method: 'POST',
    body: { name },
    signal: options?.signal,
  })
}

export async function ensureNewsletterContactProperties(options?: {
  signal?: AbortSignal
}): Promise<void> {
  const existingKeys = new Set<string>()
  let after: string | null = null
  let hasMore = false

  for (let page = 0; page < RESEND_CONTACT_PROPERTY_MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(RESEND_CONTACT_PROPERTY_PAGE_LIMIT) })
    if (after) query.set('after', after)
    const response = await resendRequest<ResendContactPropertyListResponse>(
      `/contact-properties?${query.toString()}`,
      { signal: options?.signal }
    )

    for (const property of response.data ?? []) {
      if (property.key) existingKeys.add(property.key)
    }

    hasMore = response.has_more ?? false
    if (!hasMore) break

    after = response.data?.at(-1)?.id ?? null
    if (!after) throw new Error('Resend contact property pagination returned no cursor')
  }

  if (hasMore) {
    throw new Error('Resend contact property list exceeded the pagination safety limit')
  }

  await Promise.all(
    NEWSLETTER_CONTACT_PROPERTY_KEYS.filter((key) => !existingKeys.has(key)).map(async (key) => {
      try {
        await resendRequest('/contact-properties', {
          method: 'POST',
          body: { key, type: 'string' },
          signal: options?.signal,
        })
      } catch (error) {
        const message = getErrorMessage(error)
        if (!/already|exists|duplicate|conflict/i.test(message)) throw error
      }
    })
  )
}

function splitName(name: string | null): { firstName?: string; lastName?: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  return {
    firstName: parts[0],
    ...(parts.length > 1 ? { lastName: parts.slice(1).join(' ') } : {}),
  }
}

export async function createOrSegmentNewsletterContact(input: {
  email: string
  name: string | null
  userId: string | null
  runId: string
  segmentId: string
  signal?: AbortSignal
}): Promise<{ status: 'created' | 'updated' | 'segment_added'; contactId?: string }> {
  const email = normalizeEmail(input.email)
  const name = splitName(input.name)

  try {
    const contact = await resendRequest<ResendContactResponse>('/contacts', {
      method: 'POST',
      body: {
        email,
        first_name: name.firstName,
        last_name: name.lastName,
        properties: {
          sim_user_id: input.userId ?? '',
          newsletter_run_id: input.runId,
        },
        segments: [{ id: input.segmentId }],
      },
      signal: input.signal,
    })
    return { status: 'created', contactId: contact.id }
  } catch (error) {
    const message = getErrorMessage(error)
    if (!/already|exists|duplicate|conflict/i.test(message)) throw error
  }

  const contact = await resendRequest<ResendContactResponse>(
    `/contacts/${encodeURIComponent(email)}`,
    {
      method: 'PATCH',
      body: {
        properties: {
          sim_user_id: input.userId ?? '',
          newsletter_run_id: input.runId,
        },
      },
      signal: input.signal,
    }
  )
  await resendRequest(`/contacts/${encodeURIComponent(email)}/segments/${input.segmentId}`, {
    method: 'POST',
    signal: input.signal,
  })
  return { status: 'updated', contactId: contact.id }
}
