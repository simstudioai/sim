import type { AmplitudeSendEventParams, AmplitudeSendEventResponse } from '@/tools/amplitude/types'
import type { ToolConfig } from '@/tools/types'

export const sendEventTool: ToolConfig<AmplitudeSendEventParams, AmplitudeSendEventResponse> = {
  id: 'amplitude_send_event',
  name: 'Amplitude Send Event',
  description: 'Track an event in Amplitude using the HTTP V2 API.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Amplitude API Key',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID (required if no device_id)',
    },
    deviceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Device ID (required if no user_id)',
    },
    eventType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the event (e.g., "page_view", "purchase")',
    },
    eventProperties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of custom event properties',
    },
    userProperties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of user properties to set (supports $set, $setOnce, $add, $append, $unset)',
    },
    time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event timestamp in milliseconds since epoch',
    },
    sessionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Session start time in milliseconds since epoch',
    },
    insertId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unique ID for deduplication (within 7-day window)',
    },
    appVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Application version string',
    },
    platform: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Platform (e.g., "Web", "iOS", "Android")',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter country code',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code (e.g., "en")',
    },
    ip: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'IP address for geo-location',
    },
    price: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Price of the item purchased',
    },
    quantity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Quantity of items purchased',
    },
    revenue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Revenue amount',
    },
    productId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Product identifier',
    },
    revenueType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Revenue type (e.g., "purchase", "refund")',
    },
  },

  request: {
    url: 'https://api2.amplitude.com/2/httpapi',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const event: Record<string, unknown> = {
        event_type: params.eventType,
      }

      if (params.userId) event.user_id = params.userId
      if (params.deviceId) event.device_id = params.deviceId
      if (params.time) event.time = Number(params.time)
      if (params.sessionId) event.session_id = Number(params.sessionId)
      if (params.insertId) event.insert_id = params.insertId
      if (params.appVersion) event.app_version = params.appVersion
      if (params.platform) event.platform = params.platform
      if (params.country) event.country = params.country
      if (params.language) event.language = params.language
      if (params.ip) event.ip = params.ip
      if (params.price) event.price = Number(params.price)
      if (params.quantity) event.quantity = Number(params.quantity)
      if (params.revenue) event.revenue = Number(params.revenue)
      if (params.productId) event.product_id = params.productId
      if (params.revenueType) event.revenue_type = params.revenueType

      if (params.eventProperties) {
        try {
          event.event_properties = JSON.parse(params.eventProperties)
        } catch {
          event.event_properties = {}
        }
      }

      if (params.userProperties) {
        try {
          event.user_properties = JSON.parse(params.userProperties)
        } catch {
          event.user_properties = {}
        }
      }

      return {
        api_key: params.apiKey,
        events: [event],
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.code !== 200) {
      throw new Error(data.error || `Amplitude API error: code ${data.code}`)
    }

    return {
      success: true,
      output: {
        code: data.code ?? 200,
        eventsIngested: data.events_ingested ?? 0,
        payloadSizeBytes: data.payload_size_bytes ?? 0,
        serverUploadTime: data.server_upload_time ?? 0,
      },
    }
  },

  outputs: {
    code: {
      type: 'number',
      description: 'Response code (200 for success)',
    },
    eventsIngested: {
      type: 'number',
      description: 'Number of events ingested',
    },
    payloadSizeBytes: {
      type: 'number',
      description: 'Size of the payload in bytes',
    },
    serverUploadTime: {
      type: 'number',
      description: 'Server upload timestamp',
    },
  },
}
