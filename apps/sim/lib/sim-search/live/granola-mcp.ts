import { isRecordLike, toArray, toRecord } from '@sim/utils/object'
import { load } from 'cheerio'
import { nativeText } from '@/lib/sim-search/live/dates'
import { NativeSearchError, string } from '@/lib/sim-search/live/http'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import { boundedMeetingContent } from '@/lib/sim-search/live/meeting-content'
import { joinMessages } from '@/lib/sim-search/live/pages'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

const MEETING_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const MAX_CONTENT = 200_000
const SEARCH_LIMIT = 10
const MAX_MEETING_REFERENCES = 100

function requireMeetingId(id: string): string {
  if (!MEETING_ID.test(id))
    throw new NativeSearchError('unavailable', 'Granola requires a valid meeting ID.')
  return id.toLowerCase()
}

function idFromUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'notes.granola.ai' ||
      url.port ||
      url.username ||
      url.password
    )
      return undefined
    const id = url.pathname.match(/^\/d\/([\da-f-]+)\/?$/i)?.[1]
    return id && MEETING_ID.test(id) ? id.toLowerCase() : undefined
  } catch {
    return undefined
  }
}

function plainText(value: unknown, depth = 0): string {
  if (depth > 24) return '[Nested content omitted.]'
  if (typeof value === 'string') return value
  if (Array.isArray(value))
    return value
      .map((entry) => plainText(entry, depth + 1))
      .filter(Boolean)
      .join('\n')
  const node = toRecord(value)
  return string(node.text) || (node.content === undefined ? '' : plainText(node.content, depth + 1))
}

/** Only explicit meeting records are parsed; generated prose is never promoted into source notes. */
function meetingRows(value: unknown, depth = 0): Record<string, unknown>[] | undefined {
  if (depth > 8) return undefined
  if (Array.isArray(value)) return value.slice(0, MAX_MEETING_REFERENCES).map(toRecord)
  const object = toRecord(value)
  for (const key of ['meetings', 'results', 'documents']) {
    if (Array.isArray(object[key]))
      return toArray(object[key]).slice(0, MAX_MEETING_REFERENCES).map(toRecord)
  }
  if (object.data !== undefined) return meetingRows(object.data, depth + 1)
  if (MEETING_ID.test(string(object.id ?? object.meeting_id))) return [object]
  const text = string(object.text)
  if (!text.includes('<meeting') || /<!DOCTYPE|<!ENTITY/i.test(text)) return undefined
  if (text.length > 1_000_000)
    throw new NativeSearchError(
      'unavailable',
      'Granola meeting XML exceeded the search size limit. Narrow the query.'
    )
  let tags = 0
  for (const character of text) {
    if (character === '<' && ++tags > 20_000)
      throw new NativeSearchError(
        'unavailable',
        'Granola meeting XML exceeded the structural limit. Narrow the query.'
      )
  }
  const xml = load(text, { xml: true })
  return xml('meeting')
    .toArray()
    .slice(0, MAX_MEETING_REFERENCES)
    .flatMap((element) => {
      const node = xml(element)
      const id =
        node.attr('id') ?? node.attr('meeting_id') ?? node.children('id, meeting_id').first().text()
      if (!MEETING_ID.test(id)) return []
      return [
        {
          id,
          title: node.attr('title') ?? node.children('title').first().text(),
          date: node.attr('date') ?? node.children('date, start_time').first().text(),
          notes:
            node
              .children('notes, private_notes, summary, summary_notes, enhanced_notes, transcript')
              .map((_, content) => xml(content).text())
              .toArray()
              .join('\n\n') || node.text(),
        },
      ]
    })
}

function meetingDocument(row: Record<string, unknown>): NativeDocument | undefined {
  const rawId = string(row.id ?? row.meeting_id)
  if (!MEETING_ID.test(rawId)) return undefined
  const id = rawId.toLowerCase()
  const title = string(row.title) || 'Granola meeting'
  const rawDate = string(row.date ?? row.start_time ?? row.meeting_date)
  const date =
    rawDate && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : undefined
  const attendees = toArray(row.attendees ?? row.participants)
    .map((value) =>
      typeof value === 'string' ? value : string(toRecord(value).name ?? toRecord(value).email)
    )
    .filter(Boolean)
  const notes = [
    plainText(row.private_notes),
    plainText(row.notes),
    plainText(row.summary ?? row.summary_notes ?? row.enhanced_notes),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    id,
    kind: 'meeting',
    title,
    url: `https://notes.granola.ai/d/${id}`,
    eventStartAt: date,
    content: boundedMeetingContent(
      [
        title,
        date && `Meeting date: ${date}`,
        attendees.length && `Attendees: ${attendees.join(', ')}`,
        notes,
      ]
        .filter(Boolean)
        .join('\n\n'),
      MAX_CONTENT
    ),
  }
}

function citationIds(result: unknown): string[] {
  const ids = new Set<string>()
  const add = (value: unknown) => {
    if (ids.size >= MAX_MEETING_REFERENCES) return
    if (typeof value === 'string') {
      const urlId = idFromUrl(value)
      if (urlId) ids.add(urlId)
      return
    }
    const row = toRecord(value)
    const id = string(row.meeting_id ?? row.document_id ?? row.id)
    if (MEETING_ID.test(id)) ids.add(id.toLowerCase())
    const urlId = idFromUrl(row.url ?? row.link)
    if (urlId) ids.add(urlId)
  }
  const object = toRecord(result)
  for (const key of ['citations', 'sources', 'meetings', 'results', 'documents']) {
    for (const value of toArray(object[key]).slice(0, MAX_MEETING_REFERENCES)) add(value)
  }
  for (const row of meetingRows(result) ?? []) add(row)
  const text = typeof result === 'string' ? result : string(object.text ?? object.answer)
  for (const match of text.matchAll(/https:\/\/[^\s<>"'()[\]]+/g)) {
    add(match[0])
    if (ids.size >= MAX_MEETING_REFERENCES) break
  }
  for (const match of text.matchAll(
    /\bmeeting\s+(?:uuid|id)(?:\*\*)?\s*:\s*(?:\*\*)?\s*[`"']?([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\b/gi
  )) {
    add({ meeting_id: match[1] })
    if (ids.size >= MAX_MEETING_REFERENCES) break
  }
  return [...ids]
}

/** Semantic answers only locate IDs; every returned passage comes from a fresh meeting-notes read. */
export async function searchGranolaMcp(
  client: ManagedSearchMcpClient,
  input: NativeSearchInput
): Promise<NativePage> {
  if (input.native?.cursor)
    throw new NativeSearchError(
      'unavailable',
      'Granola does not expose a verified search cursor. Narrow the question or meeting dates.'
    )
  const query = nativeText(input)
  const limit = Math.min(SEARCH_LIMIT, Math.max(1, input.limit))
  const project = input.native?.project ? requireMeetingId(input.native.project) : undefined
  let ids: string[]
  let listingCoverage: string | undefined
  if (query) {
    if (project && client.hasArgument?.('query_granola_meetings', 'document_ids') === false)
      throw new NativeSearchError(
        'unavailable',
        'Granola does not currently support narrowing queries to meeting IDs.'
      )
    const scopedQuery = [
      query,
      input.filters?.startDate &&
        `Limit to meetings starting on or after ${input.filters.startDate}.`,
      input.filters?.endDate && `Limit to meetings starting before ${input.filters.endDate}.`,
      'Include each matching source meeting\'s exact UUID as "Meeting UUID: <UUID>", even when its original source URL is unavailable.',
    ]
      .filter(Boolean)
      .join('\n')
    const result = await client.call('query_granola_meetings', {
      query: scopedQuery,
      ...(project ? { document_ids: [project] } : {}),
    })
    ids = citationIds(result).filter((id) => !project || id === project)
  } else if (project) {
    ids = [project]
  } else {
    const args: Record<string, unknown> = {}
    const start = input.filters?.startDate
    const end = input.filters?.endDate
    if (
      (start || end) &&
      client.hasArgument?.('list_meetings', 'time_range') &&
      client.hasArgument?.('list_meetings', 'custom_start') &&
      client.hasArgument?.('list_meetings', 'custom_end')
    ) {
      args.time_range = 'custom'
      args.custom_start = start ? new Date(start).toISOString() : '1970-01-01T00:00:00.000Z'
      args.custom_end = end ? new Date(end).toISOString() : new Date().toISOString()
    } else if (client.hasArgument?.('list_meetings', 'time_range') !== false) {
      args.time_range = 'last_30_days'
      listingCoverage =
        'This Granola listing covers only the last 30 days. Date filters apply within that window; use a focused question to look for older meetings, subject to your plan and access.'
    } else {
      listingCoverage =
        'Granola uses its default listing window. Date filters apply to returned meetings; use a focused question to look for older meetings, subject to your plan and access.'
    }
    const result = await client.call('list_meetings', args)
    const rows = meetingRows(result)
    if (!rows)
      throw new NativeSearchError(
        'unavailable',
        'Granola returned an unsupported meeting listing format.'
      )
    ids = [
      ...new Set(
        rows
          .map((row) => string(row.id ?? row.meeting_id))
          .filter((id) => MEETING_ID.test(id))
          .map((id) => id.toLowerCase())
      ),
    ]
  }
  if (!ids.length)
    return {
      documents: [],
      partial: true,
      message: joinMessages([
        'Granola returned no verifiable meeting references. Generated answers are not source evidence. Try a more specific question or meeting-date range.',
        listingCoverage,
      ]),
    }
  const requested = ids.slice(0, limit)
  const result = await client.call('get_meetings', { meeting_ids: requested })
  const rows = meetingRows(result)
  if (!rows)
    throw new NativeSearchError(
      'unavailable',
      'Granola returned an unsupported meeting notes format.'
    )
  const byId = new Map(
    rows.flatMap((row) => {
      const document = meetingDocument(row)
      return document && requested.includes(document.id) ? [[document.id, document] as const] : []
    })
  )
  return {
    documents: requested.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    partial: true,
    message: joinMessages([
      'Granola returns a bounded selection of meeting notes from its active workspace. Semantic search is not exhaustive. Source passages come from fetched notes, which can include AI summaries; read the transcript before quoting spoken words. Plan and workspace settings can limit access. Narrow the question or dates for more coverage.',
      listingCoverage,
    ]),
  }
}

export async function readGranolaMcp(
  client: ManagedSearchMcpClient,
  id: string
): Promise<NativeDocument> {
  id = requireMeetingId(id)
  const result = await client.call('get_meetings', { meeting_ids: [id] })
  const row = meetingRows(result)?.find(
    (row) => string(row.id ?? row.meeting_id).toLowerCase() === id
  )
  if (!row)
    throw new NativeSearchError('unavailable', 'Granola did not return the requested meeting.')
  const document = meetingDocument(row)!
  let transcript =
    '[Transcript unavailable for this account or workspace; these notes may contain AI-generated summaries.]'
  if (client.hasTool?.('get_meeting_transcript') !== false) {
    try {
      const result = await client.call('get_meeting_transcript', { meeting_id: id })
      const payload = toRecord(result)
      const returnedId = string(payload.meeting_id ?? payload.id)
      if (returnedId && returnedId.toLowerCase() !== id)
        throw new NativeSearchError(
          'unavailable',
          'Granola returned a different meeting transcript.'
        )
      const value = payload.transcript ?? payload.text ?? result
      const content =
        typeof value === 'string'
          ? value
          : Array.isArray(value) || isRecordLike(value)
            ? JSON.stringify(value)
            : ''
      if (content) transcript = `Transcript\n${content}`
    } catch (error) {
      if (!(error instanceof NativeSearchError) || error.status === 'reconnect') throw error
    }
  }
  document.content = boundedMeetingContent(
    `${boundedMeetingContent(document.content, 40_000)}\n\n${transcript}`,
    MAX_CONTENT
  )
  return document
}
