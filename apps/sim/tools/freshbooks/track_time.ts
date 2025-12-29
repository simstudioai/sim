import { Client } from '@freshbooks/api'
import type { TrackTimeParams, TrackTimeResponse } from '@/tools/freshbooks/types'
import type { ToolConfig } from '@/tools/types'

/**
 * FreshBooks Track Time Tool
 * Uses official @freshbooks/api SDK for billable time tracking
 */
export const freshbooksTrackTimeTool: ToolConfig<TrackTimeParams, TrackTimeResponse> = {
  id: 'freshbooks_track_time',
  name: 'FreshBooks Track Time',
  description:
    'Track billable hours for clients and projects with optional timer functionality',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'FreshBooks OAuth access token',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'FreshBooks account ID (not used by time entry API)',
    },
    businessId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'FreshBooks business ID',
    },
    clientId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Client ID for billable time',
    },
    projectId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project ID for time tracking',
    },
    serviceId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Service/task ID',
    },
    hours: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Hours worked (decimal format, e.g., 1.5 for 1 hour 30 minutes). Ignored when startTimer is true.',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of work performed',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date of work (YYYY-MM-DD, default: today)',
    },
    billable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark time as billable (default: true)',
    },
    startTimer: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start a running timer instead of logging completed time (default: false)',
    },
  },

  /**
   * SDK-based execution using @freshbooks/api Client
   * Tracks time with optional real-time timer
   */
  directExecution: async (params) => {
    try {
      // Initialize FreshBooks SDK client
      const client = new Client(params.apiKey, {
        apiUrl: 'https://api.freshbooks.com',
      })

      // Convert hours to seconds (FreshBooks uses seconds for duration)
      const durationSeconds = params.startTimer ? 0 : Math.round(params.hours * 3600)

      // Prepare time entry data
      const timeEntryData: any = {
        isLogged: !params.startTimer,
        duration: durationSeconds,
        note: params.note || '',
        startedAt: params.date ? new Date(`${params.date}T09:00:00Z`) : new Date(),
        billable: params.billable !== false,
      }

      // Add optional associations
      if (params.clientId) {
        timeEntryData.clientId = params.clientId
      }
      if (params.projectId) {
        timeEntryData.projectId = params.projectId
      }
      if (params.serviceId) {
        timeEntryData.serviceId = params.serviceId
      }

      if (params.startTimer) {
        timeEntryData.active = true
      }

      // Create time entry using SDK (data first, then businessId like other create methods)
      const response = await client.timeEntries.create(timeEntryData, params.businessId)

      if (!response.data) {
        throw new Error('FreshBooks API returned no data')
      }

      const timeEntry = response.data
      const loggedSeconds =
        typeof timeEntry.duration === 'number' ? timeEntry.duration : durationSeconds
      const loggedHours = loggedSeconds / 3600
      const timerRunning =
        typeof timeEntry.active === 'boolean' ? timeEntry.active : Boolean(params.startTimer)

      return {
        success: true,
        output: {
          time_entry: {
            id: timeEntry.id,
            client_id: timeEntry.clientId,
            project_id: timeEntry.projectId,
            hours: loggedHours,
            billable: timeEntry.billable,
            billed: timeEntry.billed || false,
            date: params.date || new Date().toISOString().split('T')[0],
            note: params.note,
            timer_running: timerRunning,
          },
          metadata: {
            time_entry_id: timeEntry.id,
            duration_hours: loggedHours,
            billable: timeEntry.billable,
            created_at: new Date().toISOString().split('T')[0],
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `FRESHBOOKS_TIME_TRACKING_ERROR: Failed to track time in FreshBooks - ${errorDetails}`,
      }
    }
  },

  outputs: {
    time_entry: {
      type: 'json',
      description: 'Created time entry with duration, billable status, and associations',
    },
    metadata: {
      type: 'json',
      description: 'Time tracking metadata',
    },
  },
}
