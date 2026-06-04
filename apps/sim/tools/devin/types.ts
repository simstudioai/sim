import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface DevinCreateSessionParams {
  apiKey: string
  orgId: string
  prompt: string
  playbookId?: string
  maxAcuLimit?: number
  tags?: string | string[]
}

export interface DevinGetSessionParams {
  apiKey: string
  orgId: string
  sessionId: string
}

export interface DevinListSessionsParams {
  apiKey: string
  orgId: string
  limit?: number
  after?: string
}

export interface DevinSendMessageParams {
  apiKey: string
  orgId: string
  sessionId: string
  message: string
}

export interface DevinListSessionMessagesParams {
  apiKey: string
  orgId: string
  sessionId: string
  limit?: number
  after?: string
}

export interface DevinListSessionAttachmentsParams {
  apiKey: string
  orgId: string
  sessionId: string
}

export interface DevinGetSessionTagsParams {
  apiKey: string
  orgId: string
  sessionId: string
}

export interface DevinAppendSessionTagsParams {
  apiKey: string
  orgId: string
  sessionId: string
  tags: string | string[]
}

export interface DevinReplaceSessionTagsParams {
  apiKey: string
  orgId: string
  sessionId: string
  tags: string | string[]
}

export interface DevinArchiveSessionParams {
  apiKey: string
  orgId: string
  sessionId: string
}

export interface DevinTerminateSessionParams {
  apiKey: string
  orgId: string
  sessionId: string
  archive?: boolean
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
    description: 'Tags associated with the session (array of strings)',
  },
  pullRequests: {
    type: 'json',
    description: 'Pull requests created during the session ([{pr_url, pr_state}])',
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
  isArchived: {
    type: 'boolean',
    description: 'Whether the session is archived',
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
    description: 'Session tags (array of strings)',
  },
  acusConsumed: {
    type: 'number',
    description: 'ACUs consumed by the session',
    optional: true,
  },
  pullRequests: {
    type: 'json',
    description: 'Pull requests created during the session ([{pr_url, pr_state}])',
  },
  playbookId: {
    type: 'string',
    description: 'Associated playbook ID',
    optional: true,
  },
  isArchived: {
    type: 'boolean',
    description: 'Whether the session is archived',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const DEVIN_SESSION_MESSAGE_PROPERTIES = {
  eventId: {
    type: 'string',
    description: 'Unique identifier for the message event',
  },
  source: {
    type: 'string',
    description: 'Origin of the message (devin or user)',
  },
  message: {
    type: 'string',
    description: 'The message content',
  },
  createdAt: {
    type: 'number',
    description: 'Unix timestamp when the message was created',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const DEVIN_SESSION_ATTACHMENT_PROPERTIES = {
  attachmentId: {
    type: 'string',
    description: 'Unique identifier for the attachment',
  },
  name: {
    type: 'string',
    description: 'Attachment file name',
  },
  url: {
    type: 'string',
    description: 'URL to download the attachment',
  },
  source: {
    type: 'string',
    description: 'Origin of the attachment (devin or user)',
  },
  contentType: {
    type: 'string',
    description: 'MIME type of the attachment',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

interface DevinSessionOutput {
  sessionId: string
  url: string
  status: string
  statusDetail: string | null
  title: string | null
  createdAt: number | null
  updatedAt: number | null
  acusConsumed: number | null
  tags: string[]
  pullRequests: Array<{ pr_url: string; pr_state: string | null }>
  structuredOutput: Record<string, unknown> | null
  playbookId: string | null
  isArchived: boolean
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
      tags: string[]
      acusConsumed: number | null
      pullRequests: Array<{ pr_url: string; pr_state: string | null }>
      playbookId: string | null
      isArchived: boolean
    }>
    endCursor: string | null
    hasNextPage: boolean
    total: number | null
  }
}

export interface DevinSendMessageResponse extends ToolResponse {
  output: DevinSessionOutput
}

export interface DevinListSessionMessagesResponse extends ToolResponse {
  output: {
    messages: Array<{
      eventId: string
      source: string
      message: string
      createdAt: number | null
    }>
    endCursor: string | null
    hasNextPage: boolean
    total: number | null
  }
}

export interface DevinListSessionAttachmentsResponse extends ToolResponse {
  output: {
    attachments: Array<{
      attachmentId: string
      name: string
      url: string
      source: string
      contentType: string | null
    }>
  }
}

export interface DevinSessionTagsResponse extends ToolResponse {
  output: {
    tags: string[]
  }
}

export interface DevinArchiveSessionResponse extends ToolResponse {
  output: DevinSessionOutput
}

export interface DevinTerminateSessionResponse extends ToolResponse {
  output: DevinSessionOutput
}
