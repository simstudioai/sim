import type { OutputProperty, ToolFileData, ToolResponse } from '@/tools/types'

/** Raw ticker entry as returned by the Quartr API. */
export interface QuartrTicker {
  ticker: string
  exchange: string
}

/** Raw company shape as returned by the Quartr API (`CompanyDto`). */
export interface QuartrCompanyDto {
  id: number
  name: string
  displayName?: string
  country: string
  tickers?: QuartrTicker[]
  isins?: string[]
  cik?: string
  openfigi?: string[]
  backlinkUrl: string
  createdAt: string
  updatedAt: string
}

/** Raw event shape as returned by the Quartr API (`EventDto`). */
export interface QuartrEventDto {
  id: number
  companyId: number
  title: string
  date: string
  typeId: number
  fiscalYear?: number
  fiscalPeriod?: string
  language: string
  backlinkUrl: string
  createdAt: string
  updatedAt: string
}

/** Raw expanded event shape embedded on documents and audio (`ExpandedEventDto`). */
export interface QuartrExpandedEventDto {
  title?: string
  typeId?: number
  fiscalYear?: number
  fiscalPeriod?: string
  language?: string
  date?: string
}

/** Raw document shape as returned by the Quartr API (`DocumentDto`). */
export interface QuartrDocumentDto {
  id: number
  companyId?: number
  eventId?: number
  typeId: number
  fileUrl: string
  createdAt: string
  updatedAt: string
  event?: QuartrExpandedEventDto
}

/** Raw summary source as returned by the Quartr API (`SummarySource`). */
export interface QuartrSummarySourceDto {
  sourceId?: string
  documentId: number
  page?: number
  timestamp?: number
  typeId: number
}

/** Raw summary shape as returned by the Quartr API (`SummaryDto`). */
export interface QuartrSummaryDto {
  id: number
  summary: string
  sources: QuartrSummarySourceDto[]
  createdAt: string
  updatedAt: string
}

/** Raw audio metadata as returned by the Quartr API (`AudioMetadataDto`). */
export interface QuartrAudioMetadataDto {
  size?: string
  duration?: number
  encoding?: string
  mimetype?: string
}

/** Raw audio shape as returned by the Quartr API (`AudioDto`). */
export interface QuartrAudioDto {
  id: number
  companyId: number
  eventId: number
  fileUrl?: string
  streamUrl?: string
  qna?: number
  audioMetadata?: QuartrAudioMetadataDto
  createdAt: string
  updatedAt: string
  event?: QuartrExpandedEventDto
}

/** Raw live event shape as returned by the Quartr API (`LiveDto`). */
export interface QuartrLiveEventDto {
  id: number
  eventId: number
  companyId: number
  date: string
  wentLiveAt?: string
  state?: string
  audio?: string
  transcript?: string
  createdAt: string
  updatedAt: string
}

/** Raw event type shape as returned by the Quartr API (`EventTypeDto`). */
export interface QuartrEventTypeDto {
  id: number
  name?: string
  parent?: string
  createdAt: string
  updatedAt: string
}

/** Raw document type shape as returned by the Quartr API (`DocumentTypeDto`). */
export interface QuartrDocumentTypeDto {
  id: number
  name: string
  description?: string
  form?: string
  category: string
  documentGroupId?: number
  createdAt: string
  updatedAt: string
}

/** Cursor pagination envelope returned by Quartr list endpoints. */
export interface QuartrPaginationDto {
  nextCursor: number | null
}

/** Paginated list envelope returned by Quartr list endpoints. */
export interface QuartrPaginatedDto<T> {
  data: T[]
  pagination: QuartrPaginationDto
}

/** Single-resource envelope returned by Quartr retrieve endpoints. */
export interface QuartrSingleDto<T> {
  data: T
}

/** Company with nullable optional fields, as emitted in tool outputs. */
export interface QuartrCompany {
  id: number
  name: string
  displayName: string | null
  country: string
  tickers: QuartrTicker[]
  isins: string[]
  cik: string | null
  openfigi: string[]
  backlinkUrl: string
  createdAt: string
  updatedAt: string
}

/** Event with nullable optional fields, as emitted in tool outputs. */
export interface QuartrEvent {
  id: number
  companyId: number
  title: string
  date: string
  typeId: number
  fiscalYear: number | null
  fiscalPeriod: string | null
  language: string
  backlinkUrl: string
  createdAt: string
  updatedAt: string
}

/** Expanded event with nullable optional fields, as emitted in tool outputs. */
export interface QuartrExpandedEvent {
  title: string | null
  typeId: number | null
  fiscalYear: number | null
  fiscalPeriod: string | null
  language: string | null
  date: string | null
}

/** Document with nullable optional fields, as emitted in tool outputs. */
export interface QuartrDocument {
  id: number
  companyId: number | null
  eventId: number | null
  typeId: number
  fileUrl: string
  createdAt: string
  updatedAt: string
  event: QuartrExpandedEvent | null
}

/** Summary source with nullable optional fields, as emitted in tool outputs. */
export interface QuartrSummarySource {
  sourceId: string | null
  documentId: number
  page: number | null
  timestamp: number | null
  typeId: number
}

/** Audio metadata with nullable optional fields, as emitted in tool outputs. */
export interface QuartrAudioMetadata {
  size: string | null
  duration: number | null
  encoding: string | null
  mimetype: string | null
}

/** Audio recording with nullable optional fields, as emitted in tool outputs. */
export interface QuartrAudio {
  id: number
  companyId: number
  eventId: number
  fileUrl: string | null
  streamUrl: string | null
  qna: number | null
  audioMetadata: QuartrAudioMetadata | null
  createdAt: string
  updatedAt: string
  event: QuartrExpandedEvent | null
}

/** Live event with nullable optional fields, as emitted in tool outputs. */
export interface QuartrLiveEvent {
  id: number
  eventId: number
  companyId: number
  date: string
  wentLiveAt: string | null
  state: string | null
  audio: string | null
  transcript: string | null
  createdAt: string
  updatedAt: string
}

/** Event type with nullable optional fields, as emitted in tool outputs. */
export interface QuartrEventType {
  id: number
  name: string | null
  parent: string | null
  createdAt: string
  updatedAt: string
}

/** Document type with nullable optional fields, as emitted in tool outputs. */
export interface QuartrDocumentType {
  id: number
  name: string
  description: string | null
  form: string | null
  category: string
  documentGroupId: number | null
  createdAt: string
  updatedAt: string
}

/** Cursor pagination parameters shared by all Quartr list tools. */
export interface QuartrPaginationParams {
  limit?: number | string
  cursor?: number | string
  direction?: string
}

/** `updatedAt` range filters shared by Quartr list tools. */
export interface QuartrUpdatedRangeParams {
  updatedAfter?: string
  updatedBefore?: string
}

/** Company identifier filters shared by Quartr list tools. */
export interface QuartrCompanyFilterParams {
  tickers?: string
  isins?: string
  ciks?: string
  countries?: string
  exchanges?: string
}

export interface QuartrListCompaniesParams
  extends QuartrCompanyFilterParams,
    QuartrPaginationParams,
    QuartrUpdatedRangeParams {
  apiKey: string
  companyIds?: string
  openfigis?: string
}

export interface QuartrGetCompanyParams {
  apiKey: string
  companyId: number | string
}

export interface QuartrListEventsParams
  extends QuartrCompanyFilterParams,
    QuartrPaginationParams,
    QuartrUpdatedRangeParams {
  apiKey: string
  companyIds?: string
  eventTypeIds?: string
  startDate?: string
  endDate?: string
  sortBy?: string
}

export interface QuartrGetEventParams {
  apiKey: string
  eventId: number | string
}

export interface QuartrGetEventSummaryParams {
  apiKey: string
  eventId: number | string
  summaryLength?: string
  plainSummary?: boolean | string
}

export interface QuartrListEventTypesParams extends QuartrPaginationParams {
  apiKey: string
}

export interface QuartrListDocumentTypesParams extends QuartrPaginationParams {
  apiKey: string
}

/** Filters shared by the documents, reports, slide decks, and transcripts list tools. */
export interface QuartrListDocumentsParams
  extends QuartrCompanyFilterParams,
    QuartrPaginationParams,
    QuartrUpdatedRangeParams {
  apiKey: string
  companyIds?: string
  eventIds?: string
  documentTypeIds?: string
  documentGroupIds?: string
  startDate?: string
  endDate?: string
  expandEvent?: boolean | string
}

export interface QuartrGetReportParams {
  apiKey: string
  reportId: number | string
}

export interface QuartrGetSlideDeckParams {
  apiKey: string
  slideDeckId: number | string
}

export interface QuartrGetTranscriptParams {
  apiKey: string
  transcriptId: number | string
}

export interface QuartrListAudioParams
  extends QuartrCompanyFilterParams,
    QuartrPaginationParams,
    QuartrUpdatedRangeParams {
  apiKey: string
  companyIds?: string
  eventIds?: string
  startDate?: string
  endDate?: string
  expandEvent?: boolean | string
}

export interface QuartrGetAudioParams {
  apiKey: string
  audioId: number | string
}

export interface QuartrListLiveEventsParams
  extends QuartrCompanyFilterParams,
    QuartrPaginationParams,
    QuartrUpdatedRangeParams {
  apiKey: string
  companyIds?: string
  eventIds?: string
  states?: string
  startDate?: string
  endDate?: string
  transcriptVersion?: string
}

export interface QuartrListCompaniesResponse extends ToolResponse {
  output: {
    companies: QuartrCompany[]
    nextCursor: number | null
  }
}

export interface QuartrGetCompanyResponse extends ToolResponse {
  output: {
    company: QuartrCompany
  }
}

export interface QuartrListEventsResponse extends ToolResponse {
  output: {
    events: QuartrEvent[]
    nextCursor: number | null
  }
}

export interface QuartrGetEventResponse extends ToolResponse {
  output: {
    event: QuartrEvent
  }
}

export interface QuartrGetEventSummaryResponse extends ToolResponse {
  output: {
    summary: string
    sources: QuartrSummarySource[]
    summaryId: number
    summaryCreatedAt: string
    summaryUpdatedAt: string
  }
}

export interface QuartrListEventTypesResponse extends ToolResponse {
  output: {
    eventTypes: QuartrEventType[]
    nextCursor: number | null
  }
}

export interface QuartrListDocumentTypesResponse extends ToolResponse {
  output: {
    documentTypes: QuartrDocumentType[]
    nextCursor: number | null
  }
}

export interface QuartrListDocumentsResponse extends ToolResponse {
  output: {
    documents: QuartrDocument[]
    nextCursor: number | null
  }
}

export interface QuartrListReportsResponse extends ToolResponse {
  output: {
    reports: QuartrDocument[]
    nextCursor: number | null
  }
}

export interface QuartrListSlideDecksResponse extends ToolResponse {
  output: {
    slideDecks: QuartrDocument[]
    nextCursor: number | null
  }
}

export interface QuartrListTranscriptsResponse extends ToolResponse {
  output: {
    transcripts: QuartrDocument[]
    nextCursor: number | null
  }
}

export interface QuartrGetDocumentFileResponse extends ToolResponse {
  output: {
    document: QuartrDocument
    fileUrl: string
    file: ToolFileData
  }
}

export interface QuartrListAudioResponse extends ToolResponse {
  output: {
    audioRecordings: QuartrAudio[]
    nextCursor: number | null
  }
}

export interface QuartrGetAudioResponse extends ToolResponse {
  output: {
    audio: QuartrAudio
  }
}

export interface QuartrListLiveEventsResponse extends ToolResponse {
  output: {
    liveEvents: QuartrLiveEvent[]
    nextCursor: number | null
  }
}

export const QUARTR_TICKER_OUTPUT_PROPERTIES = {
  ticker: { type: 'string', description: 'Ticker symbol' },
  exchange: { type: 'string', description: 'Exchange symbol' },
} as const satisfies Record<string, OutputProperty>

export const QUARTR_COMPANY_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Quartr company ID' },
  name: { type: 'string', description: 'Legal company name' },
  displayName: { type: 'string', description: 'Display name', nullable: true },
  country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code' },
  tickers: {
    type: 'array',
    description: 'Ticker listings for the company',
    items: { type: 'object', properties: QUARTR_TICKER_OUTPUT_PROPERTIES },
  },
  isins: { type: 'array', description: 'ISINs for the company', items: { type: 'string' } },
  cik: { type: 'string', description: 'SEC Central Index Key', nullable: true },
  openfigi: {
    type: 'array',
    description: 'OpenFIGI share class identifiers',
    items: { type: 'string' },
  },
  backlinkUrl: { type: 'string', description: 'Quartr backlink URL for the company' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

export const QUARTR_EVENT_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Quartr event ID' },
  companyId: { type: 'number', description: 'Quartr company ID' },
  title: { type: 'string', description: 'Event title (e.g., "Q1 2024")' },
  date: { type: 'string', description: 'Event date (ISO 8601)' },
  typeId: { type: 'number', description: 'Event type ID' },
  fiscalYear: { type: 'number', description: 'Fiscal year', nullable: true },
  fiscalPeriod: { type: 'string', description: 'Fiscal period (e.g., "Q1")', nullable: true },
  language: { type: 'string', description: 'Event language code' },
  backlinkUrl: { type: 'string', description: 'Quartr backlink URL for the event' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

export const QUARTR_EXPANDED_EVENT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Event title', nullable: true },
  typeId: { type: 'number', description: 'Event type ID', nullable: true },
  fiscalYear: { type: 'number', description: 'Fiscal year', nullable: true },
  fiscalPeriod: { type: 'string', description: 'Fiscal period (e.g., "Q1")', nullable: true },
  language: { type: 'string', description: 'Event language code', nullable: true },
  date: { type: 'string', description: 'Event date (ISO 8601)', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const QUARTR_DOCUMENT_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Quartr document ID' },
  companyId: { type: 'number', description: 'Quartr company ID', nullable: true },
  eventId: { type: 'number', description: 'Quartr event ID', nullable: true },
  typeId: { type: 'number', description: 'Document type ID' },
  fileUrl: { type: 'string', description: 'URL of the document file' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  event: {
    type: 'object',
    description: 'Expanded event details (present when event expansion is requested)',
    nullable: true,
    properties: QUARTR_EXPANDED_EVENT_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

export const QUARTR_SUMMARY_SOURCE_OUTPUT_PROPERTIES = {
  sourceId: {
    type: 'string',
    description: 'ID linking the source document to tags embedded in the summary',
    nullable: true,
  },
  documentId: { type: 'number', description: 'Quartr document ID of the source' },
  page: {
    type: 'number',
    description: 'Page number or timestamp in seconds depending on the document type',
    nullable: true,
  },
  timestamp: { type: 'number', description: 'Timestamp in seconds', nullable: true },
  typeId: { type: 'number', description: 'Document type ID of the source' },
} as const satisfies Record<string, OutputProperty>

export const QUARTR_AUDIO_METADATA_OUTPUT_PROPERTIES = {
  size: { type: 'string', description: 'File size (e.g., "200.00 MB")', nullable: true },
  duration: { type: 'number', description: 'Duration in seconds', nullable: true },
  encoding: { type: 'string', description: 'Audio encoding', nullable: true },
  mimetype: { type: 'string', description: 'Audio MIME type', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const QUARTR_AUDIO_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Quartr audio ID' },
  companyId: { type: 'number', description: 'Quartr company ID' },
  eventId: { type: 'number', description: 'Quartr event ID' },
  fileUrl: { type: 'string', description: 'Download URL of the audio file (MPEG)', nullable: true },
  streamUrl: {
    type: 'string',
    description: 'Streaming URL of the audio (M3U8)',
    nullable: true,
  },
  qna: {
    type: 'number',
    description: 'Timestamp in seconds where the Q&A section starts',
    nullable: true,
  },
  audioMetadata: {
    type: 'object',
    description: 'Audio file metadata',
    nullable: true,
    properties: QUARTR_AUDIO_METADATA_OUTPUT_PROPERTIES,
  },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  event: {
    type: 'object',
    description: 'Expanded event details (present when event expansion is requested)',
    nullable: true,
    properties: QUARTR_EXPANDED_EVENT_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

export const QUARTR_LIVE_EVENT_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Quartr live event ID' },
  eventId: { type: 'number', description: 'Quartr event ID' },
  companyId: { type: 'number', description: 'Quartr company ID' },
  date: { type: 'string', description: 'Scheduled event date (ISO 8601)' },
  wentLiveAt: {
    type: 'string',
    description: 'Timestamp when the event went live (ISO 8601)',
    nullable: true,
  },
  state: {
    type: 'string',
    description:
      'Live state (notLive, willBeLive, live, liveFailedInterrupted, liveFailedNoAccess, liveFailedNotStarted, processingRecording, processingRecordingFailed, recordingAvailable)',
    nullable: true,
  },
  audio: {
    type: 'string',
    description: 'URL of the live audio stream or recording',
    nullable: true,
  },
  transcript: {
    type: 'string',
    description: 'URL of the live transcript stream (JSON Lines)',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

export const QUARTR_EVENT_TYPE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Event type ID' },
  name: { type: 'string', description: 'Event type name (e.g., "Q1")', nullable: true },
  parent: {
    type: 'string',
    description: 'Parent event type name (e.g., "Earnings call")',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

export const QUARTR_DOCUMENT_TYPE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Document type ID' },
  name: { type: 'string', description: 'Document type name (e.g., "Quarterly Report")' },
  description: { type: 'string', description: 'Document type description', nullable: true },
  form: { type: 'string', description: 'Filing form (e.g., "10-Q")', nullable: true },
  category: { type: 'string', description: 'Document category (e.g., "Report")' },
  documentGroupId: { type: 'number', description: 'Document group ID', nullable: true },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>
