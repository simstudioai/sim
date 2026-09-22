import { zonedWallClockToUtc } from '@/lib/core/utils/timezone'
import { hasDateBounds, nativeDateBounds, nativeText } from '@/lib/sim-search/live/dates'
import { array, NativeSearchError, object, segment, string } from '@/lib/sim-search/live/http'
import { permitsResources } from '@/lib/sim-search/live/policy'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
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
        ...(input.filters?.sortBy && input.filters.sortBy !== 'relevance'
          ? { orderBy: `modifiedTime${input.filters.sortBy === 'oldest' ? '' : ' desc'}` }
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

export async function readDrive(client: NativeClient, id: string): Promise<NativeDocument> {
  const row = object(
    await client.json(`/drive/v3/files/${segment(id)}`, {
      query: { fields: DRIVE_FIELDS, supportsAllDrives: 'true' },
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
  } else if (document.kind?.startsWith('text/') || document.kind === 'application/json') {
    document.content = await client.text(`/drive/v3/files/${segment(id)}`, {
      alt: 'media',
      supportsAllDrives: 'true',
    })
  } else {
    document.content = `File metadata only. Open the source to read this ${document.kind} file.\n${document.content}`
  }
  return document
}

function gmailDocument(row: Record<string, unknown>): NativeDocument {
  const payload = object(row.payload)
  const headers = array(payload.headers)
  const header = (name: string) =>
    string(headers.find((h) => string(h.name).toLowerCase() === name)?.value)
  const timestamp = Number(row.internalDate)
  return {
    id: string(row.id),
    title: header('subject') || '(No subject)',
    url: `https://mail.google.com/mail/u/0/#all/${segment(string(row.id))}`,
    content: string(row.snippet),
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
  const documents: NativeDocument[] = []
  // Bound fanout while retaining provider rank. One metadata call per matching message.
  const messages = array(data.messages)
  for (let offset = 0; offset < messages.length; offset += 5) {
    documents.push(
      ...(await Promise.all(
        messages.slice(offset, offset + 5).map(async (message) =>
          gmailDocument(
            object(
              await client.json(`/gmail/v1/users/me/messages/${segment(string(message.id))}`, {
                query: { format: 'metadata' },
              })
            )
          )
        )
      ))
    )
  }
  return {
    documents,
    nextCursor: string(data.nextPageToken) || undefined,
    message:
      'Gmail uses message search operators. The API does not perform the Gmail UI’s alias expansion or thread-wide matching.',
  }
}

function mailText(value: unknown): string {
  const part = object(value)
  const children = array(part.parts).map(mailText).filter(Boolean)
  const encoded = string(object(part.body).data)
  if (string(part.mimeType) === 'text/plain' && encoded)
    return Buffer.from(encoded, 'base64url').toString('utf8')
  if (children.length) return children.join('\n')
  // HTML-only messages remain text, never rendered as markup.
  if (string(part.mimeType) === 'text/html' && encoded)
    return Buffer.from(encoded, 'base64url')
      .toString('utf8')
      .replace(/<[^>]*>/g, ' ')
  return ''
}

export async function readGmail(client: NativeClient, id: string): Promise<NativeDocument> {
  const data = object(
    await client.json(`/gmail/v1/users/me/messages/${segment(id)}`, { query: { format: 'full' } })
  )
  const document = gmailDocument(data)
  return { ...document, content: mailText(data.payload) || document.content }
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
      string(row.description),
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
  const documents: NativeDocument[] = []
  let partial = Boolean(calendars.nextPageToken)
  let nextCursor: string | undefined
  let failedCalendars = 0
  for (let offset = 0; offset < rows.length; offset += 4) {
    const pages = await Promise.allSettled(
      rows.slice(offset, offset + 4).map(async (row) => {
        const calendarId = string(row.id)
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
              ...(hasDateBounds(input.filters) ||
              (input.filters?.sortBy && input.filters.sortBy !== 'relevance')
                ? { singleEvents: 'true', orderBy: 'startTime' }
                : {}),
              maxResults: String(input.limit),
              showDeleted: 'false',
              ...(input.native?.cursor && input.native.project
                ? { pageToken: input.native.cursor }
                : {}),
            },
          })
        )
        return { data, calendarId, timeZone: string(data.timeZone) || string(row.timeZone) }
      })
    )
    for (const result of pages) {
      if (result.status === 'rejected') {
        if (input.native?.project) throw result.reason
        partial = true
        failedCalendars++
        continue
      }
      const { data, calendarId, timeZone } = result.value
      documents.push(
        ...array(data.items)
          .filter((event) => event.status !== 'cancelled')
          .map((event) =>
            eventDocument(event, calendarId, input.policy?.includeAttendees, timeZone)
          )
      )
      partial ||= Boolean(data.nextPageToken)
      if (input.native?.project) nextCursor = string(data.nextPageToken) || undefined
    }
  }
  if (rows.length > 0 && failedCalendars === rows.length)
    throw new NativeSearchError(
      'unavailable',
      'None of the calendars could be searched. Check calendar permissions.'
    )
  return {
    documents,
    partial,
    nextCursor,
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
