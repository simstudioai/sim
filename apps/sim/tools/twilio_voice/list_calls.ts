import { createLogger } from '@/lib/logs/console/logger'
import type { TwilioListCallsOutput, TwilioListCallsParams } from '@/tools/twilio_voice/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('TwilioVoiceListCallsTool')

export const listCallsTool: ToolConfig<TwilioListCallsParams, TwilioListCallsOutput> = {
  id: 'twilio_voice_list_calls',
  name: 'Twilio Voice List Calls',
  description: 'Retrieve a list of calls made to and from an account.',
  version: '1.0.0',

  params: {
    accountSid: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Twilio Account SID',
    },
    authToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Twilio Auth Token',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by calls to this phone number',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by calls from this phone number',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by call status (queued, ringing, in-progress, completed, etc.)',
    },
    startTimeAfter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter calls that started on or after this date (YYYY-MM-DD)',
    },
    startTimeBefore: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter calls that started on or before this date (YYYY-MM-DD)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of records to return (max 1000, default 50)',
    },
  },

  request: {
    url: (params) => {
      if (!params.accountSid) {
        throw new Error('Twilio Account SID is required')
      }
      if (!params.accountSid.startsWith('AC')) {
        throw new Error(
          `Invalid Account SID format. Account SID must start with "AC" (you provided: ${params.accountSid.substring(0, 2)}...)`
        )
      }

      const baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/Calls.json`
      const queryParams = new URLSearchParams()

      if (params.to) queryParams.append('To', params.to)
      if (params.from) queryParams.append('From', params.from)
      if (params.status) queryParams.append('Status', params.status)
      if (params.startTimeAfter) queryParams.append('StartTime>', params.startTimeAfter)
      if (params.startTimeBefore) queryParams.append('StartTime<', params.startTimeBefore)
      if (params.pageSize) queryParams.append('PageSize', Number(params.pageSize).toString())

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accountSid || !params.authToken) {
        throw new Error('Twilio credentials are required')
      }
      const authToken = Buffer.from(`${params.accountSid}:${params.authToken}`).toString('base64')
      return {
        Authorization: `Basic ${authToken}`,
      }
    },
  },

  transformResponse: async (response, params) => {
    const data = await response.json()

    logger.info('Twilio List Calls Response:', { total: data.calls?.length || 0 })

    if (data.error_code) {
      return {
        success: false,
        output: {
          success: false,
          calls: [],
          error: data.message || data.error_message || 'Failed to retrieve calls',
        },
        error: data.message || data.error_message || 'Failed to retrieve calls',
      }
    }

    const authToken = Buffer.from(`${params?.accountSid}:${params?.authToken}`).toString('base64')

    const calls = await Promise.all(
      (data.calls || []).map(async (call: any) => {
        let recordingSids: string[] = []
        if (call.subresource_uris?.recordings) {
          try {
            const recordingsUrl = `https://api.twilio.com${call.subresource_uris.recordings}`
            const recordingsResponse = await fetch(recordingsUrl, {
              method: 'GET',
              headers: { Authorization: `Basic ${authToken}` },
            })

            if (recordingsResponse.ok) {
              const recordingsData = await recordingsResponse.json()
              recordingSids = (recordingsData.recordings || []).map((rec: any) => rec.sid)
            }
          } catch (error) {
            logger.warn(`Failed to fetch recordings for call ${call.sid}:`, error)
          }
        }

        return {
          callSid: call.sid,
          from: call.from,
          to: call.to,
          status: call.status,
          direction: call.direction,
          duration: call.duration ? Number.parseInt(call.duration, 10) : null,
          price: call.price,
          priceUnit: call.price_unit,
          startTime: call.start_time,
          endTime: call.end_time,
          dateCreated: call.date_created,
          recordingSids,
        }
      })
    )

    logger.info('Transformed calls with recordings:', {
      totalCalls: calls.length,
      callsWithRecordings: calls.filter((c) => c.recordingSids.length > 0).length,
    })

    return {
      success: true,
      output: {
        success: true,
        calls,
        total: calls.length,
        page: data.page,
        pageSize: data.page_size,
      },
      error: undefined,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the calls were successfully retrieved' },
    calls: { type: 'array', description: 'Array of call objects' },
    total: { type: 'number', description: 'Total number of calls returned' },
    page: { type: 'number', description: 'Current page number' },
    pageSize: { type: 'number', description: 'Number of calls per page' },
    error: { type: 'string', description: 'Error message if retrieval failed' },
  },
}
