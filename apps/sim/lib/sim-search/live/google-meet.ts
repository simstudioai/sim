import { sha256Hex } from '@sim/security/hash'
import { isRecordLike } from '@sim/utils/object'
import { nativeDateBounds, nativeText } from '@/lib/sim-search/live/dates'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'

const PART = '[A-Za-z0-9_-]{1,200}'
const CONFERENCE = new RegExp(`^conferenceRecords/${PART}$`)
const ARTIFACT = new RegExp(`^(conferenceRecords/${PART})/(transcripts|smartNotes)/${PART}$`)
const SPACE = new RegExp(`^spaces/${PART}$`)
const DOCUMENT = new RegExp(`^${PART}$`)
const MAX_CONTENT_BYTES = 512 * 1024
const MAX_SEARCH_CONFERENCES = 3
const MAX_SEARCH_ARTIFACTS = 5
const MAX_WORK = 24

interface Work {
  remaining: number
}
interface Conference {
  name: string
  space: string
  start: string
  end: string
}
interface Artifact {
  name: string
  kind: 'transcript' | 'smart_notes'
  start: string
  end: string
  document: string
  url: string
}

class MeetLimitError extends NativeSearchError {
  constructor(message: string) {
    super('unavailable', message)
  }
}
function invalid(message: string): never {
  throw new NativeSearchError('unavailable', message)
}
function instant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecordLike(value) || 'error' in value)
    invalid('Google Meet returned an unsupported response.')
  return value
}
function list(value: Record<string, unknown>, key: string): unknown[] {
  if (!(key in value)) return []
  if (!Array.isArray(value[key])) invalid('Google Meet returned an unsupported result list.')
  return value[key]
}
function continuation(value: Record<string, unknown>): string | undefined {
  if (value.nextPageToken === undefined || value.nextPageToken === '') return undefined
  if (typeof value.nextPageToken !== 'string' || value.nextPageToken.length > 2000)
    invalid('Google Meet returned an invalid continuation.')
  return value.nextPageToken
}
async function get(client: NativeClient, work: Work, path: string, query?: Record<string, string>) {
  if (work.remaining-- <= 0)
    throw new MeetLimitError(
      'Google Meet read work limit reached. Narrow the meeting dates or space.'
    )
  return record(await client.json(`/v2/${path}`, { query }))
}
function conference(value: unknown, expected?: string): Conference {
  const row = record(value)
  if (
    typeof row.name !== 'string' ||
    !CONFERENCE.test(row.name) ||
    (expected && row.name !== expected) ||
    typeof row.space !== 'string' ||
    !SPACE.test(row.space) ||
    !instant(row.startTime) ||
    !instant(row.endTime) ||
    Date.parse(row.endTime) < Date.parse(row.startTime)
  )
    invalid(
      'Google Meet conference identity or dates are incomplete. Only ended conferences can be read.'
    )
  return { name: row.name, space: row.space, start: row.startTime, end: row.endTime }
}
function artifact(value: unknown, expected: string): Artifact {
  const row = record(value)
  const match = ARTIFACT.exec(expected)
  if (
    !match ||
    row.name !== expected ||
    row.state !== 'FILE_GENERATED' ||
    !instant(row.startTime) ||
    !instant(row.endTime) ||
    Date.parse(row.endTime) < Date.parse(row.startTime)
  )
    invalid('Google Meet artifact is incomplete, changed, or not yet generated.')
  const destination = record(row.docsDestination)
  if (typeof destination.document !== 'string' || !DOCUMENT.test(destination.document))
    invalid('Google Meet omitted a valid source document citation.')
  const url = `https://docs.google.com/document/d/${destination.document}/view`
  if (destination.exportUri !== undefined) {
    let source: URL
    try {
      source = new URL(String(destination.exportUri))
    } catch {
      invalid('Google Meet returned an invalid source citation.')
    }
    if (
      source.origin !== 'https://docs.google.com' ||
      source.username ||
      source.password ||
      ![
        `/document/d/${destination.document}/edit`,
        `/document/d/${destination.document}/view`,
      ].includes(source.pathname.replace(/\/$/, ''))
    )
      invalid('Google Meet source citation does not match the transcript document.')
  }
  return {
    name: expected,
    kind: match[2] === 'transcripts' ? 'transcript' : 'smart_notes',
    start: row.startTime,
    end: row.endTime,
    document: destination.document,
    url,
  }
}
async function pages(
  client: NativeClient,
  work: Work,
  path: string,
  key: string,
  pageSize: number,
  maxPages: number,
  consume: (row: unknown) => void
) {
  let token: string | undefined
  const seen = new Set<string>()
  for (let page = 0; page < maxPages; page++) {
    const result = await get(client, work, path, {
      pageSize: String(pageSize),
      ...(token ? { pageToken: token } : {}),
    })
    const rows = list(result, key)
    if (rows.length > pageSize)
      throw new MeetLimitError('Google Meet response exceeded the complete-read row limit.')
    for (const row of rows) consume(row)
    token = continuation(result)
    if (!token) return
    if (seen.has(token))
      invalid('Google Meet repeated a continuation; complete coverage could not be verified.')
    seen.add(token)
  }
  throw new MeetLimitError(
    'Google Meet transcript or participant pagination exceeds the complete-read limit. Open the source document.'
  )
}
async function readArtifact(
  client: NativeClient,
  reference: Pick<NativeDocument, 'id' | 'kind' | 'revision'>,
  work: Work,
  existingConference?: Conference,
  existingArtifact?: Artifact
): Promise<{ document: NativeDocument; searchable: string }> {
  const match = ARTIFACT.exec(reference.id)
  if (!match) invalid('Invalid Google Meet artifact reference.')
  const parent = match[1]!
  const beforeConference = existingConference ?? conference(await get(client, work, parent), parent)
  if (beforeConference.name !== parent)
    invalid('Google Meet conference does not match its artifact.')
  const before = existingArtifact ?? artifact(await get(client, work, reference.id), reference.id)
  if (reference.kind && reference.kind !== before.kind)
    invalid('Google Meet artifact type changed.')
  const title = `Google Meet ${before.kind === 'transcript' ? 'transcript' : 'smart notes'} — ${beforeConference.start}`
  const sections = [
    `${title}\nConference: ${parent}\nSpace: ${beforeConference.space}\nMeeting started: ${beforeConference.start}\nMeeting ended: ${beforeConference.end}\nArtifact: ${before.name}\nSource: ${before.url}`,
    before.kind === 'transcript'
      ? 'Google Meet API transcription. It can differ from the Google Docs file after that file is edited. API entries are retained for 30 days after the meeting ends.'
      : 'Smart notes metadata only. The note body was not retrieved. Use authorized Google Drive search or read to inspect the cited document.',
  ]
  let bytes = Buffer.byteLength(sections.join('\n\n'), 'utf8')
  const searchTerms: string[] = []
  if (before.kind === 'transcript') {
    const speakers = new Map<string, string>()
    await pages(client, work, `${parent}/participants`, 'participants', 250, 2, (value) => {
      const row = record(value)
      if (
        typeof row.name !== 'string' ||
        !new RegExp(`^${parent}/participants/${PART}$`).test(row.name) ||
        speakers.has(row.name)
      )
        invalid('Google Meet returned an ambiguous participant identity.')
      const identities = [row.signedinUser, row.anonymousUser, row.phoneUser].filter(
        (value) => value !== undefined
      )
      if (identities.length > 1) invalid('Google Meet returned conflicting speaker identities.')
      const identity = identities.length ? record(identities[0]) : undefined
      const name = identity?.displayName
      if (name !== undefined && typeof name !== 'string')
        invalid('Google Meet returned an invalid speaker name.')
      speakers.set(
        row.name,
        typeof name === 'string' && name.trim() ? name : `Unresolved participant ${row.name}`
      )
    })
    const names = new Set<string>()
    let previousStart = Number.NEGATIVE_INFINITY
    await pages(client, work, `${before.name}/entries`, 'transcriptEntries', 100, 10, (value) => {
      const row = record(value)
      if (
        typeof row.name !== 'string' ||
        !new RegExp(`^${before.name}/entries/${PART}$`).test(row.name) ||
        names.has(row.name) ||
        typeof row.participant !== 'string' ||
        !new RegExp(`^${parent}/participants/${PART}$`).test(row.participant) ||
        typeof row.text !== 'string' ||
        !instant(row.startTime) ||
        !instant(row.endTime) ||
        Date.parse(row.endTime) < Date.parse(row.startTime) ||
        Date.parse(row.startTime) < previousStart ||
        (row.languageCode !== undefined && typeof row.languageCode !== 'string')
      )
        invalid('Google Meet returned malformed, duplicated, or misattributed transcript entries.')
      names.add(row.name)
      previousStart = Date.parse(row.startTime)
      const speaker = speakers.get(row.participant) ?? `Unresolved participant ${row.participant}`
      const section = `[${row.startTime} – ${row.endTime}] ${speaker}\nParticipant: ${row.participant}\nEntry: ${row.name}${row.languageCode ? `\nLanguage: ${row.languageCode}` : ''}\n${row.text}`
      bytes += 2 + Buffer.byteLength(section, 'utf8')
      if (bytes > MAX_CONTENT_BYTES)
        throw new MeetLimitError(
          'Google Meet transcript exceeds the 512 KiB complete-read limit. Open the source document.'
        )
      sections.push(section)
      searchTerms.push(speaker, row.text)
    })
    if (!names.size)
      invalid(
        'Google Meet returned no transcript entries. They may have expired; open the Google Docs source.'
      )
  }
  const afterConference = conference(await get(client, work, parent), parent)
  const after = artifact(await get(client, work, reference.id), reference.id)
  if (
    JSON.stringify(afterConference) !== JSON.stringify(beforeConference) ||
    JSON.stringify(after) !== JSON.stringify(before)
  )
    invalid('Google Meet source changed while reading. Search again before reading.')
  const content = sections.join('\n\n')
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES)
    throw new MeetLimitError('Google Meet content exceeds the 512 KiB complete-read limit.')
  const revision = sha256Hex(content)
  if (reference.revision && reference.revision !== revision)
    invalid('Google Meet transcript changed since this result. Search again before reading.')
  return {
    document: {
      id: before.name,
      kind: before.kind,
      title,
      url: before.url,
      container: parent,
      containerName: beforeConference.space,
      eventStartAt: beforeConference.start,
      revision,
      content,
    },
    searchable:
      before.kind === 'transcript'
        ? searchTerms.join('\n')
        : `${title}\n${before.name}\n${beforeConference.space}`,
  }
}

export async function readGoogleMeet(
  client: NativeClient,
  reference: Pick<NativeDocument, 'id' | 'kind' | 'revision'>
): Promise<NativeDocument> {
  return (await readArtifact(client, reference, { remaining: MAX_WORK })).document
}

export async function searchGoogleMeet(
  client: NativeClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const query = nativeText(input)
  if (input.filters?.modifiedAfter || input.filters?.modifiedBefore)
    invalid('Google Meet has no modification timestamp. Use meeting startDate and endDate filters.')
  if (
    [...query].length > 400 ||
    input.native?.cursor ||
    input.native?.modifiers ||
    input.native?.termClauses?.length ||
    input.native?.keywordOnly
  )
    invalid(
      'Google Meet accepts a literal phrase of at most 400 characters, without operators or continuation cursors.'
    )
  const kind = input.native?.kind
  if (kind && !['transcript', 'smart_notes'].includes(kind))
    invalid('Google Meet supports transcript and smart_notes kinds.')
  const filters: string[] = []
  const bounds = nativeDateBounds(input)
  if (bounds.start) filters.push(`start_time >= "${bounds.start}"`)
  if (bounds.end) filters.push(`start_time < "${bounds.end}"`)
  const project = input.native?.project
  if (project) {
    if (SPACE.test(project)) filters.push(`space.name = "${project}"`)
    else if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(project))
      filters.push(`space.meeting_code = "${project}"`)
    else
      invalid('Google Meet project must be a spaces/ID resource or an abc-defg-hij meeting code.')
  }
  const work = { remaining: MAX_WORK }
  const result = await get(client, work, 'conferenceRecords', {
    pageSize: String(MAX_SEARCH_CONFERENCES),
    ...(filters.length ? { filter: filters.join(' AND ') } : {}),
  })
  const meetings = list(result, 'conferenceRecords')
  let partial = Boolean(continuation(result)) || meetings.length > MAX_SEARCH_CONFERENCES
  let hydrated = 0
  const documents: NativeDocument[] = []
  const seen = new Set<string>()
  outer: for (const value of meetings.slice(0, MAX_SEARCH_CONFERENCES)) {
    if (isRecordLike(value) && !value.endTime) {
      partial = true
      continue
    }
    const meeting = conference(value)
    for (const collection of kind === 'transcript'
      ? ['transcripts']
      : kind === 'smart_notes'
        ? ['smartNotes']
        : ['transcripts', 'smartNotes']) {
      try {
        const page = await get(client, work, `${meeting.name}/${collection}`, { pageSize: '10' })
        const artifacts = list(page, collection)
        if (continuation(page) || artifacts.length > 10) partial = true
        for (const row of artifacts.slice(0, 10)) {
          if (
            !isRecordLike(row) ||
            typeof row.name !== 'string' ||
            !row.name.startsWith(`${meeting.name}/${collection}/`)
          )
            invalid('Google Meet returned an artifact from another conference.')
          if (row.state !== 'FILE_GENERATED') {
            partial = true
            continue
          }
          if (seen.has(row.name)) {
            partial = true
            continue
          }
          seen.add(row.name)
          if (hydrated >= MAX_SEARCH_ARTIFACTS) {
            partial = true
            break outer
          }
          hydrated++
          const source = artifact(row, row.name)
          const loaded = await readArtifact(client, { id: source.name }, work, meeting, source)
          if (!query || loaded.searchable.toLowerCase().includes(query.toLowerCase()))
            documents.push(loaded.document)
        }
      } catch (error) {
        if (!(error instanceof MeetLimitError)) throw error
        partial = true
        if (work.remaining <= 0) break outer
      }
    }
  }
  const limit = Math.max(1, Math.min(input.limit, MAX_SEARCH_ARTIFACTS))
  if (documents.length > limit) partial = true
  return {
    documents: documents.slice(0, limit),
    partial,
    hasMore: documents.length > limit,
    message:
      'Google Meet searches literal phrases locally in complete transcript entries and speaker names from at most 3 recent conferences and 5 generated artifacts. Conference records and API transcript entries expire 30 days after a meeting ends. Dates use meeting start time. Smart notes are metadata and Google Docs links only; search or read their bodies through Google Drive. No meeting titles, account-wide full-text search, or continuation are available.' +
      (partial
        ? ' Coverage is incomplete; narrow dates or a meeting space. Date ordering covers only examined meetings.'
        : ''),
  }
}
