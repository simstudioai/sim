import { createLogger } from '@sim/logger'
import type { OutputProperty } from '@/tools/types'

const logger = createLogger('Intercom')

/**
 * Shared output property definitions for Intercom API responses.
 * These are reusable across all Intercom tools to ensure consistency.
 * Based on official Intercom API documentation:
 * - https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/contact
 * - https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/conversation
 * - https://developers.intercom.com/docs/references/rest-api/api.intercom.io/companies/company
 * - https://developers.intercom.com/docs/references/rest-api/api.intercom.io/admins/admin
 * - https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tickets/ticket
 */

// ============================================================================
// Location Output Properties
// ============================================================================

/**
 * Output definition for location object (nested in contact)
 * Based on Intercom API location object structure
 */
export const INTERCOM_LOCATION_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (location)' },
  city: { type: 'string', description: 'City name', optional: true },
  region: { type: 'string', description: 'Region or state name', optional: true },
  country: { type: 'string', description: 'Country name', optional: true },
  country_code: { type: 'string', description: 'ISO country code', optional: true },
  continent_code: { type: 'string', description: 'Continent code', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete location output definition
 */
export const INTERCOM_LOCATION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Location information for the contact',
  optional: true,
  properties: INTERCOM_LOCATION_OUTPUT_PROPERTIES,
}

// ============================================================================
// Social Profiles Output Properties
// ============================================================================

/**
 * Output definition for social profile object
 */
export const INTERCOM_SOCIAL_PROFILE_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Social network type (e.g., twitter, facebook)' },
  name: { type: 'string', description: 'Social network name' },
  url: { type: 'string', description: 'Profile URL', optional: true },
  username: { type: 'string', description: 'Username on the social network', optional: true },
  id: { type: 'string', description: 'User ID on the social network', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete social profiles output definition
 */
export const INTERCOM_SOCIAL_PROFILES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Social profiles of the contact',
  optional: true,
  properties: {
    type: { type: 'string', description: 'Object type (social_profile.list)' },
    data: {
      type: 'array',
      description: 'Array of social profile objects',
      items: {
        type: 'object',
        properties: INTERCOM_SOCIAL_PROFILE_OUTPUT_PROPERTIES,
      },
    },
  },
}

// ============================================================================
// List Reference Output Properties (tags, notes, companies on contact)
// ============================================================================

/**
 * Output definition for list reference objects (used for tags, notes, companies on contacts)
 */
export const INTERCOM_LIST_REFERENCE_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'List type identifier' },
  url: { type: 'string', description: 'URL to fetch full list' },
  data: { type: 'array', description: 'Array of objects (up to 10)' },
  has_more: { type: 'boolean', description: 'Whether there are more items beyond this list' },
  total_count: { type: 'number', description: 'Total number of items' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete list reference output definition
 */
export const INTERCOM_LIST_REFERENCE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'List reference with metadata',
  properties: INTERCOM_LIST_REFERENCE_OUTPUT_PROPERTIES,
}

// ============================================================================
// Tag Output Properties
// ============================================================================

/**
 * Output definition for tag objects
 */
export const INTERCOM_TAG_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the tag' },
  type: { type: 'string', description: 'Object type (tag)' },
  name: { type: 'string', description: 'Name of the tag' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete tag output definition
 */
export const INTERCOM_TAG_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Intercom tag object',
  properties: INTERCOM_TAG_OUTPUT_PROPERTIES,
}

/**
 * Tags array output definition for list endpoints
 */
export const INTERCOM_TAGS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of tag objects',
  items: {
    type: 'object',
    properties: INTERCOM_TAG_OUTPUT_PROPERTIES,
  },
}

// ============================================================================
// Admin Output Properties
// ============================================================================

/**
 * Output definition for admin avatar object
 */
export const INTERCOM_AVATAR_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (avatar)' },
  image_url: { type: 'string', description: 'URL to avatar image', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for admin objects
 */
export const INTERCOM_ADMIN_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the admin' },
  type: { type: 'string', description: 'Object type (admin)' },
  name: { type: 'string', description: 'Name of the admin' },
  email: { type: 'string', description: 'Email address of the admin' },
  job_title: { type: 'string', description: 'Job title', optional: true },
  away_mode_enabled: {
    type: 'boolean',
    description: 'Whether the admin is currently in away mode',
  },
  away_mode_reassign: {
    type: 'boolean',
    description: 'Whether to automatically reassign conversations when away',
  },
  has_inbox_seat: {
    type: 'boolean',
    description: 'Whether admin has a paid inbox seat',
  },
  team_ids: {
    type: 'array',
    description: 'IDs of teams the admin belongs to',
    items: { type: 'number', description: 'Team ID' },
  },
  avatar: {
    type: 'object',
    description: 'Avatar image information',
    optional: true,
    properties: INTERCOM_AVATAR_OUTPUT_PROPERTIES,
  },
  email_verified: {
    type: 'boolean',
    description: 'Whether the admin email is verified',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete admin output definition
 */
export const INTERCOM_ADMIN_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Intercom admin object',
  properties: INTERCOM_ADMIN_OUTPUT_PROPERTIES,
}

/**
 * Admins array output definition for list endpoints
 */
export const INTERCOM_ADMINS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of admin objects',
  items: {
    type: 'object',
    properties: INTERCOM_ADMIN_OUTPUT_PROPERTIES,
  },
}

// ============================================================================
// Contact Output Properties
// ============================================================================

/**
 * Core contact properties (common fields)
 */
export const INTERCOM_CONTACT_CORE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the contact' },
  type: { type: 'string', description: 'Object type (contact)' },
  role: { type: 'string', description: 'Role of the contact (user or lead)' },
  email: { type: 'string', description: 'Email address of the contact', optional: true },
  email_domain: { type: 'string', description: 'Email domain of the contact', optional: true },
  phone: { type: 'string', description: 'Phone number of the contact', optional: true },
  name: { type: 'string', description: 'Name of the contact', optional: true },
  avatar: { type: 'string', description: 'Avatar URL of the contact', optional: true },
  owner_id: {
    type: 'string',
    description: 'ID of the admin assigned account ownership',
    optional: true,
  },
  external_id: {
    type: 'string',
    description: 'External identifier provided by the client',
    optional: true,
  },
  workspace_id: { type: 'string', description: 'Workspace ID the contact belongs to' },
} as const satisfies Record<string, OutputProperty>

/**
 * Contact timestamp properties
 */
export const INTERCOM_CONTACT_TIMESTAMP_OUTPUT_PROPERTIES = {
  created_at: { type: 'number', description: 'Unix timestamp when contact was created' },
  updated_at: { type: 'number', description: 'Unix timestamp when contact was last updated' },
  signed_up_at: {
    type: 'number',
    description: 'Unix timestamp when user signed up',
    optional: true,
  },
  last_seen_at: {
    type: 'number',
    description: 'Unix timestamp when user was last seen',
    optional: true,
  },
  last_contacted_at: {
    type: 'number',
    description: 'Unix timestamp when contact was last contacted',
    optional: true,
  },
  last_replied_at: {
    type: 'number',
    description: 'Unix timestamp when contact last replied',
    optional: true,
  },
  last_email_opened_at: {
    type: 'number',
    description: 'Unix timestamp when contact last opened an email',
    optional: true,
  },
  last_email_clicked_at: {
    type: 'number',
    description: 'Unix timestamp when contact last clicked an email link',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Contact behavior properties
 */
export const INTERCOM_CONTACT_BEHAVIOR_OUTPUT_PROPERTIES = {
  has_hard_bounced: {
    type: 'boolean',
    description: 'Whether email to this contact has hard bounced',
    optional: true,
  },
  marked_email_as_spam: {
    type: 'boolean',
    description: 'Whether contact marked email as spam',
    optional: true,
  },
  unsubscribed_from_emails: {
    type: 'boolean',
    description: 'Whether contact is unsubscribed from emails',
    optional: true,
  },
  browser: { type: 'string', description: 'Browser used by contact', optional: true },
  browser_version: { type: 'string', description: 'Browser version', optional: true },
  browser_language: { type: 'string', description: 'Browser language setting', optional: true },
  os: { type: 'string', description: 'Operating system', optional: true },
  language_override: { type: 'string', description: 'Language override setting', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete contact output properties combining all contact-related properties
 */
export const INTERCOM_CONTACT_OUTPUT_PROPERTIES = {
  ...INTERCOM_CONTACT_CORE_OUTPUT_PROPERTIES,
  ...INTERCOM_CONTACT_TIMESTAMP_OUTPUT_PROPERTIES,
  ...INTERCOM_CONTACT_BEHAVIOR_OUTPUT_PROPERTIES,
  custom_attributes: { type: 'object', description: 'Custom attributes set on the contact' },
  tags: {
    type: 'object',
    description: 'Tags associated with the contact (up to 10 displayed)',
    optional: true,
    properties: INTERCOM_LIST_REFERENCE_OUTPUT_PROPERTIES,
  },
  notes: {
    type: 'object',
    description: 'Notes associated with the contact (up to 10 displayed)',
    optional: true,
    properties: INTERCOM_LIST_REFERENCE_OUTPUT_PROPERTIES,
  },
  companies: {
    type: 'object',
    description: 'Companies associated with the contact (up to 10 displayed)',
    optional: true,
    properties: INTERCOM_LIST_REFERENCE_OUTPUT_PROPERTIES,
  },
  location: INTERCOM_LOCATION_OUTPUT,
  social_profiles: INTERCOM_SOCIAL_PROFILES_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete contact output definition
 */
export const INTERCOM_CONTACT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Intercom contact object',
  properties: INTERCOM_CONTACT_OUTPUT_PROPERTIES,
}

/**
 * Contacts array output definition for list/search endpoints
 */
export const INTERCOM_CONTACTS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of contact objects',
  items: {
    type: 'object',
    properties: INTERCOM_CONTACT_OUTPUT_PROPERTIES,
  },
}

// ============================================================================
// Company Output Properties
// ============================================================================

/**
 * Output definition for company plan object
 */
export const INTERCOM_PLAN_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (plan)' },
  id: { type: 'string', description: 'Plan ID' },
  name: { type: 'string', description: 'Plan name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for segment object
 */
export const INTERCOM_SEGMENT_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (segment)' },
  id: { type: 'string', description: 'Segment ID' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for company tag list
 */
export const INTERCOM_COMPANY_TAGS_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (tag.list)' },
  tags: {
    type: 'array',
    description: 'Array of tag objects',
    items: {
      type: 'object',
      properties: INTERCOM_TAG_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for company segments list
 */
export const INTERCOM_COMPANY_SEGMENTS_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (segment.list)' },
  segments: {
    type: 'array',
    description: 'Array of segment objects',
    items: {
      type: 'object',
      properties: INTERCOM_SEGMENT_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Core company properties
 */
export const INTERCOM_COMPANY_CORE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the company' },
  type: { type: 'string', description: 'Object type (company)' },
  app_id: { type: 'string', description: 'Intercom app ID' },
  company_id: { type: 'string', description: 'External company identifier provided by client' },
  name: { type: 'string', description: 'Name of the company', optional: true },
  website: { type: 'string', description: 'Company website URL', optional: true },
  industry: { type: 'string', description: 'Industry the company operates in', optional: true },
  size: { type: 'number', description: 'Number of employees', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Company metrics properties
 */
export const INTERCOM_COMPANY_METRICS_OUTPUT_PROPERTIES = {
  monthly_spend: {
    type: 'number',
    description: 'Monthly revenue from this company',
    optional: true,
  },
  session_count: { type: 'number', description: 'Number of sessions', optional: true },
  user_count: { type: 'number', description: 'Number of users in the company', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Company timestamp properties
 */
export const INTERCOM_COMPANY_TIMESTAMP_OUTPUT_PROPERTIES = {
  created_at: { type: 'number', description: 'Unix timestamp when company was created' },
  updated_at: { type: 'number', description: 'Unix timestamp when company was last updated' },
  remote_created_at: {
    type: 'number',
    description: 'Unix timestamp when company was created externally',
    optional: true,
  },
  last_request_at: {
    type: 'number',
    description: 'Unix timestamp of last request from company',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete company output properties
 */
export const INTERCOM_COMPANY_OUTPUT_PROPERTIES = {
  ...INTERCOM_COMPANY_CORE_OUTPUT_PROPERTIES,
  ...INTERCOM_COMPANY_METRICS_OUTPUT_PROPERTIES,
  ...INTERCOM_COMPANY_TIMESTAMP_OUTPUT_PROPERTIES,
  plan: {
    type: 'object',
    description: 'Company plan information',
    optional: true,
    properties: INTERCOM_PLAN_OUTPUT_PROPERTIES,
  },
  custom_attributes: { type: 'object', description: 'Custom attributes', optional: true },
  tags: {
    type: 'object',
    description: 'Tags associated with the company',
    optional: true,
    properties: INTERCOM_COMPANY_TAGS_OUTPUT_PROPERTIES,
  },
  segments: {
    type: 'object',
    description: 'Segments the company belongs to',
    optional: true,
    properties: INTERCOM_COMPANY_SEGMENTS_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete company output definition
 */
export const INTERCOM_COMPANY_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Intercom company object',
  properties: INTERCOM_COMPANY_OUTPUT_PROPERTIES,
}

/**
 * Companies array output definition for list endpoints
 */
export const INTERCOM_COMPANIES_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of company objects',
  items: {
    type: 'object',
    properties: INTERCOM_COMPANY_OUTPUT_PROPERTIES,
  },
}

// ============================================================================
// Conversation Output Properties
// ============================================================================

/**
 * Output definition for conversation source object
 */
export const INTERCOM_CONVERSATION_SOURCE_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Source type (conversation, email, push, etc.)' },
  id: { type: 'string', description: 'Source ID' },
  delivered_as: {
    type: 'string',
    description:
      'Delivery type (customer_initiated, campaigns_initiated, operator_initiated, automated, admin_initiated)',
  },
  subject: { type: 'string', description: 'Subject line for email conversations', optional: true },
  body: { type: 'string', description: 'Message body (may contain HTML)' },
  author: {
    type: 'object',
    description: 'Author of the conversation',
    properties: {
      type: { type: 'string', description: 'Author type (admin, user, lead, bot, team)' },
      id: { type: 'string', description: 'Author ID' },
      name: { type: 'string', description: 'Author name', optional: true },
      email: { type: 'string', description: 'Author email', optional: true },
    },
  },
  attachments: {
    type: 'array',
    description: 'File attachments',
    optional: true,
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Attachment type' },
        name: { type: 'string', description: 'File name' },
        url: { type: 'string', description: 'Download URL' },
        content_type: { type: 'string', description: 'MIME type' },
        filesize: { type: 'number', description: 'File size in bytes' },
      },
    },
  },
  url: { type: 'string', description: 'Source URL if applicable', optional: true },
  redacted: { type: 'boolean', description: 'Whether content was redacted', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for conversation contacts object
 */
export const INTERCOM_CONVERSATION_CONTACTS_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (contact.list)' },
  contacts: {
    type: 'array',
    description: 'Array of contacts in the conversation',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Object type (contact)' },
        id: { type: 'string', description: 'Contact ID' },
        external_id: { type: 'string', description: 'External contact ID', optional: true },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for conversation teammates object
 */
export const INTERCOM_CONVERSATION_TEAMMATES_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (admin.list)' },
  admins: {
    type: 'array',
    description: 'Array of admins participating in the conversation',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Object type (admin)' },
        id: { type: 'string', description: 'Admin ID' },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for conversation part object
 */
export const INTERCOM_CONVERSATION_PART_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Part type (comment, note, assignment, etc.)' },
  id: { type: 'string', description: 'Part ID' },
  part_type: { type: 'string', description: 'Type of conversation part' },
  body: { type: 'string', description: 'Part body content (may contain HTML)', optional: true },
  created_at: { type: 'number', description: 'Unix timestamp when part was created' },
  updated_at: { type: 'number', description: 'Unix timestamp when part was last updated' },
  notified_at: {
    type: 'number',
    description: 'Unix timestamp when notification was sent',
    optional: true,
  },
  author: {
    type: 'object',
    description: 'Author of this part',
    properties: {
      type: { type: 'string', description: 'Author type' },
      id: { type: 'string', description: 'Author ID' },
      name: { type: 'string', description: 'Author name', optional: true },
      email: { type: 'string', description: 'Author email', optional: true },
    },
  },
  attachments: {
    type: 'array',
    description: 'File attachments',
    optional: true,
    items: { type: 'object' },
  },
  external_id: { type: 'string', description: 'External ID if applicable', optional: true },
  redacted: { type: 'boolean', description: 'Whether content was redacted', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for conversation parts container
 */
export const INTERCOM_CONVERSATION_PARTS_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (conversation_part.list)' },
  conversation_parts: {
    type: 'array',
    description: 'Array of conversation parts (max 500)',
    items: {
      type: 'object',
      properties: INTERCOM_CONVERSATION_PART_OUTPUT_PROPERTIES,
    },
  },
  total_count: { type: 'number', description: 'Total number of conversation parts' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for conversation statistics
 */
export const INTERCOM_CONVERSATION_STATISTICS_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (conversation_statistics)' },
  time_to_assignment: {
    type: 'number',
    description: 'Time in seconds until first assignment',
    optional: true,
  },
  time_to_admin_reply: {
    type: 'number',
    description: 'Time in seconds until first admin reply',
    optional: true,
  },
  time_to_first_close: {
    type: 'number',
    description: 'Time in seconds until first close',
    optional: true,
  },
  time_to_last_close: {
    type: 'number',
    description: 'Time in seconds until last close',
    optional: true,
  },
  median_time_to_reply: {
    type: 'number',
    description: 'Median time in seconds to reply',
    optional: true,
  },
  first_contact_reply_at: {
    type: 'number',
    description: 'Unix timestamp of first contact reply',
    optional: true,
  },
  first_assignment_at: {
    type: 'number',
    description: 'Unix timestamp of first assignment',
    optional: true,
  },
  first_admin_reply_at: {
    type: 'number',
    description: 'Unix timestamp of first admin reply',
    optional: true,
  },
  first_close_at: {
    type: 'number',
    description: 'Unix timestamp of first close',
    optional: true,
  },
  last_assignment_at: {
    type: 'number',
    description: 'Unix timestamp of last assignment',
    optional: true,
  },
  last_assignment_admin_reply_at: {
    type: 'number',
    description: 'Unix timestamp of last assigned admin reply',
    optional: true,
  },
  last_contact_reply_at: {
    type: 'number',
    description: 'Unix timestamp of last contact reply',
    optional: true,
  },
  last_admin_reply_at: {
    type: 'number',
    description: 'Unix timestamp of last admin reply',
    optional: true,
  },
  last_close_at: {
    type: 'number',
    description: 'Unix timestamp of last close',
    optional: true,
  },
  count_reopens: {
    type: 'number',
    description: 'Number of reopens after first contact reply',
    optional: true,
  },
  count_assignments: {
    type: 'number',
    description: 'Number of assignments after first contact reply',
    optional: true,
  },
  count_conversation_parts: {
    type: 'number',
    description: 'Total number of conversation parts',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for conversation rating
 */
export const INTERCOM_CONVERSATION_RATING_OUTPUT_PROPERTIES = {
  rating: { type: 'number', description: 'Rating from 1-5' },
  remark: { type: 'string', description: 'Optional remark from contact', optional: true },
  created_at: { type: 'number', description: 'Unix timestamp when rating was created' },
  contact: {
    type: 'object',
    description: 'Contact who provided the rating',
    properties: {
      type: { type: 'string', description: 'Object type' },
      id: { type: 'string', description: 'Contact ID' },
      external_id: { type: 'string', description: 'External ID', optional: true },
    },
  },
  teammate: {
    type: 'object',
    description: 'Teammate who was rated',
    optional: true,
    properties: {
      type: { type: 'string', description: 'Object type' },
      id: { type: 'string', description: 'Admin ID' },
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for conversation tags object
 */
export const INTERCOM_CONVERSATION_TAGS_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (tag.list)' },
  tags: {
    type: 'array',
    description: 'Array of tags on the conversation',
    items: {
      type: 'object',
      properties: INTERCOM_TAG_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Core conversation properties
 */
export const INTERCOM_CONVERSATION_CORE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the conversation' },
  type: { type: 'string', description: 'Object type (conversation)' },
  title: { type: 'string', description: 'Title of the conversation', optional: true },
  created_at: { type: 'number', description: 'Unix timestamp when conversation was created' },
  updated_at: {
    type: 'number',
    description: 'Unix timestamp when conversation was last updated',
  },
  waiting_since: {
    type: 'number',
    description: 'Unix timestamp when waiting for customer reply (null if last reply from admin)',
    optional: true,
  },
  snoozed_until: {
    type: 'number',
    description: 'Unix timestamp when snooze ends',
    optional: true,
  },
  open: { type: 'boolean', description: 'Whether the conversation is open' },
  state: { type: 'string', description: 'State of the conversation (open, closed, snoozed)' },
  read: { type: 'boolean', description: 'Whether the conversation has been read' },
  priority: {
    type: 'string',
    description: 'Priority of the conversation (priority, not_priority)',
    optional: true,
  },
  admin_assignee_id: { type: 'number', description: 'ID of assigned admin', optional: true },
  team_assignee_id: { type: 'string', description: 'ID of assigned team', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete conversation output properties
 */
export const INTERCOM_CONVERSATION_OUTPUT_PROPERTIES = {
  ...INTERCOM_CONVERSATION_CORE_OUTPUT_PROPERTIES,
  source: {
    type: 'object',
    description: 'Source of the conversation',
    optional: true,
    properties: INTERCOM_CONVERSATION_SOURCE_OUTPUT_PROPERTIES,
  },
  contacts: {
    type: 'object',
    description: 'Contacts in the conversation',
    optional: true,
    properties: INTERCOM_CONVERSATION_CONTACTS_OUTPUT_PROPERTIES,
  },
  teammates: {
    type: 'object',
    description: 'Teammates in the conversation',
    optional: true,
    properties: INTERCOM_CONVERSATION_TEAMMATES_OUTPUT_PROPERTIES,
  },
  tags: {
    type: 'object',
    description: 'Tags on the conversation',
    optional: true,
    properties: INTERCOM_CONVERSATION_TAGS_OUTPUT_PROPERTIES,
  },
  conversation_parts: {
    type: 'object',
    description: 'Parts of the conversation (only returned when fetching single conversation)',
    optional: true,
    properties: INTERCOM_CONVERSATION_PARTS_OUTPUT_PROPERTIES,
  },
  conversation_rating: {
    type: 'object',
    description: 'Rating for the conversation',
    optional: true,
    properties: INTERCOM_CONVERSATION_RATING_OUTPUT_PROPERTIES,
  },
  statistics: {
    type: 'object',
    description: 'Conversation statistics',
    optional: true,
    properties: INTERCOM_CONVERSATION_STATISTICS_OUTPUT_PROPERTIES,
  },
  custom_attributes: {
    type: 'object',
    description: 'Custom attributes on the conversation',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete conversation output definition
 */
export const INTERCOM_CONVERSATION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Intercom conversation object',
  properties: INTERCOM_CONVERSATION_OUTPUT_PROPERTIES,
}

/**
 * Conversations array output definition for list/search endpoints
 */
export const INTERCOM_CONVERSATIONS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of conversation objects',
  items: {
    type: 'object',
    properties: INTERCOM_CONVERSATION_OUTPUT_PROPERTIES,
  },
}

// ============================================================================
// Ticket Output Properties
// ============================================================================

/**
 * Output definition for ticket type object
 */
export const INTERCOM_TICKET_TYPE_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (ticket_type)' },
  id: { type: 'string', description: 'Ticket type ID' },
  name: { type: 'string', description: 'Ticket type name', optional: true },
  description: { type: 'string', description: 'Ticket type description', optional: true },
  icon: { type: 'string', description: 'Icon identifier', optional: true },
  workspace_id: { type: 'string', description: 'Workspace ID', optional: true },
  archived: { type: 'boolean', description: 'Whether ticket type is archived', optional: true },
  created_at: { type: 'number', description: 'Unix timestamp when created', optional: true },
  updated_at: { type: 'number', description: 'Unix timestamp when updated', optional: true },
  category: {
    type: 'string',
    description: 'Category (Customer, Back-office, Tracker)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for ticket contacts object
 */
export const INTERCOM_TICKET_CONTACTS_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Object type (contact.list)' },
  contacts: {
    type: 'array',
    description: 'Array of contacts associated with the ticket',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Object type (contact)' },
        id: { type: 'string', description: 'Contact ID' },
        external_id: { type: 'string', description: 'External contact ID', optional: true },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete ticket output properties
 */
export const INTERCOM_TICKET_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the ticket' },
  type: { type: 'string', description: 'Object type (ticket)' },
  ticket_id: { type: 'string', description: 'Ticket ID shown in Intercom UI', optional: true },
  category: {
    type: 'string',
    description: 'Category (Customer, Back-office, Tracker)',
    optional: true,
  },
  ticket_type: {
    type: 'object',
    description: 'Ticket type information',
    optional: true,
    properties: INTERCOM_TICKET_TYPE_OUTPUT_PROPERTIES,
  },
  ticket_state: { type: 'string', description: 'Current state of the ticket', optional: true },
  ticket_state_internal_label: {
    type: 'string',
    description: 'Internal label for ticket state',
    optional: true,
  },
  ticket_state_external_label: {
    type: 'string',
    description: 'External label for ticket state',
    optional: true,
  },
  ticket_attributes: {
    type: 'object',
    description: 'Custom ticket attributes (keys: _default_title_, _default_description_, etc.)',
    optional: true,
  },
  contacts: {
    type: 'object',
    description: 'Contacts associated with the ticket',
    optional: true,
    properties: INTERCOM_TICKET_CONTACTS_OUTPUT_PROPERTIES,
  },
  admin_assignee_id: { type: 'string', description: 'ID of assigned admin', optional: true },
  team_assignee_id: { type: 'string', description: 'ID of assigned team', optional: true },
  open: { type: 'boolean', description: 'Whether the ticket is open', optional: true },
  is_shared: {
    type: 'boolean',
    description: 'Whether the ticket is shared with contact',
    optional: true,
  },
  snoozed_until: { type: 'number', description: 'Unix timestamp when snooze ends', optional: true },
  created_at: { type: 'number', description: 'Unix timestamp when ticket was created' },
  updated_at: { type: 'number', description: 'Unix timestamp when ticket was last updated' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete ticket output definition
 */
export const INTERCOM_TICKET_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Intercom ticket object',
  properties: INTERCOM_TICKET_OUTPUT_PROPERTIES,
}

// ============================================================================
// Pagination Output Properties
// ============================================================================

/**
 * Output definition for pagination cursor
 */
export const INTERCOM_PAGINATION_CURSOR_OUTPUT_PROPERTIES = {
  page: { type: 'number', description: 'Page number', optional: true },
  starting_after: { type: 'string', description: 'Cursor for next page', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for pagination objects
 */
export const INTERCOM_PAGES_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Pages type identifier' },
  page: { type: 'number', description: 'Current page number', optional: true },
  per_page: { type: 'number', description: 'Number of results per page', optional: true },
  total_pages: { type: 'number', description: 'Total number of pages', optional: true },
  next: {
    type: 'object',
    description: 'Next page cursor',
    optional: true,
    properties: INTERCOM_PAGINATION_CURSOR_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete pages output definition
 */
export const INTERCOM_PAGES_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pagination information',
  optional: true,
  properties: INTERCOM_PAGES_OUTPUT_PROPERTIES,
}

export interface IntercomBaseParams {
  accessToken: string
}

export interface IntercomPaginationParams {
  per_page?: number
  starting_after?: string
}

export interface IntercomPagingInfo {
  next?: {
    page: number
    starting_after: string
  } | null
  total_count?: number
}

export interface IntercomResponse<T> {
  success: boolean
  output: {
    data?: T
    pages?: IntercomPagingInfo
    metadata: {
      operation: string
      [key: string]: any
    }
    success: boolean
  }
}

export function buildIntercomUrl(path: string): string {
  return `https://api.intercom.io${path}`
}

export function handleIntercomError(data: any, status: number, operation: string): never {
  logger.error(`Intercom API request failed for ${operation}`, { data, status })

  const errorMessage = data.errors?.[0]?.message || data.error || data.message || 'Unknown error'
  throw new Error(`Intercom ${operation} failed: ${errorMessage}`)
}
