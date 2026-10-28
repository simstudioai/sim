import { sha256Hex } from '@sim/security/hash'
import { isRecordLike } from '@sim/utils/object'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { dateSortDirection, nativeText } from '@/lib/sim-search/live/dates'
import { NativeSearchError, object } from '@/lib/sim-search/live/http'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

const MAX_CANDIDATES = 10
const MAX_CONTENT_BYTES = 512 * 1024
const MAX_TRANSCRIPT_ITEMS = 10_000

function invalid(message: string): never {
  throw new NativeSearchError('unavailable', message)
}

/** Numeric meeting numbers identify a recurring series, not the historical occurrence. */
function occurrence(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[A-Za-z0-9+/_=-]{8,128}$/.test(value) && !/^\d+$/.test(value)
  )
}

function citation(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192) return undefined
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      (url.hostname !== 'zoom.us' && !url.hostname.endsWith('.zoom.us')) ||
      url.username ||
      url.password ||
      url.port ||
      [...url.searchParams.keys()].some((key) =>
        /(?:pwd|passcode|password|token|signature|secret)/i.test(key)
      )
    )
      return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function metadata(row: Record<string, unknown>, id: string): NativeDocument | undefined {
  const url = citation(row.deep_url)
  if (
    row.meeting_uuid !== id ||
    row.meeting_category !== 'history' ||
    !url ||
    typeof row.topic !== 'string' ||
    Buffer.byteLength(row.topic, 'utf8') > 4096 ||
    typeof row.start_time !== 'string' ||
    !Number.isFinite(Date.parse(row.start_time))
  )
    return undefined
  return {
    id,
    kind: 'meeting',
    title: row.topic || 'Zoom meeting',
    url,
    eventStartAt: row.start_time,
    content:
      'Historical Zoom meeting. Read for available transcripts, AI summaries and personal notes.',
  }
}

async function assets(client: ManagedSearchMcpClient, id: string) {
  if (!occurrence(id))
    invalid('Zoom reads require a historical meeting UUID, not a meeting number.')
  // Zoom requires double encoding only for these ambiguous UUID path segments.
  const meetingId =
    id.startsWith('/') || id.includes('//') ? encodeURIComponent(encodeURIComponent(id)) : id
  return object(await client.call('get_meeting_assets', { meetingId }))
}

export async function searchZoomMcp(
  client: ManagedSearchMcpClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const query = nativeText(input)
  const filters = input.filters
  if (!query && !filters?.startDate && !filters?.endDate)
    invalid('Zoom requires search terms or meeting start-date bounds.')
  if (
    input.native?.project ||
    (input.native?.kind && input.native.kind !== 'meeting') ||
    input.native?.modifiers ||
    input.native?.termClauses?.length ||
    input.native?.keywordOnly ||
    filters?.modifiedAfter ||
    filters?.modifiedBefore
  )
    invalid(
      'Zoom supports plain terms, meeting kind and start dates; other selectors are unsupported.'
    )
  const limit = Math.max(1, Math.min(MAX_CANDIDATES, input.limit))
  const result = object(
    await client.call('search_meetings', {
      ...(query ? { q: query } : {}),
      page_size: limit,
      // Zoom does not specify endpoint inclusivity; exact start dates are checked after hydration.
      ...(filters?.startDate
        ? { from: new Date(Date.parse(filters.startDate) - 1000).toISOString() }
        : {}),
      ...(filters?.endDate ? { to: new Date(filters.endDate).toISOString() } : {}),
      ...(input.native?.cursor ? { next_page_token: input.native.cursor } : {}),
    })
  )
  if (!Array.isArray(result.meetings) || result.meetings.length > 300)
    invalid('Zoom returned an unsupported or oversized meeting page.')
  if (
    result.next_page_token !== undefined &&
    (typeof result.next_page_token !== 'string' || result.next_page_token.length > 2048)
  )
    invalid('Zoom returned an unsupported continuation token.')
  const candidates = new Set<string>()
  let dropped = false
  for (const row of result.meetings) {
    if (
      isRecordLike(row) &&
      ['scheduled_upcoming', 'schedule_expired'].includes(String(row.meeting_category))
    )
      continue
    if (!isRecordLike(row) || row.meeting_category !== 'history' || !occurrence(row.meeting_uuid)) {
      dropped = true
      continue
    }
    candidates.add(row.meeting_uuid)
  }
  const capped = candidates.size > limit
  const documents = await mapWithConcurrency([...candidates].slice(0, limit), 3, async (id) => {
    const row = await assets(client, id)
    const document = metadata(row, id)
    if (!document) {
      dropped = true
      return undefined
    }
    return { ...document, revision: sha256Hex(assetContent(row)) }
  })
  const nextCursor =
    !capped && typeof result.next_page_token === 'string'
      ? result.next_page_token || undefined
      : undefined
  const localSort = Boolean(dateSortDirection(filters))
  return {
    documents: documents.filter((document) => document !== undefined),
    ...(nextCursor ? { nextCursor } : {}),
    hasMore: capped,
    partial: dropped || capped || localSort,
    message:
      'Zoom searches provider-indexed meeting keywords and returns historical occurrences only. Previews are meeting metadata, not transcript evidence. Read an occurrence for the assets your account can access. Dates use actual meeting start time.' +
      (nextCursor
        ? ' Continue this exact query promptly; Zoom continuation tokens expire after 15 minutes.'
        : '') +
      (localSort
        ? ' Date sorting covers this retrieved page; continue all pages before making account-wide ordering claims.'
        : '') +
      (capped ? ' The candidate limit was reached; narrow the query.' : '') +
      (dropped ? ' Unsupported or no-longer-readable meeting metadata was excluded.' : ''),
  }
}

/** Only returned text is projected; recording links and linked documents are never fetched. */
function assetContent(row: Record<string, unknown>): string {
  const output: string[] = []
  let bytes = 0
  let transcriptItems = 0
  const append = (value: string) => {
    bytes += Buffer.byteLength(value, 'utf8') + (output.length ? 1 : 0)
    if (bytes > MAX_CONTENT_BYTES)
      invalid('Zoom meeting exceeds the complete text limit of 512 KiB. Open the meeting in Zoom.')
    output.push(value)
  }
  const text = (value: unknown): string => {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') invalid('Zoom returned unsupported meeting text.')
    return value
  }
  const section = (value: unknown): Record<string, unknown> => {
    if (value === undefined || value === null) return {}
    if (!isRecordLike(value)) invalid('Zoom returned an unsupported meeting asset.')
    return value
  }
  const list = (value: unknown, maximum: number): unknown[] => {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value) || value.length > maximum)
      invalid('Zoom meeting assets exceed the supported structure limit.')
    return value
  }
  const transcript = (value: unknown, label: string, recording = false) => {
    const source = section(value)
    const items = list(recording ? source.timeline : source.transcript_items, MAX_TRANSCRIPT_ITEMS)
    transcriptItems += items.length
    if (transcriptItems > MAX_TRANSCRIPT_ITEMS)
      invalid('Zoom meeting exceeds the transcript item limit.')
    if (!items.length) return
    append(`\n${label}${source.primary_language ? ` (${text(source.primary_language)})` : ''}`)
    for (const value of items) {
      const item = section(value)
      const start = recording ? item.ts : item.start
      const end = recording ? item.end_ts : item.end
      if (typeof item.text !== 'string' || typeof start !== 'string' || typeof end !== 'string')
        invalid('Zoom returned an incomplete transcript item.')
      append(`[${start} – ${end}] ${item.text}`)
    }
  }
  append(
    'Available Zoom meeting assets. This is not a guarantee of complete audio coverage. AI summaries are generated interpretations; transcripts and personal notes are separate sources. Linked recordings, documents and whiteboards are not fetched.'
  )
  transcript(row.meeting_transcript, 'Meeting transcript')
  const notes = section(row.my_notes)
  const noteText = text(notes.content_markdown)
  if (noteText) append(`\nPersonal notes\n${noteText}`)
  transcript(notes.transcript, 'Personal notes transcript')
  const summary = section(row.meeting_summary)
  if (summary.has_permission === true && summary.has_summary === true) {
    const complete = text(summary.summary_plain_text) || text(summary.summary_markdown)
    if (complete) append(`\nAI-generated meeting summary\n${complete}`)
    else {
      const detail = text(summary.summary) || text(summary.quick_recap)
      if (detail) append(`\nAI-generated meeting summary\n${detail}`)
      const steps = list(summary.next_steps, 1000)
      if (steps.length) append('\nAI-generated next steps')
      for (const step of steps) append(text(step))
    }
  } else append('\nMeeting summary is absent or not permitted for this account.')
  const recording = section(row.recording)
  if (recording.has_permission === true && recording.has_recording === true) {
    if (recording.processing === true)
      append('\nRecording assets are still processing and may be incomplete.')
    const segments = list(recording.transcripts, 200)
    for (const [index, segment] of segments.entries())
      transcript(segment, `Recording transcript segment ${index + 1}`, true)
    for (const value of list(recording.summaries, 200)) {
      const summary = section(value)
      const overview = text(summary.overall_summary)
      if (overview) append(`\nAI-generated recording summary\n${overview}`)
      for (const value of list(summary.items, 1000)) {
        const chapter = section(value)
        append(`AI-generated recording chapter: ${text(chapter.label)}\n${text(chapter.summary)}`)
      }
    }
  } else
    append('\nRecording transcripts and summaries are absent or not permitted for this account.')
  return output.join('\n')
}

export async function readZoomMcp(
  client: ManagedSearchMcpClient,
  id: string,
  expectedRevision?: string
): Promise<NativeDocument> {
  const row = await assets(client, id)
  const document = metadata(row, id)
  if (!document)
    invalid('Zoom meeting metadata is incomplete or does not match this historical occurrence.')
  const content = assetContent(row)
  const revision = sha256Hex(content)
  if (expectedRevision && expectedRevision !== revision)
    invalid('Zoom meeting content changed since this result. Search again before reading.')
  return { ...document, content, revision }
}
