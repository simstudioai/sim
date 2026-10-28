import { isRecordLike, toRecord } from '@sim/utils/object'
import { truncateAtCodePoint } from '@sim/utils/string'
import {
  dateSortDirection,
  hasDateBounds,
  nativeDateBounds,
  nativeText,
} from '@/lib/sim-search/live/dates'
import { NativeSearchError, string } from '@/lib/sim-search/live/http'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import { collectNativePages } from '@/lib/sim-search/live/pages'
import { providerText } from '@/lib/sim-search/live/text'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

const CRM_TYPES = {
  contacts: {
    api: 'CONTACT',
    typeId: '0-1',
    modified: 'lastmodifieddate',
    label: 'Contact',
    properties: ['firstname', 'lastname', 'email', 'company', 'jobtitle', 'lifecyclestage'],
  },
  companies: {
    api: 'COMPANY',
    typeId: '0-2',
    modified: 'hs_lastmodifieddate',
    label: 'Company',
    properties: ['name', 'domain', 'website', 'description', 'industry'],
  },
  deals: {
    api: 'DEAL',
    typeId: '0-3',
    modified: 'hs_lastmodifieddate',
    label: 'Deal',
    properties: [
      'dealname',
      'description',
      'dealstage',
      'pipeline',
      'amount',
      'deal_currency_code',
      'closedate',
    ],
  },
  tickets: {
    api: 'TICKET',
    typeId: '0-5',
    modified: 'hs_lastmodifieddate',
    label: 'Ticket',
    properties: ['subject', 'content', 'hs_pipeline', 'hs_pipeline_stage', 'hs_ticket_priority'],
  },
} as const

type CrmKind = keyof typeof CRM_TYPES
const CRM_KINDS = Object.keys(CRM_TYPES) as CrmKind[]
const MAX_CONTENT = 200_000
const MAX_SEARCH_OFFSET = 10_000
const GUIDANCE =
  'HubSpot searches the default searchable properties of contacts, companies, deals, and tickets using your current permissions. Read a result for its returned CRM properties; activity histories and associations are not included. For more matches, select one kind and continue its returned cursor. Results are records, not aggregate counts.'

function fail(message: string): never {
  throw new NativeSearchError('unavailable', message)
}

function identifier(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value)
  return /^[1-9]\d{0,15}$/.test(text) && Number.isSafeInteger(Number(text)) ? text : undefined
}

function isCrmKind(value: string): value is CrmKind {
  return Object.hasOwn(CRM_TYPES, value)
}

async function permissions(client: ManagedSearchMcpClient) {
  const response = toRecord(
    await client.call('get_user_details', { include: ['TOOL_INFORMATION'] })
  )
  const accountId = identifier(response.accountId)
  const availability = toRecord(response.toolInformation).crmObjectTypeAvailability
  if (!accountId || !isRecordLike(availability))
    fail('HubSpot did not return account identity and CRM read permissions.')
  return { accountId, availability }
}

function requireRead(availability: Record<string, unknown>, kind: CrmKind) {
  const status = toRecord(availability[CRM_TYPES[kind].api]).read
  if (status === 'AVAILABLE') return
  throw new NativeSearchError(
    status === 'REQUIRES_REAUTHORIZATION' ? 'reconnect' : 'unavailable',
    status === 'REQUIRES_REAUTHORIZATION'
      ? `Reconnect HubSpot and allow read access to ${kind}.`
      : `Your HubSpot account does not currently allow reading ${kind}.`
  )
}

/** URLs are citations only. The account, type, and record must match independently verified identity. */
function recordUrl(
  value: unknown,
  accountId: string,
  kind: CrmKind,
  id: string
): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value.replace('{id}', id))
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !/^app(?:-[a-z]+\d+)?\.hubspot\.com$/.test(url.hostname) ||
      url.pathname !== `/contacts/${accountId}/record/${CRM_TYPES[kind].typeId}/${id}`
    )
      return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function recordDocument(
  value: unknown,
  accountId: string,
  kind: CrmKind,
  urlTemplate?: unknown
): NativeDocument | undefined {
  const row = toRecord(value)
  const id = identifier(row.id)
  if (!id || row.archived === true || !isRecordLike(row.properties)) return undefined
  const properties = row.properties
  if (properties.hs_object_id !== undefined && identifier(properties.hs_object_id) !== id)
    return undefined
  const url = recordUrl(row.url ?? urlTemplate, accountId, kind, id)
  if (!url) return undefined
  const title =
    string(row.displayName) ||
    string(properties.name ?? properties.dealname ?? properties.subject) ||
    [string(properties.firstname), string(properties.lastname)].filter(Boolean).join(' ') ||
    `${CRM_TYPES[kind].label} ${id}`
  const rawDate = row.updatedAt ?? properties[CRM_TYPES[kind].modified]
  const date = typeof rawDate === 'string' ? Date.parse(rawDate) : Number.NaN
  const fields = Object.entries(properties)
  if (
    fields.some(
      ([, value]) =>
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
    )
  )
    return undefined
  const content = [
    `${CRM_TYPES[kind].label}: ${title}`,
    ...fields
      .slice(0, 1000)
      .flatMap(([key, value]) =>
        value === null || value === '' ? [] : [`${key}: ${providerText(String(value), 'auto')}`]
      ),
  ].join('\n')
  const notice = '[CRM content truncated. Open the HubSpot record for the remainder.]\n\n'
  return {
    id: `hubspot:${accountId}:${kind}:${id}`,
    container: accountId,
    kind,
    title: truncateAtCodePoint(title, 1000),
    url,
    content:
      content.length > MAX_CONTENT || fields.length > 1000
        ? notice + truncateAtCodePoint(content, MAX_CONTENT - notice.length, '')
        : content,
    ...(Number.isFinite(date) ? { modifiedAt: new Date(date).toISOString() } : {}),
  }
}

/** Each collection uses its documented searchable properties and the member's current CRM permissions. */
export async function searchHubSpotMcp(
  client: ManagedSearchMcpClient,
  input: NativeSearchInput
): Promise<NativePage> {
  const query = nativeText(input)
  if (query.length > 200)
    fail(
      'HubSpot search accepts at most 200 characters. Use a name, domain, email, or concise keywords.'
    )
  const requested = input.native?.kind
  if (requested && !isCrmKind(requested))
    fail('HubSpot kind must be contacts, companies, deals, or tickets.')
  if (
    input.native?.project ||
    input.native?.termClauses?.length ||
    input.native?.modifiers ||
    input.native?.keywordOnly
  )
    fail(
      'HubSpot accepts plain keywords and a CRM kind; project and other provider operators are not supported.'
    )
  const cursor = input.native?.cursor
  if (cursor && (!requested || !/^(?:0|[1-9]\d{0,3})$/.test(cursor)))
    fail(
      'Continue HubSpot with the returned cursor and the same explicit CRM kind, query, and date filters.'
    )
  const offset = cursor ? Number(cursor) : 0
  const limit = Math.min(25, Math.max(1, input.limit), MAX_SEARCH_OFFSET - offset)
  const bounds = nativeDateBounds(input)
  if (bounds.start && bounds.end && Date.parse(bounds.start) >= Date.parse(bounds.end))
    return { documents: [] }
  const { accountId, availability } = await permissions(client)
  const searchKind = async (kind: CrmKind): Promise<NativePage> => {
    requireRead(availability, kind)
    const type = CRM_TYPES[kind]
    const filters = [
      ...(bounds.start
        ? [
            {
              propertyName: type.modified,
              operator: 'GTE',
              value: String(Date.parse(bounds.start)),
            },
          ]
        : []),
      ...(bounds.end
        ? [{ propertyName: type.modified, operator: 'LT', value: String(Date.parse(bounds.end)) }]
        : []),
    ]
    const response = toRecord(
      await client.call('search_crm_objects', {
        objectType: type.api,
        ...(query ? { query } : {}),
        limit,
        ...(offset ? { offset } : {}),
        properties: [...type.properties, type.modified, 'hs_object_id'],
        ...(filters.length ? { filterGroups: [{ filters }] } : {}),
        sorts: [
          {
            propertyName: type.modified,
            direction: dateSortDirection(input.filters) === 'asc' ? 'ASCENDING' : 'DESCENDING',
          },
        ],
      })
    )
    const rows = response.results
    const total = response.total
    const next = response.offset
    if (
      !Array.isArray(rows) ||
      rows.length > limit ||
      typeof total !== 'number' ||
      !Number.isSafeInteger(total) ||
      total < 0 ||
      typeof next !== 'number' ||
      !Number.isSafeInteger(next) ||
      next < 0 ||
      next !== offset + rows.length ||
      next > total
    )
      fail('HubSpot returned an unsupported CRM search page or pagination cursor.')
    if (!rows.length && next < total)
      fail('HubSpot could not advance its CRM search page. Narrow the query.')
    const documents = rows.flatMap((row) => {
      const document = recordDocument(row, accountId, kind, response.urlTemplate)
      return document ? [document] : []
    })
    const more = next < total
    const capped = more && next >= MAX_SEARCH_OFFSET
    return {
      documents,
      ...(more && !capped ? { nextCursor: String(next) } : {}),
      ...(capped ? { hasMore: true } : {}),
      partial:
        capped ||
        documents.length !== rows.length ||
        (hasDateBounds(input.filters) && documents.some((document) => !document.modifiedAt)),
      message: capped
        ? `${GUIDANCE} HubSpot's 10,000-result window was reached. Narrow the query or dates.`
        : GUIDANCE,
    }
  }
  return requested ? searchKind(requested) : collectNativePages(CRM_KINDS.map(searchKind), GUIDANCE)
}

/** A read verifies account, type, and record identity again using the current member grant. */
export async function readHubSpotMcp(
  client: ManagedSearchMcpClient,
  reference: string
): Promise<NativeDocument> {
  const parts = reference.split(':')
  const [, accountId, kind, id] = parts
  if (
    parts.length !== 4 ||
    parts[0] !== 'hubspot' ||
    !identifier(accountId) ||
    !kind ||
    !isCrmKind(kind) ||
    !identifier(id)
  )
    fail('HubSpot requires a record reference returned by search.')
  const current = await permissions(client)
  if (current.accountId !== accountId)
    fail('The HubSpot account changed. Search again before reading this record.')
  requireRead(current.availability, kind)
  const response = toRecord(
    await client.call('get_crm_objects', {
      objectType: CRM_TYPES[kind].api,
      objectIds: [Number(id)],
    })
  )
  if (
    !Array.isArray(response.objects) ||
    response.objects.length !== 1 ||
    (Array.isArray(response.notFound) && response.notFound.length)
  )
    fail('HubSpot did not return the requested CRM record.')
  const document = recordDocument(response.objects[0], accountId, kind)
  if (!document || document.id !== reference)
    fail('HubSpot did not verify the requested CRM record identity.')
  return document
}
