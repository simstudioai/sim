import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonSnoozeIssue')

export interface PylonSnoozeIssueParams {
  apiToken: string
  issueId: string
  snoozeUntil: string
}

export interface PylonSnoozeIssueResponse {
  success: boolean
  output: {
    issue: any
    metadata: {
      operation: 'snooze_issue'
      issueId: string
      snoozeUntil: string
    }
    success: boolean
  }
}

export const pylonSnoozeIssueTool: ToolConfig<PylonSnoozeIssueParams, PylonSnoozeIssueResponse> = {
  id: 'pylon_snooze_issue',
  name: 'Snooze Issue in Pylon',
  description: 'Postpone issue visibility until specified time',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    issueId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the issue to snooze',
    },
    snoozeUntil: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RFC3339 timestamp when issue should reappear (e.g., 2024-01-01T00:00:00Z)',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/issues/${params?.issueId || ''}/snooze`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      snooze_until: params?.snoozeUntil || '',
    }),
  },

  transformResponse: async (response: Response, params?: PylonSnoozeIssueParams) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'snooze_issue')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        issue: data.data,
        metadata: {
          operation: 'snooze_issue' as const,
          issueId: params?.issueId || '',
          snoozeUntil: params?.snoozeUntil || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Snoozed issue data',
      properties: {
        issue: { type: 'object', description: 'Snoozed issue object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
