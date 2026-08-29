import type {
  IncidentioOnCallNowParams,
  IncidentioOnCallNowResponse,
  IncidentioOnCallShift,
} from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/** The largest page size for which incident.io still populates `next_shifts`. */
const NEXT_SHIFTS_MAX_PAGE_SIZE = 25

const ON_CALL_SHIFT_OUTPUT_PROPERTIES = {
  schedule_id: { type: 'string', description: 'ID of the schedule the shift belongs to' },
  schedule_name: { type: 'string', description: 'Name of the schedule the shift belongs to' },
  schedule_timezone: { type: 'string', description: 'Timezone the schedule is interpreted in' },
  schedule_permalink: {
    type: 'string',
    description: 'Link to the schedule in the incident.io dashboard',
    optional: true,
  },
  entry_id: {
    type: 'string',
    description:
      'ID of the stored schedule entry. Absent for shifts projected from rotation rules rather than stored',
    optional: true,
  },
  rotation_id: {
    type: 'string',
    description: 'ID of the rotation this shift belongs to',
    optional: true,
  },
  layer_id: {
    type: 'string',
    description: 'ID of the layer this shift belongs to',
    optional: true,
  },
  start_at: { type: 'string', description: 'When the shift starts' },
  end_at: { type: 'string', description: 'When the shift ends' },
  user_id: { type: 'string', description: 'ID of the on-call user', optional: true },
  user_name: { type: 'string', description: 'Name of the on-call user', optional: true },
  user_email: { type: 'string', description: 'Email of the on-call user', optional: true },
  user_slack_user_id: {
    type: 'string',
    description: 'Slack ID of the on-call user',
    optional: true,
  },
} as const

/** The subset of the schedule payload this tool reads. */
interface RawScheduleEntry {
  entry_id?: string
  rotation_id?: string
  layer_id?: string
  start_at?: string
  end_at?: string
  user?: { id?: string; name?: string; email?: string; slack_user_id?: string }
}

interface RawSchedule {
  id?: string
  name?: string
  timezone?: string
  permalink?: string
  current_shifts?: RawScheduleEntry[]
  next_shifts?: RawScheduleEntry[]
}

/**
 * Flattens a schedule's `current_shifts` / `next_shifts` into one row per shift, carrying the
 * owning schedule's identity down onto each row so the caller does not have to join them back up.
 */
function flattenShifts(schedule: RawSchedule): {
  current: IncidentioOnCallShift[]
  next: IncidentioOnCallShift[]
} {
  const toShift = (entry: RawScheduleEntry): IncidentioOnCallShift => ({
    schedule_id: schedule.id ?? '',
    schedule_name: schedule.name ?? '',
    schedule_timezone: schedule.timezone ?? '',
    schedule_permalink: schedule.permalink ?? null,
    entry_id: entry.entry_id ?? null,
    rotation_id: entry.rotation_id ?? null,
    layer_id: entry.layer_id ?? null,
    start_at: entry.start_at ?? null,
    end_at: entry.end_at ?? null,
    user_id: entry.user?.id ?? null,
    user_name: entry.user?.name ?? null,
    user_email: entry.user?.email ?? null,
    user_slack_user_id: entry.user?.slack_user_id ?? null,
  })

  return {
    current: (Array.isArray(schedule.current_shifts) ? schedule.current_shifts : []).map(toShift),
    next: (Array.isArray(schedule.next_shifts) ? schedule.next_shifts : []).map(toShift),
  }
}

export const onCallNowTool: ToolConfig<IncidentioOnCallNowParams, IncidentioOnCallNowResponse> = {
  id: 'incidentio_on_call_now',
  name: 'Get Who Is On Call',
  description:
    'Get who is currently on call in incident.io, as one row per ongoing shift across every schedule (or a single schedule). Also returns the shifts that take over at the next changeover.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    schedule_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Limit the result to a single schedule by ID (e.g., "01FCNDV6P870EA6S7TK1DSYDG0"). Leave empty to return who is on call across every schedule.',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of schedules to scan per page when no schedule ID is given (e.g., 10, 25). Defaults to 25; upcoming shifts are only returned at 25 or lower.',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor to fetch the next page of schedules (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => {
      const scheduleId = params.schedule_id?.trim()
      if (scheduleId) {
        return `https://api.incident.io/v2/schedules/${safeUrlPathSegment(scheduleId, 'schedule_id')}`
      }

      const url = new URL('https://api.incident.io/v2/schedules')
      url.searchParams.set(
        'page_size',
        String(
          params.page_size && params.page_size > 0 ? params.page_size : NEXT_SHIFTS_MAX_PAGE_SIZE
        )
      )
      if (params.after) {
        url.searchParams.set('after', params.after)
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const schedules: RawSchedule[] = Array.isArray(data.schedules)
      ? data.schedules
      : data.schedule
        ? [data.schedule]
        : []

    const onCall: IncidentioOnCallShift[] = []
    const nextOnCall: IncidentioOnCallShift[] = []
    for (const schedule of schedules) {
      const { current, next } = flattenShifts(schedule)
      onCall.push(...current)
      nextOnCall.push(...next)
    }

    return {
      success: true,
      output: {
        on_call: onCall,
        next_on_call: nextOnCall,
        pagination_meta: data.pagination_meta,
      },
    }
  },

  outputs: {
    on_call: {
      type: 'array',
      description: 'Shifts that are ongoing right now, one row per on-call person per schedule',
      items: {
        type: 'object',
        properties: ON_CALL_SHIFT_OUTPUT_PROPERTIES,
      },
    },
    next_on_call: {
      type: 'array',
      description:
        'Shifts that take over at the next changeover. Only populated when the page size is 25 or lower',
      items: {
        type: 'object',
        properties: ON_CALL_SHIFT_OUTPUT_PROPERTIES,
      },
    },
    pagination_meta: {
      type: 'object',
      description: 'Pagination metadata, returned when scanning every schedule',
      optional: true,
      properties: {
        after: { type: 'string', description: 'Cursor for next page', optional: true },
        page_size: { type: 'number', description: 'Number of results per page' },
        total_record_count: {
          type: 'number',
          description: 'Total number of schedules',
          optional: true,
        },
      },
    },
  },
}
