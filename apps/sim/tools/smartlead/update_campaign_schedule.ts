import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SmartleadActionResponse, SmartleadCampaignIdParams } from '@/tools/smartlead/types'
import {
  actionOutputs,
  isOk,
  jsonBody,
  pathSegment,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface UpdateCampaignScheduleParams extends SmartleadCampaignIdParams {
  timezone: string
  daysOfTheWeek: number[]
  startHour: string
  endHour: string
  minTimeBetweenEmails?: number
  maxNewLeadsPerDay?: number
  scheduleStartTime?: string
}

export const updateCampaignScheduleTool: ToolConfig<
  UpdateCampaignScheduleParams,
  SmartleadActionResponse
> = {
  id: 'smartlead_update_campaign_schedule',
  name: 'Smartlead Update Campaign Schedule',
  description:
    'Sets the sending window, timezone, and throughput limits for a Smartlead campaign. A campaign cannot be started until a schedule exists.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    timezone: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'IANA timezone for the sending window, e.g. America/Los_Angeles',
    },
    daysOfTheWeek: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sending days as ISO weekday numbers, where 1 is Monday and 7 is Sunday',
      items: { type: 'number' },
    },
    startHour: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sending window start in 24-hour HH:MM format, e.g. 09:00',
    },
    endHour: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sending window end in 24-hour HH:MM format, e.g. 17:00',
    },
    minTimeBetweenEmails: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum minutes to wait between emails',
    },
    maxNewLeadsPerDay: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum new leads to contact per day',
    },
    scheduleStartTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 timestamp to begin sending, omit to start immediately',
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/schedule`, params.apiKey),
    method: 'POST',
    headers: smartleadHeaders,
    body: (params) =>
      jsonBody({
        timezone: params.timezone,
        days_of_the_week: params.daysOfTheWeek,
        start_hour: params.startHour,
        end_hour: params.endHour,
        min_time_btw_emails: params.minTimeBetweenEmails,
        max_new_leads_per_day: params.maxNewLeadsPerDay,
        schedule_start_time: params.scheduleStartTime,
      }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'schedule update')

    return {
      success: true,
      output: { success: isOk(record) },
    }
  },
  outputs: actionOutputs,
}
