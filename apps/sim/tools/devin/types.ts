import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface DevinCreateSessionParams {
  apiKey: string
  prompt: string
  playbookId?: string
  maxAcuLimit?: number
  tags?: string
}

export interface DevinGetSessionParams {
  apiKey: string
  sessionId: string
}

export interface DevinListSessionsParams {
  apiKey: string
  limit?: number
}

export interface DevinSendMessageParams {
  apiKey: string
  sessionId: string
  message: string
}

export const DEVIN_SESSION_OUTPUT_PROPERTIES = {
  sessionId: {
    type: 'string',
    description: 'Unique identifier for the session',
  },
  url: {
    type: 'string',
    description: 'URL to view the session in the Devin UI',
  },
  status: {
    type: 'string',
    description: 'Session status (new, claimed, running, exit, error, suspended, resuming)',
  },
  statusDetail: {
    type: 'string',
    description:
      'Detailed status (working, waiting_for_user, waiting_for_approval, finished, inactivity, etc.)',
    optional: true,
  },
  title: {
    type: 'string',
    description: 'Session title',
    optional: true,
  },
  createdAt: {
    type: 'number',
    description: 'Unix timestamp when the session was created',
    optional: true,
  },
  updatedAt: {
    type: 'number',
    description: 'Unix timestamp when the session was last updated',
    optional: true,
  },
  acusConsumed: {
    type: 'number',
    description: 'ACUs consumed by the session',
    optional: true,
  },
  tags: {
    type: 'json',
    description: 'Tags associated with the session',
    optional: true,
  },
  pullRequests: {
    type: 'json',
    description: 'Pull requests created during the session',
    optional: true,
  },
  structuredOutput: {
    type: 'json',
    description: 'Structured output from the session',
    optional: true,
  },
  playbookId: {
    type: 'string',
    description: 'Associated playbook ID',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const DEVIN_SESSION_LIST_ITEM_PROPERTIES = {
  sessionId: {
    type: 'string',
    description: 'Unique identifier for the session',
  },
  url: {
    type: 'string',
    description: 'URL to view the session',
  },
  status: {
    type: 'string',
    description: 'Session status',
  },
  statusDetail: {
    type: 'string',
    description: 'Detailed status',
    optional: true,
  },
  title: {
    type: 'string',
    description: 'Session title',
    optional: true,
  },
  createdAt: {
    type: 'number',
    description: 'Creation timestamp (Unix)',
    optional: true,
  },
  updatedAt: {
    type: 'number',
    description: 'Last updated timestamp (Unix)',
    optional: true,
  },
  tags: {
    type: 'json',
    description: 'Session tags',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface DevinSessionOutput {
  sessionId: string
  url: string
  status: string
  statusDetail: string | null
  title: string | null
  createdAt: number | null
  updatedAt: number | null
  acusConsumed: number | null
  tags: string[] | null
  pullRequests: Array<{ pr_url: string; pr_state: string | null }> | null
  structuredOutput: Record<string, unknown> | null
  playbookId: string | null
}

export interface DevinCreateSessionResponse extends ToolResponse {
  output: DevinSessionOutput
}

export interface DevinGetSessionResponse extends ToolResponse {
  output: DevinSessionOutput
}

export interface DevinListSessionsResponse extends ToolResponse {
  output: {
    sessions: Array<{
      sessionId: string
      url: string
      status: string
      statusDetail: string | null
      title: string | null
      createdAt: number | null
      updatedAt: number | null
      tags: string[] | null
    }>
  }
}

export interface DevinSendMessageResponse extends ToolResponse {
  output: DevinSessionOutput
}
