import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorGetCompanyEventsParams,
  type DowndetectorGetCompanyEventsResponse,
} from '@/tools/downdetector/types'
import {
  downdetectorHeaders,
  downdetectorNextPageOutput,
  encodePathParam,
  extractDowndetectorError,
  nextPageFromResponse,
} from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

interface RawEventMeasurement {
  started_on?: string
  ended_on?: string
  expected?: number
  actual?: number
}

interface RawEvent {
  id?: number
  title?: string
  body?: string
  company_id?: number
  created_at?: string
  publish_at?: string
  is_active?: boolean
  measurement?: RawEventMeasurement
}

export const getCompanyEventsTool: ToolConfig<
  DowndetectorGetCompanyEventsParams,
  DowndetectorGetCompanyEventsResponse
> = {
  id: 'downdetector_get_company_events',
  name: 'Downdetector Get Company Events',
  description:
    'Get the published events (such as detected outages) for a Downdetector company, including the measured vs expected report volume for each event.',
  version: '1.0.0',

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Downdetector company id',
    },
    startdate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 start of the time range (only works together with enddate)',
    },
    enddate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 end of the time range (only works together with startdate)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Requested page number (1-indexed)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page, between 10 and 100',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Downdetector API Bearer token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${DOWNDETECTOR_API_BASE}/companies/${encodePathParam(params.companyId, 'Company ID')}/events`
      )
      if (params.startdate) url.searchParams.set('startdate', params.startdate)
      if (params.enddate) url.searchParams.set('enddate', params.enddate)
      if (params.page !== undefined) url.searchParams.set('page', String(params.page))
      if (params.pageSize !== undefined) url.searchParams.set('page_size', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to get company events'))
    }

    const rows: RawEvent[] = Array.isArray(data) ? data : []
    const events = rows.map((event) => ({
      id: event.id ?? null,
      title: event.title ?? null,
      body: event.body ?? null,
      companyId: event.company_id ?? null,
      createdAt: event.created_at ?? null,
      publishAt: event.publish_at ?? null,
      isActive: event.is_active ?? null,
      measurement: event.measurement
        ? {
            startedOn: event.measurement.started_on ?? null,
            endedOn: event.measurement.ended_on ?? null,
            expected: event.measurement.expected ?? null,
            actual: event.measurement.actual ?? null,
          }
        : null,
    }))

    return { success: true, output: { events, nextPage: nextPageFromResponse(response) } }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'List of events for the company',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Event id' },
          title: { type: 'string', description: 'Localized event title' },
          body: { type: 'string', description: 'Localized event body' },
          companyId: { type: 'number', description: 'Id of the impacted company' },
          createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
          publishAt: { type: 'string', description: 'ISO 8601 publish timestamp' },
          isActive: { type: 'boolean', description: 'Whether the event is ongoing' },
          measurement: {
            type: 'object',
            description: 'Measured vs expected report volume for the event window',
            properties: {
              startedOn: { type: 'string', description: 'Measurement window start (ISO 8601)' },
              endedOn: { type: 'string', description: 'Measurement window end (ISO 8601)' },
              expected: { type: 'number', description: 'Expected reports based on historic data' },
              actual: { type: 'number', description: 'Actual reports in the window' },
            },
          },
        },
      },
    },
    nextPage: downdetectorNextPageOutput,
  },
}
