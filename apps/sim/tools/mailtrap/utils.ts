import { getErrorMessage } from '@sim/utils/errors'
import type {
  MailtrapContact,
  MailtrapContactList,
  MailtrapSendingMessage,
} from '@/tools/mailtrap/types'

/** Represents a single email address in the Mailtrap payload. */
export interface MailtrapAddress {
  email: string
  name?: string
}

/**
 * Parses a single-address field (like `from`, `reply_to`). Returns the first address
 * when the value carries more than one, or `undefined` when it is empty/blank.
 */
export function parseAddress(value: string | undefined): MailtrapAddress | undefined {
  return parseAddressList(value)[0]
}

/** A bare address: one `@`, no whitespace or list/quote/bracket delimiters on either side. */
const BARE_EMAIL = /^[^\s"<>,@]+@[^\s"<>,@]+$/

/**
 * Splits a recipient string on top-level commas only. Throws when a quote or angle
 * bracket is left open.
 */
function splitAddressEntries(value: string): string[] {
  const entries: string[] = []
  let current = ''
  let inQuotes = false
  let inAngle = false

  for (let i = 0; i < value.length; i++) {
    const char = value[i]

    if (inQuotes && char === '\\' && i + 1 < value.length) {
      current += char + value[i + 1]
      i++
      continue
    }
    if (char === '"' && !inAngle) {
      inQuotes = !inQuotes
      current += char
    } else if (char === '<' && !inQuotes) {
      inAngle = true
      current += char
    } else if (char === '>' && !inQuotes) {
      inAngle = false
      current += char
    } else if (char === ',' && !inQuotes && !inAngle) {
      entries.push(current)
      current = ''
    } else {
      current += char
    }
  }
  entries.push(current)

  if (inQuotes || inAngle) {
    throw new Error('Recipient list has an unbalanced quote or angle bracket')
  }

  return entries
}

/**
 * Parses a comma-separated recipient string into Mailtrap address objects.
 * Each entry may be a bare address (`user@example.com`) or a named address in
 * the common `Display Name <user@example.com>` form.
 */
export function parseAddressList(value: string | undefined): MailtrapAddress[] {
  if (!value) return []

  const addresses: MailtrapAddress[] = []
  for (const raw of splitAddressEntries(value)) {
    const entry = raw.trim()
    if (!entry) continue

    const named = entry.match(/^\s*(.*?)\s*<\s*([^<>]+?)\s*>\s*$/)
    const email = (named ? named[2] : entry).trim()
    if (!BARE_EMAIL.test(email)) {
      throw new Error(`"${entry}" is not a valid email address`)
    }

    if (named) {
      const name = named[1].replace(/^["']|["']$/g, '').trim()
      addresses.push(name ? { email, name } : { email })
    } else {
      addresses.push({ email })
    }
  }

  return addresses
}

/**
 * Parses a comma-separated list of numeric ids (contact list ids) into an
 * integer array, dropping any entry that is not a finite number.
 */
export function parseIdList(value: string | undefined): number[] {
  if (!value) return []

  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
    .map((part) => Number(part))
}

/**
 * Coerces a tri-state boolean flag. Accepts a real boolean or the strings
 * `"true"` / `"false"`.
 */
export function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/**
 * Accepts a JSON string or an already-parsed value and returns a plain record.
 * Both paths run the same "must be a non-array object" check — a workflow `json`
 * param can resolve to an array from an upstream block, so the array is rejected
 * locally with a clear message instead of failing server-side.
 */
export function parseJsonRecord(
  value: unknown,
  fieldName: string
): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined

  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch (error) {
      throw new Error(`Invalid ${fieldName}: ${getErrorMessage(error)}`)
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${fieldName}: value is not a JSON object`)
  }
  return parsed as Record<string, unknown>
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0)
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** Maps a raw contact-list payload to the normalized {@link MailtrapContactList}. */
export function mapContactList(entry: unknown): MailtrapContactList {
  const data = asRecord(entry)
  return {
    id: typeof data.id === 'number' ? data.id : 0,
    name: typeof data.name === 'string' ? data.name : '',
  }
}

/** Maps a raw Contacts API `data` object to the normalized {@link MailtrapContact}. */
export function mapContact(entry: unknown): MailtrapContact {
  const data = asRecord(entry)
  return {
    id: String(data.id ?? ''),
    email: String(data.email ?? ''),
    fields: (data.fields as Record<string, unknown>) ?? {},
    listIds: Array.isArray(data.list_ids) ? (data.list_ids as number[]) : [],
    status: String(data.status ?? ''),
    createdAt: typeof data.created_at === 'number' ? data.created_at : 0,
    updatedAt: typeof data.updated_at === 'number' ? data.updated_at : 0,
  }
}

/** Maps a raw Email Logs message object to the normalized {@link MailtrapSendingMessage}. */
export function mapSendingMessage(entry: unknown): MailtrapSendingMessage {
  const data = asRecord(entry)
  return {
    messageId: String(data.message_id ?? ''),
    status: String(data.status ?? ''),
    subject: asString(data.subject),
    from: String(data.from ?? ''),
    to: String(data.to ?? ''),
    sentAt: String(data.sent_at ?? ''),
    clientIp: asString(data.client_ip),
    category: asString(data.category),
    customVariables: (data.custom_variables as Record<string, unknown>) ?? {},
    sendingStream: String(data.sending_stream ?? ''),
    domainId: asNumber(data.domain_id),
    templateId: typeof data.template_id === 'number' ? data.template_id : null,
    templateVariables: (data.template_variables as Record<string, unknown>) ?? {},
    opensCount: asNumber(data.opens_count),
    clicksCount: asNumber(data.clicks_count),
    rfcMessageId: asString(data.rfc_message_id),
    inReplyTo: asString(data.in_reply_to),
    references: Array.isArray(data.references) ? (data.references as string[]) : [],
    threadId: asString(data.thread_id),
  }
}

/** Parses a Mailtrap 2xx body, rejecting anything that is not well-formed JSON. */
function parseJsonResponse(text: string): unknown {
  if (!text.trim()) {
    throw new Error('Mailtrap returned an empty response body')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Mailtrap returned a non-JSON response body')
  }
}

/**
 * Reads a Mailtrap 2xx JSON object body. Every endpoint that calls this returns
 * a JSON object on success, so an empty, unparseable, or wrongly-shaped body
 * means the payload did not come from Mailtrap and is surfaced as a failure
 * rather than mapped into a fabricated empty record. Delete endpoints return
 * `204` and never call this.
 */
export async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  const parsed = parseJsonResponse(await response.text())
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Mailtrap returned an unexpected response shape (expected a JSON object)')
  }
  return parsed as Record<string, unknown>
}

/**
 * Reads a Mailtrap response whose body is a top-level JSON array (the contact
 * lists endpoint). Rejects an empty, unparseable, or non-array body so a
 * malformed payload fails instead of looking like an empty list.
 */
export async function readJsonArray(response: Response): Promise<unknown[]> {
  const parsed = parseJsonResponse(await response.text())
  if (!Array.isArray(parsed)) {
    throw new Error('Mailtrap returned an unexpected response shape (expected a JSON array)')
  }
  return parsed
}

/**
 * Asserts that a nested payload the caller depends on is present and is a plain
 * object. A well-formed JSON body that is missing its defining slice fails here instead of
 * being mapped into a fabricated empty record.
 */
export function expectRecord(value: unknown, description: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Mailtrap response did not include ${description}`)
  }
  return value as Record<string, unknown>
}

/** Asserts that a nested payload the caller iterates over is present and is an array. */
export function expectArray(value: unknown, description: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Mailtrap response did not include ${description}`)
  }
  return value
}

/**
 * Validates a Contacts Lists API payload (`{ id, name }`) and normalizes it.
 * The single-list endpoints require a numeric `id`; the list endpoint keeps the
 * lenient {@link mapContactList} for individual rows.
 */
export function expectContactList(data: Record<string, unknown>): MailtrapContactList {
  if (typeof data.id !== 'number') {
    throw new Error('Mailtrap response did not include a contact list id')
  }
  return mapContactList(data)
}

/**
 * Validates an Email Logs message payload and normalizes it. Requires a
 * `message_id` so an empty object is not mapped into a blank message.
 */
export function expectSendingMessage(data: Record<string, unknown>): MailtrapSendingMessage {
  if (typeof data.message_id !== 'string' || data.message_id.length === 0) {
    throw new Error('Mailtrap response did not include a message id')
  }
  return mapSendingMessage(data)
}
