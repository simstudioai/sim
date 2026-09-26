import { toArray, toRecord } from '@sim/utils/object'
import { nativeText } from '@/lib/sim-search/live/dates'
import { NativeSearchError, string } from '@/lib/sim-search/live/http'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import { boundedMeetingContent } from '@/lib/sim-search/live/meeting-content'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

const MAX_MEETING_CONTENT = 200_000
const UTC_DAY_MS = 86_400_000

function requireMeetingId(id: string): string {
  if (!/^[\w-]{1,200}$/.test(id))
    throw new NativeSearchError('unavailable', 'Fireflies requires a valid meeting ID.')
  return id
}

function meetingDate(row: Record<string, unknown>): string | undefined {
  const raw = row.dateString ?? row.date
  const date = typeof raw === 'number' ? raw : Date.parse(string(raw))
  return Number.isFinite(date) && Number.isFinite(new Date(date).getTime())
    ? new Date(date).toISOString()
    : undefined
}

function readable(value: unknown, depth = 0): string {
  if (depth > 16) return '[Nested content omitted.]'
  if (typeof value === 'string') return value
  if (Array.isArray(value))
    return value
      .map((entry) => readable(entry, depth + 1))
      .filter(Boolean)
      .join('\n')
  return Object.entries(toRecord(value))
    .map(([key, entry]) => `${key.replaceAll('_', ' ')}: ${readable(entry, depth + 1)}`)
    .join('\n')
}

/** Stable Fireflies read tools return a labeled text envelope without a format argument. */
function textMeeting(value: unknown, section: 'Sentences' | 'Summary') {
  const text = string(toRecord(value).text)
  const id = text.match(/^Id: ([\w-]{1,200})\r?\n/)?.[1]
  const marker = `\n${section}: `
  const sectionStart = text.indexOf(marker)
  if (!id || sectionStart < 0) return undefined
  const metadataStart = section === 'Sentences' ? text.lastIndexOf('\nTitle: ') : -1
  if (section === 'Sentences' && metadataStart <= sectionStart) return undefined
  const header = text.slice(0, sectionStart)
  const metadata = metadataStart >= 0 ? text.slice(metadataStart + 1) : header
  const fields = new Map<string, string>(
    `${header}\n${metadata}`.split('\n').flatMap<[string, string]>((line) => {
      const separator = line.indexOf(': ')
      return separator >= 0 ? [[line.slice(0, separator), line.slice(separator + 2).trim()]] : []
    })
  )
  return {
    row: {
      id,
      title: fields.get('Title'),
      dateString: fields.get('DateString'),
      organizer_email: fields.get('Organizer Email') ?? fields.get('Host Email'),
      participants: (fields.get('Participants') ?? '').split(',').map((value) => value.trim()),
      is_live: fields.get('Is Live') === 'true',
    },
    content: text
      .slice(sectionStart + marker.length, metadataStart >= 0 ? metadataStart : undefined)
      .trim(),
  }
}

function meetingDocument(row: Record<string, unknown>): NativeDocument | undefined {
  const id = string(row.id ?? row.transcriptId)
  if (!/^[\w-]{1,200}$/.test(id)) return undefined
  const title = string(row.title) || 'Fireflies meeting'
  const date = meetingDate(row)
  const participants = toArray(row.participants).map(string).filter(Boolean).join(', ')
  return {
    id,
    kind: 'meeting',
    title,
    url: `https://app.fireflies.ai/view/${encodeURIComponent(id)}`,
    content: boundedMeetingContent(
      [
        title,
        date && `Meeting date: ${date}`,
        participants && `Participants: ${participants}`,
        readable(row.summary),
      ]
        .filter(Boolean)
        .join('\n\n'),
      MAX_MEETING_CONTENT
    ),
    eventStartAt: date,
    author: string(row.organizer_email ?? row.host_email ?? toRecord(row.user).email) || undefined,
  }
}

/** The stable MCP listing searches spoken sentences as well as titles; experimental search is unnecessary. */
export async function searchFirefliesMcp(
  client: ManagedSearchMcpClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const keyword = nativeText(input)
  if (keyword.length > 255)
    throw new NativeSearchError(
      'unavailable',
      'Fireflies search accepts at most 255 characters. Use concise words or a phrase.'
    )
  const cursor = input.native?.cursor
  if (cursor && !/^(?:0|[1-9]\d{0,6})$/.test(cursor))
    throw new NativeSearchError(
      'unavailable',
      'Fireflies cursor must be the returned numeric offset.'
    )
  const skip = cursor ? Number(cursor) : 0
  const limit = Math.min(49, Math.max(1, input.limit))
  const result = await client.call('fireflies_get_transcripts', {
    ...(keyword ? { keyword, scope: 'all' } : {}),
    format: 'json',
    limit: limit + 1,
    skip,
    ...(input.filters?.startDate
      ? {
          fromDate: new Date(
            Math.floor((Date.parse(input.filters.startDate) - 1) / UTC_DAY_MS) * UTC_DAY_MS
          )
            .toISOString()
            .slice(0, 10),
        }
      : {}),
    ...(input.filters?.endDate
      ? {
          toDate: new Date(Math.ceil(Date.parse(input.filters.endDate) / UTC_DAY_MS) * UTC_DAY_MS)
            .toISOString()
            .slice(0, 10),
        }
      : {}),
  })
  const data = toRecord(result)
  const rows = Array.isArray(result)
    ? result
    : (data.transcripts ?? toRecord(data.data).transcripts)
  if (!Array.isArray(rows))
    throw new NativeSearchError(
      'unavailable',
      'Fireflies returned an unsupported transcript list format.'
    )
  const documents = rows.slice(0, limit).flatMap((value) => {
    const document = meetingDocument(toRecord(value))
    return document ? [document] : []
  })
  return {
    documents,
    ...(rows.length > limit ? { nextCursor: String(skip + limit) } : {}),
    partial:
      documents.length < Math.min(rows.length, limit) ||
      Boolean(input.filters?.modifiedAfter || input.filters?.modifiedBefore),
    message:
      'Fireflies searches meeting titles and spoken transcript text. Results contain metadata and AI summaries; read a meeting for speaker-attributed transcript evidence. Dates refer to the meeting, not transcript modification. Continue full pages with the returned cursor.',
  }
}

/** Transcript identity is checked before summaries are attached to the same signed meeting reference. */
export async function readFirefliesMcp(
  client: ManagedSearchMcpClient,
  id: string
): Promise<NativeDocument> {
  requireMeetingId(id)
  const [transcriptResult, summaryResult] = await Promise.allSettled([
    client.call('fireflies_get_transcript', { transcriptId: id }),
    client.hasTool?.('fireflies_get_summary') === false
      ? Promise.resolve(undefined)
      : client.call('fireflies_get_summary', { transcriptId: id }),
  ])
  if (transcriptResult.status === 'rejected') throw transcriptResult.reason
  const result = toRecord(transcriptResult.value)
  const textTranscript = textMeeting(result, 'Sentences')
  const row: Record<string, unknown> = textTranscript
    ? textTranscript.row
    : toRecord(result.transcript ?? toRecord(result.data).transcript ?? result)
  if (string(row.id ?? row.transcriptId) !== id)
    throw new NativeSearchError('unavailable', 'Fireflies did not return the requested meeting.')
  const document = meetingDocument(row)!
  const speakers = new Map(
    toArray(row.speakers).map((value) => {
      const speaker = toRecord(value)
      return [string(speaker.id), string(speaker.name)]
    })
  )
  const sentences = toArray(row.sentences)
    .map((value) => {
      const sentence = toRecord(value)
      const seconds =
        typeof sentence.start_time === 'number' &&
        Number.isFinite(sentence.start_time) &&
        sentence.start_time >= 0
          ? Math.floor(sentence.start_time)
          : undefined
      const timestamp =
        seconds === undefined
          ? ''
          : `[${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}] `
      const speaker = string(sentence.speaker_name) || speakers.get(string(sentence.speaker_id))
      return `${timestamp}${speaker ? `${speaker}: ` : ''}${string(sentence.text ?? sentence.raw_text)}`
    })
    .filter(Boolean)
  let summary = ''
  if (summaryResult.status === 'rejected') {
    const error: unknown = summaryResult.reason
    if (!(error instanceof NativeSearchError) || error.status === 'reconnect') throw error
    summary = '[Summary unavailable; the transcript remains available.]'
  } else if (summaryResult.value !== undefined) {
    const result = toRecord(summaryResult.value)
    const textSummary = textMeeting(result, 'Summary')
    const metadata: Record<string, unknown> =
      textSummary?.row ?? toRecord(result.transcript ?? result.data ?? result)
    if (string(metadata.id ?? metadata.transcriptId) !== id) {
      summary = '[Summary unavailable; Fireflies did not verify the requested meeting identity.]'
    } else {
      summary = textSummary?.content ?? readable(metadata.summary)
    }
  }
  document.content = boundedMeetingContent(
    [
      boundedMeetingContent(document.content, 40_000),
      row.is_live === true &&
        'This is a snapshot of an ongoing meeting; additional speech may be missing.',
      textTranscript?.content || sentences.length
        ? `Transcript\n${textTranscript?.content || sentences.join('\n')}`
        : '[Fireflies returned no transcript sentences for this meeting.]',
      summary && `AI-generated meeting summary\n${summary}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    MAX_MEETING_CONTENT
  )
  return document
}
