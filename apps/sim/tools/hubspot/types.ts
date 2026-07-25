import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for HubSpot CRM responses.
 * Based on HubSpot CRM API v3 documentation.
 * @see https://developers.hubspot.com/docs/api/crm/contacts
 * @see https://developers.hubspot.com/docs/api/crm/companies
 * @see https://developers.hubspot.com/docs/api/crm/deals
 */

/**
 * Common contact properties returned by HubSpot API.
 * Default properties returned by search: createdate, email, firstname, hs_object_id, lastmodifieddate, lastname.
 * @see https://developers.hubspot.com/blog/a-developers-guide-to-hubspot-crm-objects-contacts-object
 */
export const CONTACT_PROPERTIES_OUTPUT = {
  email: { type: 'string', description: 'Contact email address' },
  firstname: { type: 'string', description: 'Contact first name' },
  lastname: { type: 'string', description: 'Contact last name' },
  phone: { type: 'string', description: 'Contact phone number' },
  mobilephone: { type: 'string', description: 'Contact mobile phone number' },
  company: { type: 'string', description: 'Associated company name' },
  website: { type: 'string', description: 'Contact website URL' },
  jobtitle: { type: 'string', description: 'Contact job title' },
  lifecyclestage: {
    type: 'string',
    description:
      'Lifecycle stage (subscriber, lead, marketingqualifiedlead, salesqualifiedlead, opportunity, customer)',
  },
  hubspot_owner_id: { type: 'string', description: 'HubSpot owner ID' },
  hs_object_id: { type: 'string', description: 'HubSpot object ID (same as record ID)' },
  createdate: { type: 'string', description: 'Contact creation date (ISO 8601)' },
  lastmodifieddate: { type: 'string', description: 'Last modified date (ISO 8601)' },
  address: { type: 'string', description: 'Street address' },
  city: { type: 'string', description: 'City' },
  state: { type: 'string', description: 'State/Region' },
  zip: { type: 'string', description: 'Postal/ZIP code' },
  country: { type: 'string', description: 'Country' },
  fax: { type: 'string', description: 'Fax number' },
  hs_timezone: { type: 'string', description: 'Contact timezone' },
} as const satisfies Record<string, OutputProperty>

/**
 * Common company properties returned by HubSpot API.
 * Default properties: name, domain, hs_object_id.
 * @see https://developers.hubspot.com/blog/a-developers-guide-to-hubspot-crm-objects-company-object
 * @see https://knowledge.hubspot.com/properties/hubspot-crm-default-company-properties
 */
export const COMPANY_PROPERTIES_OUTPUT = {
  name: { type: 'string', description: 'Company name' },
  domain: { type: 'string', description: 'Company website domain (unique identifier)' },
  description: { type: 'string', description: 'Company description' },
  industry: { type: 'string', description: 'Industry type (e.g., Airlines/Aviation)' },
  phone: { type: 'string', description: 'Company phone number' },
  city: { type: 'string', description: 'City' },
  state: { type: 'string', description: 'State/Region' },
  zip: { type: 'string', description: 'Postal/ZIP code' },
  country: { type: 'string', description: 'Country' },
  address: { type: 'string', description: 'Street address' },
  numberofemployees: { type: 'string', description: 'Total number of employees' },
  annualrevenue: { type: 'string', description: 'Annual revenue estimate' },
  lifecyclestage: { type: 'string', description: 'Lifecycle stage' },
  hubspot_owner_id: { type: 'string', description: 'HubSpot owner ID' },
  hs_object_id: { type: 'string', description: 'HubSpot object ID (same as record ID)' },
  hs_createdate: { type: 'string', description: 'Company creation date (ISO 8601)' },
  hs_lastmodifieddate: { type: 'string', description: 'Last modified date (ISO 8601)' },
  hs_additional_domains: {
    type: 'string',
    description: 'Additional domains (semicolon-separated)',
  },
  num_associated_contacts: {
    type: 'string',
    description: 'Number of associated contacts (auto-updated)',
  },
  num_associated_deals: {
    type: 'string',
    description: 'Number of associated deals (auto-updated)',
  },
  website: { type: 'string', description: 'Company website URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Common deal properties returned by HubSpot API.
 * Default properties: dealname, amount, closedate, pipeline, dealstage.
 * @see https://developers.hubspot.com/blog/a-developers-guide-to-hubspot-crm-objects-deals-object
 */
export const DEAL_PROPERTIES_OUTPUT = {
  dealname: { type: 'string', description: 'Deal name' },
  amount: { type: 'string', description: 'Deal amount' },
  dealstage: { type: 'string', description: 'Current deal stage' },
  pipeline: { type: 'string', description: 'Pipeline the deal is in' },
  closedate: { type: 'string', description: 'Expected close date (ISO 8601)' },
  dealtype: { type: 'string', description: 'Deal type (New Business, Existing Business, etc.)' },
  description: { type: 'string', description: 'Deal description' },
  hubspot_owner_id: { type: 'string', description: 'HubSpot owner ID' },
  hs_object_id: { type: 'string', description: 'HubSpot object ID (same as record ID)' },
  createdate: { type: 'string', description: 'Deal creation date (ISO 8601)' },
  hs_lastmodifieddate: { type: 'string', description: 'Last modified date (ISO 8601)' },
  num_associated_contacts: {
    type: 'string',
    description: 'Number of associated contacts',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Paging output properties for list endpoints.
 * @see https://developers.hubspot.com/docs/guides/crm/using-object-apis
 */
export const PAGING_OUTPUT_PROPERTIES = {
  after: { type: 'string', description: 'Cursor for next page of results' },
  link: { type: 'string', description: 'Link to next page', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete paging object output definition.
 */
export const PAGING_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pagination information for fetching more results',
  optional: true,
  properties: {
    next: {
      type: 'object',
      description: 'Next page cursor information',
      optional: true,
      properties: PAGING_OUTPUT_PROPERTIES,
    },
  },
}

/**
 * Metadata output properties for list endpoints.
 */
export const METADATA_OUTPUT_PROPERTIES = {
  totalReturned: { type: 'number', description: 'Number of records returned in this response' },
  hasMore: { type: 'boolean', description: 'Whether more records are available' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete metadata object output definition.
 */
export const METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Response metadata',
  properties: METADATA_OUTPUT_PROPERTIES,
}

/**
 * Common CRM record base output properties (id, createdAt, updatedAt, archived).
 * All HubSpot CRM objects share this structure.
 */
export const CRM_RECORD_BASE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique record ID (hs_object_id)' },
  createdAt: { type: 'string', description: 'Record creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Record last updated timestamp (ISO 8601)' },
  archived: { type: 'boolean', description: 'Whether the record is archived' },
} as const satisfies Record<string, OutputProperty>

/**
 * Contact object output definition with nested properties.
 */
export const CONTACT_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'HubSpot contact record',
  properties: {
    ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
    properties: {
      type: 'object',
      description: 'Contact properties',
      properties: CONTACT_PROPERTIES_OUTPUT,
    },
    associations: {
      type: 'object',
      description: 'Associated records (companies, deals, etc.)',
      optional: true,
    },
  },
}

/**
 * Company object output definition with nested properties.
 */
export const COMPANY_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'HubSpot company record',
  properties: {
    ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
    properties: {
      type: 'object',
      description: 'Company properties',
      properties: COMPANY_PROPERTIES_OUTPUT,
    },
    associations: {
      type: 'object',
      description: 'Associated records (contacts, deals, etc.)',
      optional: true,
    },
  },
}

/**
 * Deal object output definition with nested properties.
 */
export const DEAL_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'HubSpot deal record',
  properties: {
    ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
    properties: {
      type: 'object',
      description: 'Deal properties',
      properties: DEAL_PROPERTIES_OUTPUT,
    },
    associations: {
      type: 'object',
      description: 'Associated records (contacts, companies, line items, etc.)',
      optional: true,
    },
  },
}

/**
 * Contacts array output definition for list endpoints.
 */
export const CONTACTS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot contact records',
  items: {
    type: 'object',
    properties: {
      ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
      properties: {
        type: 'object',
        description: 'Contact properties',
        properties: CONTACT_PROPERTIES_OUTPUT,
      },
      associations: {
        type: 'object',
        description: 'Associated records',
        optional: true,
      },
    },
  },
}

/**
 * Companies array output definition for list endpoints.
 */
export const COMPANIES_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot company records',
  items: {
    type: 'object',
    properties: {
      ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
      properties: {
        type: 'object',
        description: 'Company properties',
        properties: COMPANY_PROPERTIES_OUTPUT,
      },
      associations: {
        type: 'object',
        description: 'Associated records',
        optional: true,
      },
    },
  },
}

/**
 * Deals array output definition for list endpoints.
 */
export const DEALS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot deal records',
  items: {
    type: 'object',
    properties: {
      ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
      properties: {
        type: 'object',
        description: 'Deal properties',
        properties: DEAL_PROPERTIES_OUTPUT,
      },
      associations: {
        type: 'object',
        description: 'Associated records',
        optional: true,
      },
    },
  },
}

/**
 * Common ticket properties returned by HubSpot API.
 * Default properties: subject, content, hs_pipeline, hs_pipeline_stage, hs_ticket_priority, hs_ticket_category.
 * @see https://developers.hubspot.com/docs/api/crm/tickets
 */
export const TICKET_PROPERTIES_OUTPUT = {
  subject: { type: 'string', description: 'Ticket subject/name' },
  content: { type: 'string', description: 'Ticket content/description' },
  hs_pipeline: { type: 'string', description: 'Pipeline the ticket is in' },
  hs_pipeline_stage: { type: 'string', description: 'Current pipeline stage' },
  hs_ticket_priority: { type: 'string', description: 'Ticket priority (LOW, MEDIUM, HIGH)' },
  hs_ticket_category: { type: 'string', description: 'Ticket category' },
  hubspot_owner_id: { type: 'string', description: 'HubSpot owner ID' },
  hs_object_id: { type: 'string', description: 'HubSpot object ID (same as record ID)' },
  createdate: { type: 'string', description: 'Ticket creation date (ISO 8601)' },
  hs_lastmodifieddate: { type: 'string', description: 'Last modified date (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Common line item properties returned by HubSpot API.
 * @see https://developers.hubspot.com/docs/api/crm/line-items
 */
export const LINE_ITEM_PROPERTIES_OUTPUT = {
  name: { type: 'string', description: 'Line item name' },
  description: { type: 'string', description: 'Full description of the product' },
  hs_sku: { type: 'string', description: 'Unique product identifier (SKU)' },
  quantity: { type: 'string', description: 'Number of units included' },
  price: { type: 'string', description: 'Unit price' },
  amount: { type: 'string', description: 'Total cost (quantity * unit price)' },
  hs_line_item_currency_code: { type: 'string', description: 'Currency code' },
  recurringbillingfrequency: { type: 'string', description: 'Recurring billing frequency' },
  hs_recurring_billing_start_date: {
    type: 'string',
    description: 'Recurring billing start date',
  },
  hs_recurring_billing_end_date: { type: 'string', description: 'Recurring billing end date' },
  hs_object_id: { type: 'string', description: 'HubSpot object ID (same as record ID)' },
  createdate: { type: 'string', description: 'Creation date (ISO 8601)' },
  hs_lastmodifieddate: { type: 'string', description: 'Last modified date (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Common quote properties returned by HubSpot API.
 * @see https://developers.hubspot.com/docs/api/crm/quotes
 */
export const QUOTE_PROPERTIES_OUTPUT = {
  hs_title: { type: 'string', description: 'Quote name/title' },
  hs_expiration_date: { type: 'string', description: 'Expiration date' },
  hs_status: { type: 'string', description: 'Quote status' },
  hs_esign_enabled: { type: 'string', description: 'Whether e-signatures are enabled' },
  hs_object_id: { type: 'string', description: 'HubSpot object ID (same as record ID)' },
  createdate: { type: 'string', description: 'Creation date (ISO 8601)' },
  hs_lastmodifieddate: { type: 'string', description: 'Last modified date (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Common appointment properties returned by HubSpot API.
 * @see https://developers.hubspot.com/docs/api/crm/appointments
 */
export const APPOINTMENT_PROPERTIES_OUTPUT = {
  hs_appointment_name: { type: 'string', description: 'Appointment title/name' },
  hs_appointment_start: { type: 'string', description: 'Start time (ISO 8601)' },
  hs_appointment_end: { type: 'string', description: 'End time (ISO 8601)' },
  hs_appointment_status: { type: 'string', description: 'Appointment status (e.g., SCHEDULED)' },
  hubspot_owner_id: { type: 'string', description: 'HubSpot owner ID' },
  hs_object_id: { type: 'string', description: 'HubSpot object ID (same as record ID)' },
  hs_createdate: { type: 'string', description: 'Creation date (ISO 8601)' },
  hs_lastmodifieddate: { type: 'string', description: 'Last modified date (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Owner properties returned by HubSpot Owners API v3.
 * @see https://developers.hubspot.com/docs/api/crm/owners
 */
export const OWNER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Owner ID' },
  email: { type: 'string', description: 'Owner email address' },
  firstName: { type: 'string', description: 'Owner first name' },
  lastName: { type: 'string', description: 'Owner last name' },
  userId: { type: 'number', description: 'Associated user ID', optional: true },
  teams: {
    type: 'array',
    description: 'Teams the owner belongs to',
    optional: true,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Team ID' },
        name: { type: 'string', description: 'Team name' },
      },
    },
  },
  createdAt: { type: 'string', description: 'Creation date (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last updated date (ISO 8601)' },
  archived: { type: 'boolean', description: 'Whether the owner is archived' },
} as const satisfies Record<string, OutputProperty>

/**
 * Marketing event properties returned by HubSpot Marketing Events API.
 * Response is flat (not CRM envelope) — fields are at the top level.
 * @see https://developers.hubspot.com/docs/api/marketing/marketing-events
 */
export const MARKETING_EVENT_OUTPUT_PROPERTIES = {
  objectId: { type: 'string', description: 'Unique event ID (HubSpot internal)' },
  eventName: { type: 'string', description: 'Event name' },
  eventType: { type: 'string', description: 'Event type', optional: true },
  eventStatus: { type: 'string', description: 'Event status', optional: true },
  eventDescription: { type: 'string', description: 'Event description', optional: true },
  eventUrl: { type: 'string', description: 'Event URL', optional: true },
  eventOrganizer: { type: 'string', description: 'Event organizer', optional: true },
  startDateTime: { type: 'string', description: 'Start date/time (ISO 8601)', optional: true },
  endDateTime: { type: 'string', description: 'End date/time (ISO 8601)', optional: true },
  eventCancelled: { type: 'boolean', description: 'Whether event is cancelled', optional: true },
  eventCompleted: { type: 'boolean', description: 'Whether event is completed', optional: true },
  registrants: { type: 'number', description: 'Number of registrants', optional: true },
  attendees: { type: 'number', description: 'Number of attendees', optional: true },
  cancellations: { type: 'number', description: 'Number of cancellations', optional: true },
  noShows: { type: 'number', description: 'Number of no-shows', optional: true },
  externalEventId: { type: 'string', description: 'External event ID', optional: true },
  createdAt: { type: 'string', description: 'Creation date (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last updated date (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Single marketing event output definition.
 */
export const MARKETING_EVENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'HubSpot marketing event',
  properties: MARKETING_EVENT_OUTPUT_PROPERTIES,
}

/**
 * List properties returned by HubSpot Lists API v3.
 * @see https://developers.hubspot.com/docs/api/crm/lists
 */
export const LIST_OUTPUT_PROPERTIES = {
  listId: { type: 'string', description: 'List ID' },
  name: { type: 'string', description: 'List name' },
  objectTypeId: { type: 'string', description: 'Object type ID (e.g., 0-1 for contacts)' },
  processingType: { type: 'string', description: 'Processing type (MANUAL, DYNAMIC, SNAPSHOT)' },
  processingStatus: {
    type: 'string',
    description: 'Processing status (COMPLETE, PROCESSING)',
    optional: true,
  },
  listVersion: { type: 'number', description: 'List version number', optional: true },
  createdAt: { type: 'string', description: 'Creation date (ISO 8601)', optional: true },
  updatedAt: { type: 'string', description: 'Last updated date (ISO 8601)', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Ticket object output definition with nested properties.
 */
export const TICKET_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'HubSpot ticket record',
  properties: {
    ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
    properties: {
      type: 'object',
      description: 'Ticket properties',
      properties: TICKET_PROPERTIES_OUTPUT,
    },
    associations: {
      type: 'object',
      description: 'Associated records (contacts, companies, etc.)',
      optional: true,
    },
  },
}

/**
 * Line item object output definition with nested properties.
 */
export const LINE_ITEM_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'HubSpot line item record',
  properties: {
    ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
    properties: {
      type: 'object',
      description: 'Line item properties',
      properties: LINE_ITEM_PROPERTIES_OUTPUT,
    },
    associations: {
      type: 'object',
      description: 'Associated records (deals, quotes, etc.)',
      optional: true,
    },
  },
}

/**
 * Quote object output definition with nested properties.
 */
export const QUOTE_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'HubSpot quote record',
  properties: {
    ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
    properties: {
      type: 'object',
      description: 'Quote properties',
      properties: QUOTE_PROPERTIES_OUTPUT,
    },
    associations: {
      type: 'object',
      description: 'Associated records (deals, line items, etc.)',
      optional: true,
    },
  },
}

/**
 * Appointment object output definition with nested properties.
 */
export const APPOINTMENT_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'HubSpot appointment record',
  properties: {
    ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
    properties: {
      type: 'object',
      description: 'Appointment properties',
      properties: APPOINTMENT_PROPERTIES_OUTPUT,
    },
    associations: {
      type: 'object',
      description: 'Associated records (contacts, companies, etc.)',
      optional: true,
    },
  },
}

/**
 * Generic CRM object output for objects with dynamic properties (carts).
 */
export const GENERIC_CRM_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'HubSpot CRM record',
  properties: {
    ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
    properties: {
      type: 'object',
      description: 'Record properties',
    },
    associations: {
      type: 'object',
      description: 'Associated records',
      optional: true,
    },
  },
}

/**
 * Tickets array output definition for list endpoints.
 */
export const TICKETS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot ticket records',
  items: {
    type: 'object',
    properties: {
      ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
      properties: {
        type: 'object',
        description: 'Ticket properties',
        properties: TICKET_PROPERTIES_OUTPUT,
      },
      associations: { type: 'object', description: 'Associated records', optional: true },
    },
  },
}

/**
 * Line items array output definition for list endpoints.
 */
export const LINE_ITEMS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot line item records',
  items: {
    type: 'object',
    properties: {
      ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
      properties: {
        type: 'object',
        description: 'Line item properties',
        properties: LINE_ITEM_PROPERTIES_OUTPUT,
      },
      associations: { type: 'object', description: 'Associated records', optional: true },
    },
  },
}

/**
 * Quotes array output definition for list endpoints.
 */
export const QUOTES_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot quote records',
  items: {
    type: 'object',
    properties: {
      ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
      properties: {
        type: 'object',
        description: 'Quote properties',
        properties: QUOTE_PROPERTIES_OUTPUT,
      },
      associations: { type: 'object', description: 'Associated records', optional: true },
    },
  },
}

/**
 * Appointments array output definition for list endpoints.
 */
export const APPOINTMENTS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot appointment records',
  items: {
    type: 'object',
    properties: {
      ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
      properties: {
        type: 'object',
        description: 'Appointment properties',
        properties: APPOINTMENT_PROPERTIES_OUTPUT,
      },
      associations: { type: 'object', description: 'Associated records', optional: true },
    },
  },
}

/**
 * Generic CRM objects array output for objects with dynamic properties (carts).
 */
export const GENERIC_CRM_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot CRM records',
  items: {
    type: 'object',
    properties: {
      ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
      properties: { type: 'object', description: 'Record properties' },
      associations: { type: 'object', description: 'Associated records', optional: true },
    },
  },
}

/**
 * Owners array output definition for list endpoints.
 */
export const OWNERS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot owner objects',
  items: {
    type: 'object',
    properties: OWNER_OUTPUT_PROPERTIES,
  },
}

/**
 * Marketing events array output definition for list endpoints.
 */
export const MARKETING_EVENTS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot marketing event objects',
  items: {
    type: 'object',
    properties: MARKETING_EVENT_OUTPUT_PROPERTIES,
  },
}

/**
 * Lists array output definition for list endpoints.
 */
export const LISTS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot list objects',
  items: {
    type: 'object',
    properties: LIST_OUTPUT_PROPERTIES,
  },
}

/**
 * Common note properties returned by HubSpot API.
 * @see https://developers.hubspot.com/docs/api-reference/crm-notes-v3
 */
export const NOTE_PROPERTIES_OUTPUT = {
  hs_note_body: { type: 'string', description: 'Note text/body (supports rich text/HTML)' },
  hs_timestamp: { type: 'string', description: 'Note activity time (ISO 8601)' },
  hubspot_owner_id: { type: 'string', description: 'HubSpot owner ID' },
  hs_attachment_ids: {
    type: 'string',
    description: 'Semicolon-separated IDs of files attached to the note',
  },
  hs_object_id: { type: 'string', description: 'HubSpot object ID (same as record ID)' },
  hs_createdate: { type: 'string', description: 'Note creation date (ISO 8601)' },
  hs_lastmodifieddate: { type: 'string', description: 'Last modified date (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Common email engagement properties returned by HubSpot API.
 * @see https://developers.hubspot.com/docs/api-reference/crm-emails-v3
 */
export const EMAIL_PROPERTIES_OUTPUT = {
  hs_timestamp: { type: 'string', description: 'Email activity time (ISO 8601)' },
  hs_email_direction: {
    type: 'string',
    description: 'Direction (EMAIL = outgoing, INCOMING_EMAIL, FORWARDED_EMAIL)',
  },
  hs_email_status: {
    type: 'string',
    description: 'Send status (SENT, SENDING, SCHEDULED, FAILED, BOUNCED)',
  },
  hs_email_subject: { type: 'string', description: 'Email subject line' },
  hs_email_text: { type: 'string', description: 'Plain-text email body' },
  hs_email_html: { type: 'string', description: 'HTML email body' },
  hs_email_headers: { type: 'string', description: 'JSON-encoded from/to/cc/bcc headers' },
  hs_email_from_email: { type: 'string', description: 'Sender email address' },
  hs_email_to_email: { type: 'string', description: 'Recipient email address(es)' },
  hubspot_owner_id: { type: 'string', description: 'HubSpot owner ID' },
  hs_object_id: { type: 'string', description: 'HubSpot object ID (same as record ID)' },
  hs_createdate: { type: 'string', description: 'Email creation date (ISO 8601)' },
  hs_lastmodifieddate: { type: 'string', description: 'Last modified date (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Note object output definition with nested properties.
 */
export const NOTE_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'HubSpot note record',
  properties: {
    ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
    properties: {
      type: 'object',
      description: 'Note properties',
      properties: NOTE_PROPERTIES_OUTPUT,
    },
    associations: {
      type: 'object',
      description: 'Associated records (contacts, companies, deals, etc.)',
      optional: true,
    },
  },
}

/**
 * Notes array output definition for list/search endpoints.
 */
export const NOTES_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot note records',
  items: {
    type: 'object',
    properties: {
      ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
      properties: {
        type: 'object',
        description: 'Note properties',
        properties: NOTE_PROPERTIES_OUTPUT,
      },
      associations: { type: 'object', description: 'Associated records', optional: true },
    },
  },
}

/**
 * Email object output definition with nested properties.
 */
export const EMAIL_OBJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'HubSpot email engagement record',
  properties: {
    ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
    properties: {
      type: 'object',
      description: 'Email properties',
      properties: EMAIL_PROPERTIES_OUTPUT,
    },
    associations: {
      type: 'object',
      description: 'Associated records (contacts, companies, deals, etc.)',
      optional: true,
    },
  },
}

/**
 * Emails array output definition for list/search endpoints.
 */
export const EMAILS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot email engagement records',
  items: {
    type: 'object',
    properties: {
      ...CRM_RECORD_BASE_OUTPUT_PROPERTIES,
      properties: {
        type: 'object',
        description: 'Email properties',
        properties: EMAIL_PROPERTIES_OUTPUT,
      },
      associations: { type: 'object', description: 'Associated records', optional: true },
    },
  },
}

/**
 * Property option output (picklist/enumeration value).
 * @see https://developers.hubspot.com/docs/api-reference/crm-properties-v3
 */
export const PROPERTY_OPTION_OUTPUT_PROPERTIES = {
  label: { type: 'string', description: 'Human-readable option label' },
  value: { type: 'string', description: 'Internal value used when setting the property' },
  displayOrder: { type: 'number', description: 'Display order (-1 sorts last)', optional: true },
  hidden: { type: 'boolean', description: 'Whether the option is hidden in the HubSpot UI' },
  description: { type: 'string', description: 'Option description', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Property definitions array output for the properties endpoint.
 */
export const PROPERTIES_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of HubSpot property definitions',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Internal property name' },
      label: { type: 'string', description: 'Human-readable label' },
      type: {
        type: 'string',
        description: 'Property data type (string, number, enumeration, bool, datetime, etc.)',
      },
      fieldType: { type: 'string', description: 'Field type controlling HubSpot UI rendering' },
      description: { type: 'string', description: 'Property help text' },
      groupName: { type: 'string', description: 'Property group the property belongs to' },
      options: {
        type: 'array',
        description: 'Enumeration/picklist options (empty for non-enumerated properties)',
        items: { type: 'object', properties: PROPERTY_OPTION_OUTPUT_PROPERTIES },
      },
      displayOrder: { type: 'number', description: 'Display order', optional: true },
      calculated: {
        type: 'boolean',
        description: 'Whether the property is calculated by HubSpot',
        optional: true,
      },
      hidden: { type: 'boolean', description: 'Whether the property is hidden', optional: true },
      hubspotDefined: {
        type: 'boolean',
        description: 'Whether the property is a HubSpot default property',
        optional: true,
      },
      archived: {
        type: 'boolean',
        description: 'Whether the property is archived',
        optional: true,
      },
    },
  },
}

/**
 * Associations array output for the v4 associations list endpoint.
 */
export const ASSOCIATIONS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of associated records',
  items: {
    type: 'object',
    properties: {
      toObjectId: { type: 'string', description: 'ID of the associated (target) record' },
      associationTypes: {
        type: 'array',
        description: 'Association types linking the two records',
        items: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description:
                'Association category (HUBSPOT_DEFINED, USER_DEFINED, INTEGRATOR_DEFINED)',
            },
            typeId: { type: 'number', description: 'Association type ID' },
            label: { type: 'string', description: 'Association label', optional: true },
          },
        },
      },
    },
  },
}

// Common HubSpot types
interface HubSpotCrmObject {
  id: string
  properties: Record<string, any>
  createdAt: string
  updatedAt: string
  archived: boolean
  associations?: Record<string, any>
}

/** @deprecated Use HubSpotCrmObject instead */
export type HubSpotContact = HubSpotCrmObject

interface HubSpotPaging {
  next?: {
    after: string
    link?: string
  }
}

// Users
export interface HubSpotGetUsersResponse extends ToolResponse {
  output: {
    users: HubSpotCrmObject[]
    paging: HubSpotPaging | null
    totalItems?: number
    success: boolean
  }
}

export interface HubSpotGetUsersParams {
  accessToken: string
  limit?: string
  after?: string
  properties?: string
}

// List Contacts
export interface HubSpotListContactsResponse extends ToolResponse {
  output: {
    contacts: HubSpotContact[]
    paging: HubSpotPaging | null
    metadata: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface HubSpotListContactsParams {
  accessToken: string
  limit?: string
  after?: string
  properties?: string
  associations?: string
}

// Get Contact
export interface HubSpotGetContactResponse extends ToolResponse {
  output: {
    contact: HubSpotContact
    contactId: string
    success: boolean
  }
}

export interface HubSpotGetContactParams {
  accessToken: string
  contactId: string
  idProperty?: string
  properties?: string
  associations?: string
}

// Create Contact
export interface HubSpotCreateContactResponse extends ToolResponse {
  output: {
    contact: HubSpotContact
    contactId: string
    success: boolean
  }
}

export interface HubSpotCreateContactParams {
  accessToken: string
  properties: Record<string, any>
  associations?: Array<{
    to: { id: string }
    types: Array<{
      associationCategory: string
      associationTypeId: number
    }>
  }>
}

// Update Contact
export interface HubSpotUpdateContactResponse extends ToolResponse {
  output: {
    contact: HubSpotContact
    contactId: string
    success: boolean
  }
}

export interface HubSpotUpdateContactParams {
  accessToken: string
  contactId: string
  idProperty?: string
  properties: Record<string, any>
}

// Search Contacts
export interface HubSpotSearchContactsResponse extends ToolResponse {
  output: {
    contacts: HubSpotContact[]
    total: number
    paging: HubSpotPaging | null
    metadata: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface HubSpotSearchContactsParams {
  accessToken: string
  filterGroups?: Array<{
    filters: Array<{
      propertyName: string
      operator: string
      value: string
    }>
  }>
  sorts?: Array<{
    propertyName: string
    direction: 'ASCENDING' | 'DESCENDING'
  }>
  query?: string
  properties?: string[]
  limit?: number
  after?: string
}

// Companies (same structure as contacts)
export type HubSpotCompany = HubSpotCrmObject
export type HubSpotListCompaniesParams = HubSpotListContactsParams
export type HubSpotListCompaniesResponse = Omit<HubSpotListContactsResponse, 'output'> & {
  output: {
    companies: HubSpotContact[]
    paging: HubSpotPaging | null
    metadata: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}
export type HubSpotGetCompanyParams = Omit<HubSpotGetContactParams, 'contactId'> & {
  companyId: string
}
export type HubSpotGetCompanyResponse = Omit<HubSpotGetContactResponse, 'output'> & {
  output: {
    company: HubSpotContact
    companyId: string
    success: boolean
  }
}
export type HubSpotCreateCompanyParams = HubSpotCreateContactParams
export type HubSpotCreateCompanyResponse = Omit<HubSpotCreateContactResponse, 'output'> & {
  output: {
    company: HubSpotContact
    companyId: string
    success: boolean
  }
}
export type HubSpotUpdateCompanyParams = Omit<HubSpotUpdateContactParams, 'contactId'> & {
  companyId: string
}
export type HubSpotUpdateCompanyResponse = Omit<HubSpotUpdateContactResponse, 'output'> & {
  output: {
    company: HubSpotContact
    companyId: string
    success: boolean
  }
}
export type HubSpotSearchCompaniesParams = HubSpotSearchContactsParams
export interface HubSpotSearchCompaniesResponse extends ToolResponse {
  output: {
    companies: HubSpotContact[]
    total: number
    paging: HubSpotPaging | null
    metadata: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

// Deals
export type HubSpotDeal = HubSpotCrmObject
export type HubSpotListDealsParams = HubSpotListContactsParams
export type HubSpotListDealsResponse = Omit<HubSpotListContactsResponse, 'output'> & {
  output: {
    deals: HubSpotContact[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}
export type HubSpotGetDealParams = Omit<HubSpotGetContactParams, 'contactId'> & { dealId: string }
export type HubSpotGetDealResponse = ToolResponse & {
  output: { deal: HubSpotContact; dealId: string; success: boolean }
}
export type HubSpotCreateDealParams = HubSpotCreateContactParams
export type HubSpotCreateDealResponse = ToolResponse & {
  output: { deal: HubSpotContact; dealId: string; success: boolean }
}
export type HubSpotUpdateDealParams = Omit<HubSpotUpdateContactParams, 'contactId'> & {
  dealId: string
}
export type HubSpotUpdateDealResponse = ToolResponse & {
  output: { deal: HubSpotContact; dealId: string; success: boolean }
}
export type HubSpotSearchDealsParams = HubSpotSearchContactsParams
export interface HubSpotSearchDealsResponse extends ToolResponse {
  output: {
    deals: HubSpotContact[]
    total: number
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}

// Tickets
export type HubSpotTicket = HubSpotCrmObject
export type HubSpotListTicketsParams = HubSpotListContactsParams
export type HubSpotListTicketsResponse = ToolResponse & {
  output: {
    tickets: HubSpotContact[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}
export type HubSpotGetTicketParams = Omit<HubSpotGetContactParams, 'contactId'> & {
  ticketId: string
}
export type HubSpotGetTicketResponse = ToolResponse & {
  output: { ticket: HubSpotContact; ticketId: string; success: boolean }
}
export type HubSpotCreateTicketParams = HubSpotCreateContactParams
export type HubSpotCreateTicketResponse = ToolResponse & {
  output: { ticket: HubSpotContact; ticketId: string; success: boolean }
}
export type HubSpotUpdateTicketParams = Omit<HubSpotUpdateContactParams, 'contactId'> & {
  ticketId: string
}
export type HubSpotUpdateTicketResponse = ToolResponse & {
  output: { ticket: HubSpotContact; ticketId: string; success: boolean }
}
export type HubSpotSearchTicketsParams = HubSpotSearchContactsParams
export interface HubSpotSearchTicketsResponse extends ToolResponse {
  output: {
    tickets: HubSpotContact[]
    total: number
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}

// Line Items
export type HubSpotLineItem = HubSpotCrmObject
export type HubSpotListLineItemsParams = HubSpotListContactsParams
export type HubSpotListLineItemsResponse = ToolResponse & {
  output: {
    lineItems: HubSpotContact[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}
export type HubSpotGetLineItemParams = Omit<HubSpotGetContactParams, 'contactId'> & {
  lineItemId: string
}
export type HubSpotGetLineItemResponse = ToolResponse & {
  output: { lineItem: HubSpotContact; lineItemId: string; success: boolean }
}
export type HubSpotCreateLineItemParams = HubSpotCreateContactParams
export type HubSpotCreateLineItemResponse = ToolResponse & {
  output: { lineItem: HubSpotContact; lineItemId: string; success: boolean }
}
export type HubSpotUpdateLineItemParams = Omit<HubSpotUpdateContactParams, 'contactId'> & {
  lineItemId: string
}
export type HubSpotUpdateLineItemResponse = ToolResponse & {
  output: { lineItem: HubSpotContact; lineItemId: string; success: boolean }
}

// Quotes
export type HubSpotQuote = HubSpotCrmObject
export type HubSpotListQuotesParams = HubSpotListContactsParams
export type HubSpotListQuotesResponse = ToolResponse & {
  output: {
    quotes: HubSpotContact[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}
export type HubSpotGetQuoteParams = Omit<HubSpotGetContactParams, 'contactId'> & {
  quoteId: string
}
export type HubSpotGetQuoteResponse = ToolResponse & {
  output: { quote: HubSpotContact; quoteId: string; success: boolean }
}

// Appointments
export type HubSpotAppointment = HubSpotCrmObject
export type HubSpotListAppointmentsParams = HubSpotListContactsParams
export type HubSpotListAppointmentsResponse = ToolResponse & {
  output: {
    appointments: HubSpotContact[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}
export type HubSpotGetAppointmentParams = Omit<HubSpotGetContactParams, 'contactId'> & {
  appointmentId: string
}
export type HubSpotGetAppointmentResponse = ToolResponse & {
  output: { appointment: HubSpotContact; appointmentId: string; success: boolean }
}
export type HubSpotCreateAppointmentParams = HubSpotCreateContactParams
export type HubSpotCreateAppointmentResponse = ToolResponse & {
  output: { appointment: HubSpotContact; appointmentId: string; success: boolean }
}
export type HubSpotUpdateAppointmentParams = Omit<HubSpotUpdateContactParams, 'contactId'> & {
  appointmentId: string
}
export type HubSpotUpdateAppointmentResponse = ToolResponse & {
  output: { appointment: HubSpotContact; appointmentId: string; success: boolean }
}

// Carts
export type HubSpotCart = HubSpotCrmObject
export type HubSpotListCartsParams = HubSpotListContactsParams
export type HubSpotListCartsResponse = ToolResponse & {
  output: {
    carts: HubSpotContact[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}
export type HubSpotGetCartParams = Omit<HubSpotGetContactParams, 'contactId'> & {
  cartId: string
}
export type HubSpotGetCartResponse = ToolResponse & {
  output: { cart: HubSpotContact; cartId: string; success: boolean }
}

// Owners
interface HubSpotOwner {
  id: string
  email: string
  firstName: string
  lastName: string
  userId?: number
  teams?: Array<{ id: string; name: string }>
  createdAt: string
  updatedAt: string
  archived: boolean
}

export interface HubSpotListOwnersParams {
  accessToken: string
  limit?: string
  after?: string
  email?: string
}

export interface HubSpotListOwnersResponse extends ToolResponse {
  output: {
    owners: HubSpotOwner[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}

// Marketing Events
interface HubSpotMarketingEvent {
  objectId: string
  eventName: string
  eventType?: string
  eventStatus?: string
  eventDescription?: string
  eventUrl?: string
  eventOrganizer?: string
  startDateTime?: string
  endDateTime?: string
  eventCancelled: boolean
  eventCompleted: boolean
  registrants: number
  attendees: number
  cancellations: number
  noShows: number
  createdAt: string
  updatedAt: string
}

export interface HubSpotListMarketingEventsParams {
  accessToken: string
  limit?: string
  after?: string
}

export interface HubSpotListMarketingEventsResponse extends ToolResponse {
  output: {
    events: HubSpotMarketingEvent[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}

export interface HubSpotGetMarketingEventParams {
  accessToken: string
  eventId: string
}

export interface HubSpotGetMarketingEventResponse extends ToolResponse {
  output: {
    event: HubSpotMarketingEvent
    eventId: string
    success: boolean
  }
}

// Lists
interface HubSpotList {
  listId: string
  name: string
  objectTypeId: string
  processingType: string
  size?: number
  createdAt?: string
  updatedAt?: string
}

export interface HubSpotListListsParams {
  accessToken: string
  query?: string
  count?: string
  offset?: string
}

export interface HubSpotListListsResponse extends ToolResponse {
  output: {
    lists: HubSpotList[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; total: number | null; hasMore: boolean }
    success: boolean
  }
}

export interface HubSpotGetListParams {
  accessToken: string
  listId: string
}

export interface HubSpotGetListResponse extends ToolResponse {
  output: {
    list: HubSpotList
    listId: string
    success: boolean
  }
}

export interface HubSpotCreateListParams {
  accessToken: string
  name: string
  objectTypeId: string
  processingType: string
}

export interface HubSpotCreateListResponse extends ToolResponse {
  output: {
    list: HubSpotList
    listId: string
    success: boolean
  }
}

// Notes
export type HubSpotNote = HubSpotCrmObject
export type HubSpotCreateNoteParams = HubSpotCreateContactParams
export type HubSpotCreateNoteResponse = ToolResponse & {
  output: { note: HubSpotContact; noteId: string; success: boolean }
}
export type HubSpotGetNoteParams = Omit<HubSpotGetContactParams, 'contactId'> & { noteId: string }
export type HubSpotGetNoteResponse = ToolResponse & {
  output: { note: HubSpotContact; noteId: string; success: boolean }
}
export type HubSpotListNotesParams = HubSpotListContactsParams
export type HubSpotListNotesResponse = ToolResponse & {
  output: {
    notes: HubSpotContact[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}
export type HubSpotSearchNotesParams = HubSpotSearchContactsParams
export interface HubSpotSearchNotesResponse extends ToolResponse {
  output: {
    notes: HubSpotContact[]
    total: number
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}

// Emails
export type HubSpotEmail = HubSpotCrmObject
export type HubSpotCreateEmailParams = HubSpotCreateContactParams
export type HubSpotCreateEmailResponse = ToolResponse & {
  output: { email: HubSpotContact; emailId: string; success: boolean }
}
export type HubSpotGetEmailParams = Omit<HubSpotGetContactParams, 'contactId'> & { emailId: string }
export type HubSpotGetEmailResponse = ToolResponse & {
  output: { email: HubSpotContact; emailId: string; success: boolean }
}
export type HubSpotListEmailsParams = HubSpotListContactsParams
export type HubSpotListEmailsResponse = ToolResponse & {
  output: {
    emails: HubSpotContact[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}
export type HubSpotSearchEmailsParams = HubSpotSearchContactsParams
export interface HubSpotSearchEmailsResponse extends ToolResponse {
  output: {
    emails: HubSpotContact[]
    total: number
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}

// Properties
interface HubSpotPropertyOption {
  label: string
  value: string
  displayOrder?: number
  hidden: boolean
  description?: string
}

interface HubSpotProperty {
  name: string
  label: string
  type: string
  fieldType: string
  description: string
  groupName: string
  options: HubSpotPropertyOption[]
  displayOrder?: number
  calculated?: boolean
  hidden?: boolean
  hubspotDefined?: boolean
  archived?: boolean
}

export interface HubSpotGetPropertiesParams {
  accessToken: string
  objectType: string
  propertyName?: string
  archived?: boolean
}

export interface HubSpotGetPropertiesResponse extends ToolResponse {
  output: {
    properties: HubSpotProperty[]
    metadata: { totalReturned: number; objectType: string }
    success: boolean
  }
}

// Associations (v4)
interface HubSpotAssociatedObject {
  toObjectId: string
  associationTypes: Array<{
    category: string
    typeId: number
    label?: string
  }>
}

export interface HubSpotListAssociationsParams {
  accessToken: string
  objectType: string
  objectId: string
  toObjectType: string
  limit?: string
  after?: string
}

export interface HubSpotListAssociationsResponse extends ToolResponse {
  output: {
    results: HubSpotAssociatedObject[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}

export interface HubSpotCreateAssociationParams {
  accessToken: string
  objectType: string
  objectId: string
  toObjectType: string
  toObjectId: string
  associationCategory?: string
  associationTypeId?: number
}

export interface HubSpotCreateAssociationResponse extends ToolResponse {
  output: {
    fromObjectId: string
    toObjectId: string
    labels: string[]
    success: boolean
  }
}

export interface HubSpotDeleteAssociationParams {
  accessToken: string
  objectType: string
  objectId: string
  toObjectType: string
  toObjectId: string
}

export interface HubSpotDeleteAssociationResponse extends ToolResponse {
  output: {
    fromObjectId: string
    toObjectId: string
    deleted: boolean
    success: boolean
  }
}

export interface HubSpotAssociationLabel {
  category: string
  typeId: number
  label: string | null
}

export interface HubSpotGetAssociationLabelsParams {
  accessToken: string
  objectType: string
  toObjectType: string
}

export interface HubSpotGetAssociationLabelsResponse extends ToolResponse {
  output: {
    labels: HubSpotAssociationLabel[]
    success: boolean
  }
}

// Record deletion (archive)
export interface HubSpotDeleteContactParams {
  accessToken: string
  contactId: string
}

export interface HubSpotDeleteContactResponse extends ToolResponse {
  output: { contactId: string; deleted: boolean; success: boolean }
}

export interface HubSpotDeleteCompanyParams {
  accessToken: string
  companyId: string
}

export interface HubSpotDeleteCompanyResponse extends ToolResponse {
  output: { companyId: string; deleted: boolean; success: boolean }
}

export interface HubSpotDeleteDealParams {
  accessToken: string
  dealId: string
}

export interface HubSpotDeleteDealResponse extends ToolResponse {
  output: { dealId: string; deleted: boolean; success: boolean }
}

export interface HubSpotDeleteTicketParams {
  accessToken: string
  ticketId: string
}

export interface HubSpotDeleteTicketResponse extends ToolResponse {
  output: { ticketId: string; deleted: boolean; success: boolean }
}

export interface HubSpotDeleteLineItemParams {
  accessToken: string
  lineItemId: string
}

export interface HubSpotDeleteLineItemResponse extends ToolResponse {
  output: { lineItemId: string; deleted: boolean; success: boolean }
}

// List memberships
export interface HubSpotListMembership {
  recordId: string
  membershipTimestamp?: string
}

export interface HubSpotAddListMembershipsParams {
  accessToken: string
  listId: string
  recordIds: string[] | string
}

export interface HubSpotAddListMembershipsResponse extends ToolResponse {
  output: {
    recordIdsAdded: string[]
    recordIdsMissing: string[]
    success: boolean
  }
}

export interface HubSpotRemoveListMembershipsParams {
  accessToken: string
  listId: string
  recordIds: string[] | string
}

export interface HubSpotRemoveListMembershipsResponse extends ToolResponse {
  output: {
    recordIdsRemoved: string[]
    recordIdsMissing: string[]
    success: boolean
  }
}

export interface HubSpotGetListMembershipsParams {
  accessToken: string
  listId: string
  limit?: string
  after?: string
}

export interface HubSpotGetListMembershipsResponse extends ToolResponse {
  output: {
    memberships: HubSpotListMembership[]
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}

// Search line items / quotes
export type HubSpotSearchLineItemsParams = HubSpotSearchContactsParams

export interface HubSpotSearchLineItemsResponse extends ToolResponse {
  output: {
    lineItems: HubSpotLineItem[]
    total: number
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}

export type HubSpotSearchQuotesParams = HubSpotSearchContactsParams

export interface HubSpotSearchQuotesResponse extends ToolResponse {
  output: {
    quotes: HubSpotQuote[]
    total: number
    paging: HubSpotPaging | null
    metadata: { totalReturned: number; hasMore: boolean }
    success: boolean
  }
}

// Generic HubSpot response type for the block
export type HubSpotResponse =
  | HubSpotGetUsersResponse
  | HubSpotListContactsResponse
  | HubSpotGetContactResponse
  | HubSpotCreateContactResponse
  | HubSpotUpdateContactResponse
  | HubSpotSearchContactsResponse
  | HubSpotListCompaniesResponse
  | HubSpotGetCompanyResponse
  | HubSpotCreateCompanyResponse
  | HubSpotUpdateCompanyResponse
  | HubSpotSearchCompaniesResponse
  | HubSpotListDealsResponse
  | HubSpotGetDealResponse
  | HubSpotCreateDealResponse
  | HubSpotUpdateDealResponse
  | HubSpotSearchDealsResponse
  | HubSpotListTicketsResponse
  | HubSpotGetTicketResponse
  | HubSpotCreateTicketResponse
  | HubSpotUpdateTicketResponse
  | HubSpotSearchTicketsResponse
  | HubSpotListLineItemsResponse
  | HubSpotGetLineItemResponse
  | HubSpotCreateLineItemResponse
  | HubSpotUpdateLineItemResponse
  | HubSpotListQuotesResponse
  | HubSpotGetQuoteResponse
  | HubSpotListAppointmentsResponse
  | HubSpotGetAppointmentResponse
  | HubSpotCreateAppointmentResponse
  | HubSpotUpdateAppointmentResponse
  | HubSpotListCartsResponse
  | HubSpotGetCartResponse
  | HubSpotListOwnersResponse
  | HubSpotListMarketingEventsResponse
  | HubSpotGetMarketingEventResponse
  | HubSpotListListsResponse
  | HubSpotGetListResponse
  | HubSpotCreateListResponse
  | HubSpotCreateNoteResponse
  | HubSpotGetNoteResponse
  | HubSpotListNotesResponse
  | HubSpotSearchNotesResponse
  | HubSpotCreateEmailResponse
  | HubSpotGetEmailResponse
  | HubSpotListEmailsResponse
  | HubSpotSearchEmailsResponse
  | HubSpotGetPropertiesResponse
  | HubSpotListAssociationsResponse
  | HubSpotCreateAssociationResponse
  | HubSpotDeleteAssociationResponse
  | HubSpotGetAssociationLabelsResponse
  | HubSpotDeleteContactResponse
  | HubSpotDeleteCompanyResponse
  | HubSpotDeleteDealResponse
  | HubSpotDeleteTicketResponse
  | HubSpotDeleteLineItemResponse
  | HubSpotAddListMembershipsResponse
  | HubSpotRemoveListMembershipsResponse
  | HubSpotGetListMembershipsResponse
  | HubSpotSearchLineItemsResponse
  | HubSpotSearchQuotesResponse
