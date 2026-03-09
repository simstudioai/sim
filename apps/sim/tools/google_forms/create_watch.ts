import type {
  GoogleFormsCreateWatchParams,
  GoogleFormsCreateWatchResponse,
  GoogleFormsWatch,
} from '@/tools/google_forms/types'
import { buildCreateWatchUrl } from '@/tools/google_forms/utils'
import type { ToolConfig } from '@/tools/types'

export const createWatchTool: ToolConfig<
  GoogleFormsCreateWatchParams,
  GoogleFormsCreateWatchResponse
> = {
  id: 'google_forms_create_watch',
  name: 'Google Forms: Create Watch',
  description: 'Create a notification watch for form changes (schema changes or new responses)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-forms',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Forms form ID to watch',
    },
    eventType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event type to watch: SCHEMA (form changes) or RESPONSES (new submissions)',
    },
    topicName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Cloud Pub/Sub topic name (format: projects/{project}/topics/{topic})',
    },
    watchId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom watch ID (4-63 chars, lowercase letters, numbers, hyphens)',
    },
  },

  request: {
    url: (params: GoogleFormsCreateWatchParams) => buildCreateWatchUrl(params.formId),
    method: 'POST',
    headers: (params: GoogleFormsCreateWatchParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleFormsCreateWatchParams) => ({
      watch: {
        target: {
          topic: {
            topicName: params.topicName,
          },
        },
        eventType: params.eventType,
      },
      ...(params.watchId ? { watchId: params.watchId } : {}),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as GoogleFormsWatch

    if (!response.ok) {
      const errorData = data as unknown as { error?: { message?: string } }
      return {
        success: false,
        output: {
          id: '',
          eventType: '',
          topicName: null,
          createTime: null,
          expireTime: null,
          state: null,
        },
        error: errorData.error?.message ?? 'Failed to create watch',
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        eventType: data.eventType ?? '',
        topicName: data.target?.topic?.topicName ?? null,
        createTime: data.createTime ?? null,
        expireTime: data.expireTime ?? null,
        state: data.state ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'The watch ID' },
    eventType: { type: 'string', description: 'The event type being watched' },
    topicName: { type: 'string', description: 'The Cloud Pub/Sub topic', optional: true },
    createTime: { type: 'string', description: 'When the watch was created', optional: true },
    expireTime: {
      type: 'string',
      description: 'When the watch expires (7 days after creation)',
      optional: true,
    },
    state: { type: 'string', description: 'The watch state (ACTIVE, SUSPENDED)', optional: true },
  },
}
