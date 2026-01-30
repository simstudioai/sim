import { createLogger } from '@sim/logger'
import type { OutputProperty } from '@/tools/types'

const logger = createLogger('Zendesk')

// Base params - following Sentry pattern where subdomain is user-provided
export interface ZendeskBaseParams {
  email: string // Zendesk user email (required for API token authentication)
  apiToken: string // API token (hidden)
  subdomain: string // Zendesk subdomain (user-visible, required - e.g., "mycompany" for mycompany.zendesk.com)
}

export interface ZendeskPaginationParams {
  page?: string
  perPage?: string
}

export interface ZendeskPagingInfo {
  next_page?: string | null
  previous_page?: string | null
  count: number
}

export interface ZendeskListMetadata {
  total_returned: number
  has_more: boolean
}

export interface ZendeskResponse<T> {
  success: boolean
  output: {
    data?: T
    paging?: ZendeskPagingInfo
    metadata?: ZendeskListMetadata
    success: boolean
  }
}

// Helper function to build Zendesk API URLs
// Subdomain is always provided by user as a parameter
export function buildZendeskUrl(subdomain: string, path: string): string {
  return `https://${subdomain}.zendesk.com/api/v2${path}`
}

// Helper function for consistent error handling
export function handleZendeskError(data: any, status: number, operation: string): never {
  logger.error(`Zendesk API request failed for ${operation}`, { data, status })

  const errorMessage = data.error || data.description || data.message || 'Unknown error'
  throw new Error(`Zendesk ${operation} failed: ${errorMessage}`)
}

/**
 * Output definition for the "via" object in ticket responses.
 * Contains information about how the ticket was created.
 */
export const VIA_OUTPUT_PROPERTIES = {
  channel: {
    type: 'string',
    description: 'Channel through which the ticket was created (e.g., email, web, api)',
  },
  source: {
    type: 'object',
    description: 'Source details for the channel',
    properties: {
      from: {
        type: 'object',
        description: 'Information about the source sender',
        optional: true,
        properties: {
          address: {
            type: 'string',
            description: 'Email address or other identifier',
            optional: true,
          },
          name: { type: 'string', description: 'Name of the sender', optional: true },
        },
      },
      to: {
        type: 'object',
        description: 'Information about the recipient',
        optional: true,
        properties: {
          address: {
            type: 'string',
            description: 'Email address or other identifier',
            optional: true,
          },
          name: { type: 'string', description: 'Name of the recipient', optional: true },
        },
      },
      rel: { type: 'string', description: 'Relationship type', optional: true },
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for custom field entries in ticket responses
 */
export const CUSTOM_FIELD_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Custom field ID' },
  value: { type: 'string', description: 'Custom field value' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for satisfaction rating in ticket responses
 */
export const SATISFACTION_RATING_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Satisfaction rating ID', optional: true },
  score: { type: 'string', description: 'Rating score (e.g., good, bad, offered, unoffered)' },
  comment: { type: 'string', description: 'Comment left with the rating', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete ticket object output properties based on Zendesk API documentation.
 * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/
 */
export const TICKET_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Automatically assigned ticket ID' },
  url: { type: 'string', description: 'API URL of the ticket' },
  external_id: {
    type: 'string',
    description: 'External ID for linking to external records',
    optional: true,
  },
  via: {
    type: 'object',
    description: 'How the ticket was created',
    properties: VIA_OUTPUT_PROPERTIES,
  },
  created_at: { type: 'string', description: 'When the ticket was created (ISO 8601 format)' },
  updated_at: { type: 'string', description: 'When the ticket was last updated (ISO 8601 format)' },
  type: {
    type: 'string',
    description: 'Ticket type (problem, incident, question, task)',
    optional: true,
  },
  subject: { type: 'string', description: 'Subject of the ticket' },
  raw_subject: { type: 'string', description: 'Subject of the ticket as entered by the requester' },
  description: { type: 'string', description: 'Read-only first comment on the ticket' },
  priority: {
    type: 'string',
    description: 'Priority level (low, normal, high, urgent)',
    optional: true,
  },
  status: {
    type: 'string',
    description: 'Ticket status (new, open, pending, hold, solved, closed)',
  },
  recipient: { type: 'string', description: 'Original recipient email address', optional: true },
  requester_id: { type: 'number', description: 'User ID of the ticket requester' },
  submitter_id: { type: 'number', description: 'User ID of the ticket submitter' },
  assignee_id: {
    type: 'number',
    description: 'User ID of the agent assigned to the ticket',
    optional: true,
  },
  organization_id: {
    type: 'number',
    description: 'Organization ID of the requester',
    optional: true,
  },
  group_id: { type: 'number', description: 'Group ID assigned to the ticket', optional: true },
  collaborator_ids: {
    type: 'array',
    description: 'User IDs of collaborators (CC)',
    items: { type: 'number', description: 'Collaborator user ID' },
  },
  follower_ids: {
    type: 'array',
    description: 'User IDs of followers',
    items: { type: 'number', description: 'Follower user ID' },
  },
  email_cc_ids: {
    type: 'array',
    description: 'User IDs of email CCs',
    items: { type: 'number', description: 'Email CC user ID' },
  },
  forum_topic_id: {
    type: 'number',
    description: 'Topic ID in the community forum',
    optional: true,
  },
  problem_id: {
    type: 'number',
    description: 'For incident tickets, the ID of the associated problem ticket',
    optional: true,
  },
  has_incidents: { type: 'boolean', description: 'Whether the ticket has incident tickets linked' },
  is_public: { type: 'boolean', description: 'Whether the first comment is public' },
  due_at: {
    type: 'string',
    description: 'Due date for task tickets (ISO 8601 format)',
    optional: true,
  },
  tags: {
    type: 'array',
    description: 'Tags associated with the ticket',
    items: { type: 'string', description: 'Tag name' },
  },
  custom_fields: {
    type: 'array',
    description: 'Custom ticket fields',
    items: {
      type: 'object',
      properties: CUSTOM_FIELD_OUTPUT_PROPERTIES,
    },
  },
  custom_status_id: { type: 'number', description: 'Custom status ID', optional: true },
  satisfaction_rating: {
    type: 'object',
    description: 'Customer satisfaction rating',
    optional: true,
    properties: SATISFACTION_RATING_OUTPUT_PROPERTIES,
  },
  sharing_agreement_ids: {
    type: 'array',
    description: 'Sharing agreement IDs',
    items: { type: 'number', description: 'Sharing agreement ID' },
  },
  followup_ids: {
    type: 'array',
    description: 'IDs of follow-up tickets',
    items: { type: 'number', description: 'Follow-up ticket ID' },
  },
  brand_id: { type: 'number', description: 'Brand ID the ticket belongs to' },
  allow_attachments: { type: 'boolean', description: 'Whether attachments are allowed' },
  allow_channelback: { type: 'boolean', description: 'Whether channelback is enabled' },
  from_messaging_channel: {
    type: 'boolean',
    description: 'Whether the ticket originated from a messaging channel',
  },
  ticket_form_id: { type: 'number', description: 'Ticket form ID', optional: true },
  generated_timestamp: { type: 'number', description: 'Unix timestamp of the ticket generation' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for user photo object
 */
export const USER_PHOTO_OUTPUT_PROPERTIES = {
  content_url: { type: 'string', description: 'URL to the photo' },
  file_name: { type: 'string', description: 'Photo file name' },
  size: { type: 'number', description: 'File size in bytes' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete user object output properties based on Zendesk API documentation.
 * @see https://developer.zendesk.com/api-reference/ticketing/users/users/
 */
export const USER_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Automatically assigned user ID' },
  url: { type: 'string', description: 'API URL of the user' },
  name: { type: 'string', description: 'User name' },
  email: { type: 'string', description: 'Primary email address' },
  created_at: { type: 'string', description: 'When the user was created (ISO 8601 format)' },
  updated_at: { type: 'string', description: 'When the user was last updated (ISO 8601 format)' },
  time_zone: { type: 'string', description: 'Time zone (e.g., Eastern Time (US & Canada))' },
  iana_time_zone: { type: 'string', description: 'IANA time zone (e.g., America/New_York)' },
  phone: { type: 'string', description: 'Phone number', optional: true },
  shared_phone_number: { type: 'boolean', description: 'Whether the phone number is shared' },
  photo: {
    type: 'object',
    description: 'User photo details',
    optional: true,
    properties: USER_PHOTO_OUTPUT_PROPERTIES,
  },
  locale: { type: 'string', description: 'Locale (e.g., en-US)' },
  locale_id: { type: 'number', description: 'Locale ID' },
  organization_id: { type: 'number', description: 'Primary organization ID', optional: true },
  role: { type: 'string', description: 'User role (end-user, agent, admin)' },
  role_type: { type: 'number', description: 'Role type identifier', optional: true },
  custom_role_id: { type: 'number', description: 'Custom role ID', optional: true },
  active: { type: 'boolean', description: 'Whether the user is active (false if deleted)' },
  verified: { type: 'boolean', description: 'Whether any user identity has been verified' },
  alias: { type: 'string', description: 'Alias displayed to end users', optional: true },
  details: { type: 'string', description: 'Details about the user', optional: true },
  notes: { type: 'string', description: 'Notes about the user', optional: true },
  signature: { type: 'string', description: 'User signature for email replies', optional: true },
  default_group_id: {
    type: 'number',
    description: 'Default group ID for the user',
    optional: true,
  },
  tags: {
    type: 'array',
    description: 'Tags associated with the user',
    items: { type: 'string', description: 'Tag name' },
  },
  external_id: {
    type: 'string',
    description: 'External ID for linking to external records',
    optional: true,
  },
  restricted_agent: { type: 'boolean', description: 'Whether the agent has restrictions' },
  suspended: { type: 'boolean', description: 'Whether the user is suspended' },
  moderator: { type: 'boolean', description: 'Whether the user has moderator permissions' },
  chat_only: { type: 'boolean', description: 'Whether the user is a chat-only agent' },
  only_private_comments: {
    type: 'boolean',
    description: 'Whether the user can only create private comments',
  },
  two_factor_auth_enabled: { type: 'boolean', description: 'Whether two-factor auth is enabled' },
  last_login_at: {
    type: 'string',
    description: 'Last login time (ISO 8601 format)',
    optional: true,
  },
  ticket_restriction: {
    type: 'string',
    description: 'Ticket access restriction (organization, groups, assigned, requested)',
    optional: true,
  },
  user_fields: {
    type: 'json',
    description: 'Custom user fields (dynamic key-value pairs)',
    optional: true,
  },
  shared: { type: 'boolean', description: 'Whether the user is shared from a different Zendesk' },
  shared_agent: {
    type: 'boolean',
    description: 'Whether the agent is shared from a different Zendesk',
  },
  remote_photo_url: { type: 'string', description: 'URL to a remote photo', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete organization object output properties based on Zendesk API documentation.
 * @see https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/
 */
export const ORGANIZATION_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Automatically assigned organization ID' },
  url: { type: 'string', description: 'API URL of the organization' },
  name: { type: 'string', description: 'Unique organization name' },
  domain_names: {
    type: 'array',
    description: 'Domain names for automatic user assignment',
    items: { type: 'string', description: 'Domain name' },
  },
  details: { type: 'string', description: 'Details about the organization', optional: true },
  notes: { type: 'string', description: 'Notes about the organization', optional: true },
  group_id: {
    type: 'number',
    description: 'Group ID for auto-routing new tickets',
    optional: true,
  },
  shared_tickets: { type: 'boolean', description: 'Whether end users can see each others tickets' },
  shared_comments: {
    type: 'boolean',
    description: 'Whether end users can see each others comments',
  },
  tags: {
    type: 'array',
    description: 'Tags associated with the organization',
    items: { type: 'string', description: 'Tag name' },
  },
  organization_fields: {
    type: 'json',
    description: 'Custom organization fields (dynamic key-value pairs)',
    optional: true,
  },
  created_at: {
    type: 'string',
    description: 'When the organization was created (ISO 8601 format)',
  },
  updated_at: {
    type: 'string',
    description: 'When the organization was last updated (ISO 8601 format)',
  },
  external_id: {
    type: 'string',
    description: 'External ID for linking to external records',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Pagination output properties for list endpoints
 */
export const PAGING_OUTPUT_PROPERTIES = {
  next_page: { type: 'string', description: 'URL for next page of results', optional: true },
  previous_page: {
    type: 'string',
    description: 'URL for previous page of results',
    optional: true,
  },
  count: { type: 'number', description: 'Total count of items' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete paging output definition
 */
export const PAGING_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pagination information',
  properties: PAGING_OUTPUT_PROPERTIES,
}

/**
 * Metadata output properties for list responses
 */
export const METADATA_OUTPUT_PROPERTIES = {
  total_returned: { type: 'number', description: 'Number of items returned in this response' },
  has_more: { type: 'boolean', description: 'Whether more items are available' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete metadata output definition
 */
export const METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Response metadata',
  properties: METADATA_OUTPUT_PROPERTIES,
}

/**
 * Complete tickets array output definition with nested properties
 */
export const TICKETS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of ticket objects',
  items: {
    type: 'object',
    properties: TICKET_OUTPUT_PROPERTIES,
  },
}

/**
 * Complete users array output definition with nested properties
 */
export const USERS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of user objects',
  items: {
    type: 'object',
    properties: USER_OUTPUT_PROPERTIES,
  },
}

/**
 * Complete organizations array output definition with nested properties
 */
export const ORGANIZATIONS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of organization objects',
  items: {
    type: 'object',
    properties: ORGANIZATION_OUTPUT_PROPERTIES,
  },
}

/**
 * Job status result item output properties for bulk operations.
 * @see https://developer.zendesk.com/api-reference/ticketing/ticket-management/job_statuses/
 */
export const JOB_RESULT_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'ID of the created or updated resource' },
  index: { type: 'number', description: 'Position of the result in the batch', optional: true },
  action: {
    type: 'string',
    description: 'Action performed (e.g., create, update)',
    optional: true,
  },
  success: { type: 'boolean', description: 'Whether the operation succeeded' },
  status: {
    type: 'string',
    description: 'Status message (e.g., Updated, Created)',
    optional: true,
  },
  error: { type: 'string', description: 'Error message if operation failed', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Job status output properties for bulk operation responses.
 * @see https://developer.zendesk.com/api-reference/ticketing/ticket-management/job_statuses/
 */
export const JOB_STATUS_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Automatically assigned job ID' },
  url: { type: 'string', description: 'URL to poll for status updates' },
  status: {
    type: 'string',
    description: 'Current job status (queued, working, failed, completed)',
  },
  job_type: { type: 'string', description: 'Category of background task' },
  total: { type: 'number', description: 'Total number of tasks in this job' },
  progress: { type: 'number', description: 'Number of tasks already completed' },
  message: { type: 'string', description: 'Message from the job worker', optional: true },
  results: {
    type: 'array',
    description: 'Array of result objects from the job',
    optional: true,
    items: {
      type: 'object',
      properties: JOB_RESULT_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete job status output definition
 */
export const JOB_STATUS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Job status object for bulk operations',
  properties: JOB_STATUS_OUTPUT_PROPERTIES,
}
