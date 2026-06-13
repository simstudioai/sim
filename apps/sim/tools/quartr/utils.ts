import type {
  QuartrAudio,
  QuartrAudioDto,
  QuartrCompany,
  QuartrCompanyDto,
  QuartrCompanyFilterParams,
  QuartrDocument,
  QuartrDocumentDto,
  QuartrDocumentType,
  QuartrDocumentTypeDto,
  QuartrEvent,
  QuartrEventDto,
  QuartrEventType,
  QuartrEventTypeDto,
  QuartrExpandedEvent,
  QuartrExpandedEventDto,
  QuartrListDocumentsParams,
  QuartrLiveEvent,
  QuartrLiveEventDto,
  QuartrPaginationParams,
  QuartrSummarySource,
  QuartrSummarySourceDto,
  QuartrUpdatedRangeParams,
} from '@/tools/quartr/types'

export const QUARTR_API_BASE_URL = 'https://api.quartr.com/public/v3'

/**
 * Normalizes a comma-separated list value by trimming whitespace around each
 * entry, since the Quartr API expects lists without blank spaces.
 */
export function normalizeQuartrCommaList(
  value: string | number | null | undefined
): string | undefined {
  if (value == null || value === '') return undefined
  const normalized = String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(',')
  return normalized || undefined
}

/**
 * Interprets a boolean-ish tool param, accepting boolean true or the string
 * "true" (agent tool configuration serializes switch values as strings).
 */
export function isQuartrToggleEnabled(value: boolean | string | null | undefined): boolean {
  return value === true || value === 'true'
}

/**
 * Builds a Quartr API URL, appending only query parameters that have a value.
 */
export function buildQuartrUrl(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>
): string {
  const url = new URL(`${QUARTR_API_BASE_URL}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

/**
 * Builds the query parameters shared by all Quartr list tools: company
 * identifier filters, pagination, and updatedAt range filters.
 */
export function buildQuartrListQuery(
  params: QuartrCompanyFilterParams & QuartrPaginationParams & QuartrUpdatedRangeParams
): Record<string, string | number | boolean | undefined> {
  return {
    tickers: normalizeQuartrCommaList(params.tickers),
    isins: normalizeQuartrCommaList(params.isins),
    ciks: normalizeQuartrCommaList(params.ciks),
    countries: normalizeQuartrCommaList(params.countries),
    exchanges: normalizeQuartrCommaList(params.exchanges),
    limit: params.limit,
    cursor: params.cursor,
    direction: params.direction,
    updatedAfter: params.updatedAfter,
    updatedBefore: params.updatedBefore,
  }
}

/**
 * Builds the query parameters shared by the documents, reports, slide decks,
 * and transcripts list tools.
 */
export function buildQuartrDocumentListQuery(
  params: QuartrListDocumentsParams
): Record<string, string | number | boolean | undefined> {
  return {
    ...buildQuartrListQuery(params),
    companyIds: normalizeQuartrCommaList(params.companyIds),
    eventIds: normalizeQuartrCommaList(params.eventIds),
    typeIds: normalizeQuartrCommaList(params.documentTypeIds),
    documentGroupIds: normalizeQuartrCommaList(params.documentGroupIds),
    startDate: params.startDate,
    endDate: params.endDate,
    expand: isQuartrToggleEnabled(params.expandEvent) ? 'event' : undefined,
  }
}

/**
 * Parses a Quartr API response, throwing a descriptive error for failures.
 */
export async function parseQuartrResponse<T>(response: Response, operation: string): Promise<T> {
  const text = await response.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = undefined
  }

  if (!response.ok) {
    const body = data as
      | { message?: string | Array<string | { field?: string; message?: string }>; error?: string }
      | undefined
    const rawMessage = body?.message ?? body?.error ?? `HTTP ${response.status}`
    const message = Array.isArray(rawMessage)
      ? rawMessage
          .map((entry) => {
            if (typeof entry === 'string') return entry
            if (typeof entry?.message === 'string') {
              return entry.field ? `${entry.field}: ${entry.message}` : entry.message
            }
            return JSON.stringify(entry)
          })
          .join('; ')
      : rawMessage
    throw new Error(`Quartr ${operation} failed (${response.status}): ${message}`)
  }

  if (data === undefined) {
    throw new Error(`Quartr ${operation} returned an invalid JSON response`)
  }

  return data as T
}

export function mapQuartrCompany(dto: QuartrCompanyDto): QuartrCompany {
  return {
    id: dto.id,
    name: dto.name,
    displayName: dto.displayName ?? null,
    country: dto.country,
    tickers: dto.tickers ?? [],
    isins: dto.isins ?? [],
    cik: dto.cik ?? null,
    openfigi: dto.openfigi ?? [],
    backlinkUrl: dto.backlinkUrl,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

export function mapQuartrEvent(dto: QuartrEventDto): QuartrEvent {
  return {
    id: dto.id,
    companyId: dto.companyId,
    title: dto.title,
    date: dto.date,
    typeId: dto.typeId,
    fiscalYear: dto.fiscalYear ?? null,
    fiscalPeriod: dto.fiscalPeriod ?? null,
    language: dto.language,
    backlinkUrl: dto.backlinkUrl,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

export function mapQuartrExpandedEvent(
  dto: QuartrExpandedEventDto | undefined
): QuartrExpandedEvent | null {
  if (!dto) return null
  return {
    title: dto.title ?? null,
    typeId: dto.typeId ?? null,
    fiscalYear: dto.fiscalYear ?? null,
    fiscalPeriod: dto.fiscalPeriod ?? null,
    language: dto.language ?? null,
    date: dto.date ?? null,
  }
}

export function mapQuartrDocument(dto: QuartrDocumentDto): QuartrDocument {
  return {
    id: dto.id,
    companyId: dto.companyId ?? null,
    eventId: dto.eventId ?? null,
    typeId: dto.typeId,
    fileUrl: dto.fileUrl,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    event: mapQuartrExpandedEvent(dto.event),
  }
}

export function mapQuartrSummarySource(dto: QuartrSummarySourceDto): QuartrSummarySource {
  return {
    sourceId: dto.sourceId ?? null,
    documentId: dto.documentId,
    page: dto.page ?? null,
    timestamp: dto.timestamp ?? null,
    typeId: dto.typeId,
  }
}

export function mapQuartrAudio(dto: QuartrAudioDto): QuartrAudio {
  return {
    id: dto.id,
    companyId: dto.companyId,
    eventId: dto.eventId,
    fileUrl: dto.fileUrl ?? null,
    streamUrl: dto.streamUrl ?? null,
    qna: dto.qna ?? null,
    audioMetadata: dto.audioMetadata
      ? {
          size: dto.audioMetadata.size ?? null,
          duration: dto.audioMetadata.duration ?? null,
          encoding: dto.audioMetadata.encoding ?? null,
          mimetype: dto.audioMetadata.mimetype ?? null,
        }
      : null,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    event: mapQuartrExpandedEvent(dto.event),
  }
}

export function mapQuartrLiveEvent(dto: QuartrLiveEventDto): QuartrLiveEvent {
  return {
    id: dto.id,
    eventId: dto.eventId,
    companyId: dto.companyId,
    date: dto.date,
    wentLiveAt: dto.wentLiveAt ?? null,
    state: dto.state ?? null,
    audio: dto.audio ?? null,
    transcript: dto.transcript ?? null,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

export function mapQuartrEventType(dto: QuartrEventTypeDto): QuartrEventType {
  return {
    id: dto.id,
    name: dto.name ?? null,
    parent: dto.parent ?? null,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

export function mapQuartrDocumentType(dto: QuartrDocumentTypeDto): QuartrDocumentType {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description ?? null,
    form: dto.form ?? null,
    category: dto.category,
    documentGroupId: dto.documentGroupId ?? null,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}
