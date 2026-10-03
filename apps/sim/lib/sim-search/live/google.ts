import { toArray } from '@sim/utils/object'
import { compareStrings, truncate } from '@sim/utils/string'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { zonedWallClockToUtc } from '@/lib/core/utils/timezone'
import {
  dateSortDirection,
  hasDateBounds,
  nativeDateBounds,
  nativeText,
} from '@/lib/sim-search/live/dates'
import { readDiscussionSection } from '@/lib/sim-search/live/discussion'
import { readDriveFileContent } from '@/lib/sim-search/live/drive-content'
import { array, NativeSearchError, object, segment, string } from '@/lib/sim-search/live/http'
import { interleaveByRank } from '@/lib/sim-search/live/pages'
import { permitsResources } from '@/lib/sim-search/live/policy'
import { providerText } from '@/lib/sim-search/live/text'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
  NativeReadOptions,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'

const DRIVE_FIELDS =
  'id,name,mimeType,webViewLink,description,modifiedTime,owners(displayName,emailAddress)'
export const escapeDriveLiteral = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

function driveDocument(row: Record<string, unknown>): NativeDocument {
  return {
    id: string(row.id),
    kind: string(row.mimeType),
    title: string(row.name),
    url:
      string(row.webViewLink) || `https://drive.google.com/file/d/${segment(string(row.id))}/view`,
    content: string(row.description) || string(row.name),
    modifiedAt: string(row.modifiedTime),
    author: array(row.owners)
      .map((owner) => string(owner.displayName) || string(owner.emailAddress))
      .join(', '),
  }
}

export async function searchDrive(
  client: NativeClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const text = nativeText(input)
  const query =
    input.native?.query ||
    (text ? `fullText contains '${escapeDriveLiteral(text)}'` : 'trashed = false')
  const dates = nativeDateBounds(input)
  const data = object(
    await client.json('/drive/v3/files', {
      query: {
        q: [
          `trashed = false and (${query})`,
          ...(dates.start ? [`modifiedTime >= '${dates.start}'`] : []),
          ...(dates.end ? [`modifiedTime <= '${dates.end}'`] : []),
        ].join(' and '),
        ...(dateSortDirection(input.filters)
          ? {
              orderBy: `modifiedTime${dateSortDirection(input.filters) === 'asc' ? '' : ' desc'}`,
            }
          : {}),
        fields: `nextPageToken,incompleteSearch,files(${DRIVE_FIELDS})`,
        pageSize: String(input.limit),
        spaces: 'drive',
        ...(input.native?.project?.startsWith('drive:')
          ? { corpora: 'drive', driveId: input.native.project.slice(6) }
          : {}),
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        ...(input.native?.cursor ? { pageToken: input.native.cursor } : {}),
      },
    })
  )
  return {
    documents: array(data.files).map(driveDocument),
    nextCursor: string(data.nextPageToken) || undefined,
    partial: data.incompleteSearch === true,
    message:
      'Drive searches file names and full text, including Docs, Sheets and Slides. Previews are file metadata; read a result for its content.',
  }
}

export async function readDrive(
  client: NativeClient,
  id: string,
  signal?: AbortSignal
): Promise<NativeDocument> {
  const row = object(
    await client.json(`/drive/v3/files/${segment(id)}`, {
      query: {
        fields: `${DRIVE_FIELDS},size,capabilities(canDownload)`,
        supportsAllDrives: 'true',
      },
    })
  )
  const document = driveDocument(row)
  if (
    document.kind === 'application/vnd.google-apps.document' ||
    document.kind === 'application/vnd.google-apps.presentation'
  ) {
    document.content = await client.text(`/drive/v3/files/${segment(id)}/export`, {
      mimeType: 'text/plain',
    })
  } else if (document.kind === 'application/vnd.google-apps.spreadsheet') {
    const metadata = object(
      await client.json(`/v4/spreadsheets/${segment(id)}`, {
        googleService: 'sheets',
        query: { fields: 'sheets.properties.title' },
      })
    )
    const titles = array(metadata.sheets).map((sheet) => string(object(sheet.properties).title))
    const values = object(
      await client.json(`/v4/spreadsheets/${segment(id)}/values:batchGet`, {
        googleService: 'sheets',
        query: {
          ranges: titles.slice(0, 20).map((title) => `'${title.replace(/'/g, "''")}'!A1:AZ1000`),
          valueRenderOption: 'FORMATTED_VALUE',
        },
      })
    )
    document.content =
      'Spreadsheet values (up to 20 sheets, first 1,000 rows and 52 columns each; formulas are shown as formatted values):\n' +
      array(values.valueRanges)
        .map((range) => `${string(range.range)}\n${JSON.stringify(range.values ?? [])}`)
        .join('\n\n')
  } else if (
    document.kind === 'application/pdf' ||
    document.kind === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    document.content = await readDriveFileContent(client, id, row, signal)
  } else if (document.kind?.startsWith('text/') || document.kind === 'application/json') {
    document.content = await client.text(`/drive/v3/files/${segment(id)}`, {
      alt: 'media',
      supportsAllDrives: 'true',
    })
  } else {
    document.content = `File metadata only. Open the source to read this ${document.kind} file.\n${document.content}`
  }
  const discussion = await readDriveDiscussion(client, id)
  document.content = [
    discussion.warning,
    document.content,
    `Source: ${document.url}`,
    discussion.content,
  ]
    .filter(Boolean)
    .join('\n\n')
  return document
}

/** Drive returns the complete chronological reply list on each comment resource. */
const DRIVE_COMMENT_FIELDS =
  'id,content,createdTime,modifiedTime,resolved,deleted,author(displayName),quotedFileContent(value),replies(id,content,createdTime,modifiedTime,deleted,action,author(displayName))'

function* driveDiscussionEntries(comments: Record<string, unknown>[]): Generator<string> {
  for (const comment of comments) {
    if (comment.deleted === true) continue
    yield [
      `Comment ${string(comment.id)} · ${comment.resolved === true ? 'resolved' : 'unresolved'}`,
      `${string(object(comment.author).displayName) || 'Unknown author'} · ${string(comment.createdTime)}`,
      string(comment.modifiedTime) && comment.modifiedTime !== comment.createdTime
        ? `Updated: ${string(comment.modifiedTime)}`
        : '',
      string(object(comment.quotedFileContent).value)
        ? `Quoted file content: ${string(object(comment.quotedFileContent).value)}`
        : '',
      string(comment.content),
    ]
      .filter(Boolean)
      .join('\n')
    for (const reply of array(comment.replies)) {
      if (reply.deleted === true) continue
      yield [
        `Reply ${string(reply.id)} to comment ${string(comment.id)}`,
        `${string(object(reply.author).displayName) || 'Unknown author'} · ${string(reply.createdTime)}`,
        string(reply.modifiedTime) && reply.modifiedTime !== reply.createdTime
          ? `Updated: ${string(reply.modifiedTime)}`
          : '',
        string(reply.action) ? `Action: ${string(reply.action)}` : '',
        string(reply.content),
      ]
        .filter(Boolean)
        .join('\n')
    }
  }
}

function readDriveDiscussion(client: NativeClient, id: string) {
  return readDiscussionSection('Drive comments and replies', async (cursor) => {
    const data = object(
      await client.json(`/drive/v3/files/${segment(id)}/comments`, {
        query: {
          fields: `nextPageToken,comments(${DRIVE_COMMENT_FIELDS})`,
          pageSize: '20',
          includeDeleted: 'false',
          ...(cursor ? { pageToken: cursor } : {}),
        },
      })
    )
    return {
      entries: driveDiscussionEntries(array(data.comments)),
      nextCursor: string(data.nextPageToken) || undefined,
    }
  })
}

/** One metadata read per match, bounded so a page stays within Gmail's per-user rate. */
const GMAIL_METADATA_CONCURRENCY = 10
/** Only the fields a result uses; labels double as member-policy evidence. */
const GMAIL_METADATA_FIELDS = 'id,labelIds,snippet,internalDate,payload/headers'

function gmailDocument(row: Record<string, unknown>): NativeDocument {
  const payload = object(row.payload)
  const headers = array(payload.headers)
  const header = (name: string) =>
    string(headers.find((h) => string(h.name).toLowerCase() === name)?.value)
  const timestamp = Number(row.internalDate)
  return {
    ...(Array.isArray(row.labelIds)
      ? { accessMetadata: { id: row.id, labelIds: row.labelIds } }
      : {}),
    id: string(row.id),
    title: header('subject') || '(No subject)',
    url: `https://mail.google.com/mail/u/0/#all/${segment(string(row.id))}`,
    content: providerText(string(row.snippet), 'escaped'),
    author: header('from'),
    ...(Number.isFinite(timestamp) && timestamp > 0
      ? { modifiedAt: new Date(timestamp).toISOString() }
      : {}),
  }
}

export async function searchGmail(
  client: NativeClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const dates = nativeDateBounds(input)
  const text = nativeText(input)
  const query = [
    text ? (dates.start || dates.end ? `(${text})` : text) : '',
    dates.start ? `after:${Math.floor(Date.parse(dates.start) / 1000) - 1}` : '',
    dates.end ? `before:${Math.ceil(Date.parse(dates.end) / 1000) + 1}` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const data = object(
    await client.json('/gmail/v1/users/me/messages', {
      query: {
        q: query,
        maxResults: String(Math.min(input.limit, 20)),
        ...(input.native?.cursor ? { pageToken: input.native.cursor } : {}),
      },
    })
  )
  const documents = await mapWithConcurrency(
    array(data.messages),
    GMAIL_METADATA_CONCURRENCY,
    async (message) =>
      gmailDocument(
        object(
          await client.json(`/gmail/v1/users/me/messages/${segment(string(message.id))}`, {
            query: {
              format: 'metadata',
              metadataHeaders: ['Subject', 'From'],
              fields: GMAIL_METADATA_FIELDS,
            },
          })
        )
      )
  )
  return {
    documents,
    nextCursor: string(data.nextPageToken) || undefined,
    message:
      'Gmail uses message search operators. The API does not perform the Gmail UI’s alias expansion or thread-wide matching.',
  }
}

/** The response byte cap does not bound recursive MIME depth or per-part processing work. */
const GMAIL_MIME_DEPTH_LIMIT = 32
const GMAIL_MIME_PART_LIMIT = 256

interface GmailBodyText {
  text: string
  incomplete: boolean
  plain: boolean
}

/** Selects one available alternative, preserves mixed body sections, and omits file attachments. */
function mailText(value: unknown): GmailBodyText {
  let remainingParts = GMAIL_MIME_PART_LIMIT
  const bounded = (text: string, incomplete: boolean, plain: boolean): GmailBodyText => ({
    text: truncate(text, GMAIL_MESSAGE_CHARACTER_LIMIT),
    incomplete: incomplete || text.length > GMAIL_MESSAGE_CHARACTER_LIMIT,
    plain,
  })
  const visit = (value: unknown, depth: number): GmailBodyText => {
    if (remainingParts === 0) return { text: '', incomplete: true, plain: false }
    remainingParts--
    if (depth >= GMAIL_MIME_DEPTH_LIMIT) return { text: '', incomplete: true, plain: false }
    const part = object(value)
    if (string(part.filename)) return { text: '', incomplete: false, plain: false }
    const mimeType = string(part.mimeType).toLowerCase()
    if (mimeType === 'text/plain' || mimeType === 'text/html') {
      const body = object(part.body)
      const encoded = string(body.data)
      return bounded(
        encoded
          ? providerText(
              Buffer.from(encoded, 'base64url').toString('utf8'),
              mimeType === 'text/plain' ? 'plain' : 'html'
            )
          : '',
        !encoded && (Boolean(body.attachmentId) || Number(body.size) > 0),
        mimeType === 'text/plain'
      )
    }
    const children: GmailBodyText[] = []
    let incomplete = false
    for (const child of toArray(part.parts)) {
      if (remainingParts === 0) {
        incomplete = true
        break
      }
      children.push(visit(child, depth + 1))
    }
    if (mimeType === 'multipart/alternative') {
      const selected =
        children.find((child) => child.text && child.plain) ?? children.find((child) => child.text)
      if (selected) return { ...selected, incomplete: selected.incomplete || incomplete }
    }
    return bounded(
      children
        .map((child) => child.text)
        .filter(Boolean)
        .join('\n'),
      incomplete || children.some((child) => child.incomplete),
      children.some((child) => child.text && child.plain)
    )
  }
  return visit(value, 0)
}

/** Eight messages leave room for fresh per-message scope checks in the member request budget. */
const GMAIL_CONVERSATION_MESSAGE_LIMIT = 8
/** Per-message bounds retain the anchor even when earlier messages contain large bodies. */
const GMAIL_MESSAGE_CHARACTER_LIMIT = 24_000

/**
 * The application has authorized the anchor. Thread discovery returns metadata only; each
 * sibling is authorized before its body is fetched and retained for the final fresh check.
 */
export async function readGmail(
  client: NativeClient,
  id: string,
  options: NativeReadOptions
): Promise<NativeDocument> {
  options.signal.throwIfAborted()
  const anchor = object(
    await client.json(`/gmail/v1/users/me/messages/${segment(id)}`, { query: { format: 'full' } })
  )
  const threadId = string(anchor.threadId)
  if (
    anchor.id !== id ||
    typeof anchor.threadId !== 'string' ||
    !threadId ||
    threadId.length > 1000
  )
    throw new NativeSearchError('unavailable', 'Gmail returned inconsistent message identity.')
  const thread = object(
    await client.json(`/gmail/v1/users/me/threads/${segment(threadId)}`, {
      query: {
        format: 'metadata',
        fields: 'id,messages(id,threadId,labelIds,internalDate)',
      },
    })
  )
  if (thread.id !== threadId || !Array.isArray(thread.messages))
    throw new NativeSearchError('unavailable', 'Gmail returned inconsistent conversation identity.')
  const members = new Map<string, Record<string, unknown>>()
  for (const value of thread.messages) {
    const row = object(value)
    if (typeof row.id !== 'string' || !row.id || row.id.length > 1000 || row.threadId !== threadId)
      throw new NativeSearchError(
        'unavailable',
        'Gmail returned inconsistent conversation membership.'
      )
    if (!members.has(row.id)) members.set(row.id, row)
  }
  if (!members.has(id))
    throw new NativeSearchError(
      'unavailable',
      'The requested message is missing from its conversation.'
    )
  const latest = [...members.values()]
    .filter((row) => row.id !== id)
    .sort(
      (left, right) =>
        (Number(right.internalDate) || 0) - (Number(left.internalDate) || 0) ||
        compareStrings(string(left.id), string(right.id))
    )
    .slice(0, GMAIL_CONVERSATION_MESSAGE_LIMIT - 1)
  const warnings = new Set<string>()
  if (members.size > GMAIL_CONVERSATION_MESSAGE_LIMIT)
    warnings.add('only the requested message and up to seven recent messages are included')
  const documents: NativeDocument[] = []
  const append = (row: Record<string, unknown>) => {
    const document = gmailDocument(row)
    const body = mailText(row.payload)
    if (body.incomplete) warnings.add('some message body content could not be read')
    if (!body.text && document.content) warnings.add('some messages contain previews only')
    const content = [
      `## Message ${document.id}`,
      `From: ${truncate(document.author || 'Unknown sender', 1000)}`,
      `Date: ${document.modifiedAt || 'Unknown date'}`,
      `Subject: ${truncate(document.title, 1000)}`,
      `Source: ${document.url}`,
      '',
      body.text ||
        (document.content
          ? `Preview only: ${document.content}`
          : 'No inline message body available.'),
    ].join('\n')
    if (content.length > GMAIL_MESSAGE_CHARACTER_LIMIT) warnings.add('message text was truncated')
    document.content = truncate(content, GMAIL_MESSAGE_CHARACTER_LIMIT)
    documents.push(document)
    return document
  }
  const document = append(anchor)
  for (const candidate of latest) {
    options.signal.throwIfAborted()
    const candidateId = string(candidate.id)
    let row: Record<string, unknown>
    try {
      if (
        !(await options.verify({
          id: candidateId,
          accessMetadata: { id: candidateId, labelIds: candidate.labelIds },
        }))
      ) {
        warnings.add('messages outside the source search scope were omitted')
        continue
      }
      row = object(
        await client.json(`/gmail/v1/users/me/messages/${segment(candidateId)}`, {
          query: { format: 'full' },
        })
      )
    } catch (error) {
      options.signal.throwIfAborted()
      if (error instanceof NativeSearchError && error.httpStatus === 404) {
        warnings.add('some messages are no longer available')
        continue
      }
      throw error
    }
    if (row.id !== candidateId || row.threadId !== threadId)
      throw new NativeSearchError(
        'unavailable',
        'Gmail returned inconsistent conversation membership.'
      )
    append(row)
  }
  options.signal.throwIfAborted()
  documents.sort(
    (left, right) =>
      (Date.parse(left.modifiedAt ?? '') || 0) - (Date.parse(right.modifiedAt ?? '') || 0) ||
      compareStrings(left.id, right.id)
  )
  return {
    ...document,
    accessDependencies: documents
      .filter((entry) => entry.id !== id)
      .map((entry) => ({ id: entry.id })),
    content: [
      ...(warnings.size
        ? [
            `Coverage incomplete: ${[...warnings].join('; ')}. Open Gmail for the remaining context.`,
          ]
        : []),
      ...documents.map((entry) => entry.content),
    ].join('\n\n'),
  }
}

function eventDocument(
  row: Record<string, unknown>,
  calendarId: string,
  includeAttendees = true,
  calendarTimeZone?: string
): NativeDocument {
  const start = object(row.start)
  const zone = string(start.timeZone) || calendarTimeZone
  const eventStartAt =
    string(start.dateTime) ||
    (string(start.date) && zone
      ? zonedWallClockToUtc(`${string(start.date)}T00:00:00`, zone).toISOString()
      : undefined)
  return {
    id: string(row.id),
    container: calendarId,
    title: string(row.summary) || '(Untitled event)',
    url: string(row.htmlLink),
    content: [
      string(row.summary),
      providerText(string(row.description), 'auto'),
      string(row.location),
      `Start: ${string(object(row.start).dateTime) || string(object(row.start).date)}`,
      `End: ${string(object(row.end).dateTime) || string(object(row.end).date)}`,
      ...(includeAttendees
        ? array(row.attendees).map((a) => string(a.email))
        : [`Attendees: ${array(row.attendees).length}`]),
    ]
      .filter(Boolean)
      .join('\n'),
    eventStartAt,
    modifiedAt: string(row.updated),
    author: string(object(row.organizer).email),
  }
}

/**
 * A shared meeting appears once in every attendee calendar the member can see. Its iCalendar
 * UID and start instant identify the occurrence across calendars, which may report the start in
 * their own time zones; a modified recurring instance stays distinct from its series.
 */
function calendarOccurrenceKey(row: Record<string, unknown>): string {
  const start = object(row.originalStartTime ?? row.start)
  const instant = Date.parse(string(start.dateTime))
  return JSON.stringify([
    string(row.iCalUID) || string(row.id),
    row.recurringEventId ? 'instance' : 'event',
    Number.isFinite(instant) ? instant : string(start.date),
  ])
}

/** Events without a resolvable start sort after every scheduled one. */
function eventStartTime(document: NativeDocument): number {
  const time = Date.parse(document.eventStartAt ?? '')
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER
}

export async function searchCalendar(
  client: NativeClient,
  input: NativeSearchInput
): Promise<NativePage> {
  // Native project names a calendar ID. Without one, query the user's calendar list.
  const calendars = input.native?.project
    ? { items: [{ id: input.native.project }] }
    : object(
        await client.json('/calendar/v3/users/me/calendarList', { query: { maxResults: '20' } })
      )
  const rows = array(calendars.items)
    .filter(
      (row) =>
        !input.policy ||
        permitsResources(input.policy, [
          string(row.id),
          ...(row.primary === true ? ['primary'] : []),
        ])
    )
    .slice(0, 20)
    .sort((left, right) => Number(right.primary === true) - Number(left.primary === true))
  const chronological = hasDateBounds(input.filters) || Boolean(dateSortDirection(input.filters))
  const pages = await mapWithConcurrency(rows, 4, async (row) => {
    const calendarId = string(row.id)
    try {
      const data = object(
        await client.json(`/calendar/v3/calendars/${segment(calendarId)}/events`, {
          query: {
            ...(nativeText(input) ? { q: nativeText(input) } : {}),
            ...(input.filters?.startDate
              ? {
                  timeMin: new Date(
                    Math.floor(Date.parse(input.filters.startDate) / 1000) * 1000 - 1000
                  ).toISOString(),
                }
              : {}),
            ...(input.filters?.endDate
              ? {
                  timeMax: new Date(
                    Math.ceil(Date.parse(input.filters.endDate) / 1000) * 1000
                  ).toISOString(),
                }
              : {}),
            ...(input.filters?.modifiedAfter ? { updatedMin: input.filters.modifiedAfter } : {}),
            ...(chronological ? { singleEvents: 'true', orderBy: 'startTime' } : {}),
            maxResults: String(input.limit),
            showDeleted: 'false',
            ...(input.native?.cursor && input.native.project
              ? { pageToken: input.native.cursor }
              : {}),
          },
        })
      )
      return { data, calendarId, timeZone: string(data.timeZone) || string(row.timeZone) }
    } catch (error) {
      if (input.native?.project) throw error
      return null
    }
  })
  const searched = pages.filter((page) => page !== null)
  if (rows.length > 0 && searched.length === 0)
    throw new NativeSearchError(
      'unavailable',
      'None of the calendars could be searched. Check calendar permissions.'
    )
  const perCalendar = searched.map(({ data, calendarId, timeZone }) =>
    array(data.items)
      .filter((event) => event.status !== 'cancelled')
      .map((event) => ({
        ...eventDocument(event, calendarId, input.policy?.includeAttendees, timeZone),
        dedupeKey: calendarOccurrenceKey(event),
      }))
  )
  const documents = chronological
    ? perCalendar.flat().sort((left, right) => eventStartTime(left) - eventStartTime(right))
    : interleaveByRank(perCalendar)
  const single = input.native?.project ? searched[0] : undefined
  return {
    documents,
    partial: Boolean(calendars.nextPageToken) || searched.length < rows.length,
    hasMore: searched.some(({ data }) => Boolean(data.nextPageToken)),
    nextCursor: single ? string(single.data.nextPageToken) || undefined : undefined,
    message:
      'Calendar supports text and date-only searches across up to 20 calendars. startDate/endDate filter scheduled starts; recurring events expand within the window. sourceDate is scheduled start and sourceModifiedAt is last edit. Use project = calendar ID to paginate; reverse ordering is limited to the fetched page.',
  }
}

export async function readCalendar(
  client: NativeClient,
  id: string,
  calendarId?: string,
  includeAttendees = true,
  requireScheduledDate = false
): Promise<NativeDocument> {
  if (!calendarId) throw new NativeSearchError('unavailable', 'Missing calendar reference.')
  const row = object(
    await client.json(`/calendar/v3/calendars/${segment(calendarId)}/events/${segment(id)}`)
  )
  const timeZone =
    requireScheduledDate && string(object(row.start).date)
      ? string(object(await client.json(`/calendar/v3/calendars/${segment(calendarId)}`)).timeZone)
      : undefined
  return eventDocument(row, calendarId, includeAttendees, timeZone)
}
