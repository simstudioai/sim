import { HubspotIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { HubSpotResponse } from '@/tools/hubspot/types'
import { getTrigger } from '@/triggers'

export const HubSpotBlock: BlockConfig<HubSpotResponse> = {
  type: 'hubspot',
  name: 'HubSpot',
  description: 'Interact with HubSpot CRM or trigger workflows from HubSpot events',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate HubSpot into your workflow. Manage contacts, companies, deals, tickets, and other CRM objects with powerful automation capabilities. Can be used in trigger mode to start workflows when records are created, updated, a specific property changes, or a contact joins a list.',
  docsLink: 'https://docs.sim.ai/integrations/hubspot',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FF7A59',
  iconColor: '#FF7A59',
  icon: HubspotIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Contacts', id: 'get_contacts' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Search Contacts', id: 'search_contacts' },
        { label: 'Get Companies', id: 'get_companies' },
        { label: 'Create Company', id: 'create_company' },
        { label: 'Update Company', id: 'update_company' },
        { label: 'Search Companies', id: 'search_companies' },
        { label: 'Get Deals', id: 'get_deals' },
        { label: 'Create Deal', id: 'create_deal' },
        { label: 'Update Deal', id: 'update_deal' },
        { label: 'Search Deals', id: 'search_deals' },
        { label: 'Get Tickets', id: 'get_tickets' },
        { label: 'Create Ticket', id: 'create_ticket' },
        { label: 'Update Ticket', id: 'update_ticket' },
        { label: 'Search Tickets', id: 'search_tickets' },
        { label: 'Get Notes', id: 'get_notes' },
        { label: 'Create Note', id: 'create_note' },
        { label: 'Search Notes', id: 'search_notes' },
        { label: 'Get Emails', id: 'get_emails' },
        { label: 'Create Email', id: 'create_email' },
        { label: 'Search Emails', id: 'search_emails' },
        { label: 'Get Properties', id: 'get_properties' },
        { label: 'List Associations', id: 'list_associations' },
        { label: 'Create Association', id: 'create_association' },
        { label: 'Get Line Items', id: 'get_line_items' },
        { label: 'Create Line Item', id: 'create_line_item' },
        { label: 'Update Line Item', id: 'update_line_item' },
        { label: 'Get Quotes', id: 'get_quotes' },
        { label: 'Get Appointments', id: 'get_appointments' },
        { label: 'Create Appointment', id: 'create_appointment' },
        { label: 'Update Appointment', id: 'update_appointment' },
        { label: 'Get Carts', id: 'get_carts' },
        { label: 'List Owners', id: 'list_owners' },
        { label: 'Get Marketing Events', id: 'get_marketing_events' },
        { label: 'Get Lists', id: 'get_lists' },
        { label: 'Create List', id: 'create_list' },
        { label: 'Get Users', id: 'get_users' },
      ],
      value: () => 'get_contacts',
    },
    {
      id: 'credential',
      title: 'HubSpot Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'hubspot',
      requiredScopes: getScopesForService('hubspot'),
      placeholder: 'Select HubSpot account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'HubSpot Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'contactId',
      title: 'Contact ID or Email',
      type: 'short-input',
      placeholder: 'Leave empty to list all contacts',
      condition: { field: 'operation', value: 'get_contacts' },
    },
    {
      id: 'contactId',
      title: 'Contact ID or Email',
      type: 'short-input',
      placeholder: 'Numeric ID, or email (requires ID Property below)',
      condition: { field: 'operation', value: 'update_contact' },
      required: true,
    },
    {
      id: 'companyId',
      title: 'Company ID or Domain',
      type: 'short-input',
      placeholder: 'Leave empty to list all companies',
      condition: { field: 'operation', value: 'get_companies' },
    },
    {
      id: 'companyId',
      title: 'Company ID or Domain',
      type: 'short-input',
      placeholder: 'Numeric ID, or domain (requires ID Property below)',
      condition: { field: 'operation', value: 'update_company' },
      required: true,
    },
    {
      id: 'dealId',
      title: 'Deal ID',
      type: 'short-input',
      placeholder: 'Leave empty to list all deals',
      condition: { field: 'operation', value: 'get_deals' },
    },
    {
      id: 'dealId',
      title: 'Deal ID',
      type: 'short-input',
      placeholder: 'Numeric ID, or custom ID (requires ID Property below)',
      condition: { field: 'operation', value: 'update_deal' },
      required: true,
    },
    {
      id: 'ticketId',
      title: 'Ticket ID',
      type: 'short-input',
      placeholder: 'Leave empty to list all tickets',
      condition: { field: 'operation', value: 'get_tickets' },
    },
    {
      id: 'ticketId',
      title: 'Ticket ID',
      type: 'short-input',
      placeholder: 'Numeric ID, or custom ID (requires ID Property below)',
      condition: { field: 'operation', value: 'update_ticket' },
      required: true,
    },
    {
      id: 'noteId',
      title: 'Note ID',
      type: 'short-input',
      placeholder: 'Leave empty to list all notes',
      condition: { field: 'operation', value: 'get_notes' },
    },
    {
      id: 'emailId',
      title: 'Email ID',
      type: 'short-input',
      placeholder: 'Leave empty to list all emails',
      condition: { field: 'operation', value: 'get_emails' },
    },
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'short-input',
      placeholder: 'e.g., "contacts", "companies", "deals", "tickets"',
      condition: {
        field: 'operation',
        value: ['get_properties', 'list_associations', 'create_association'],
      },
      required: true,
    },
    {
      id: 'propertyName',
      title: 'Property Name',
      type: 'short-input',
      placeholder: 'Leave empty to return all properties (e.g., "hs_lead_status")',
      condition: { field: 'operation', value: 'get_properties' },
    },
    {
      id: 'archived',
      title: 'Archived Only',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_properties' },
    },
    {
      id: 'objectId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'ID of the source record',
      condition: { field: 'operation', value: ['list_associations', 'create_association'] },
      required: true,
    },
    {
      id: 'toObjectType',
      title: 'To Object Type',
      type: 'short-input',
      placeholder: 'e.g., "emails", "notes", "contacts"',
      condition: { field: 'operation', value: ['list_associations', 'create_association'] },
      required: true,
    },
    {
      id: 'toObjectId',
      title: 'To Record ID',
      type: 'short-input',
      placeholder: 'ID of the target record',
      condition: { field: 'operation', value: 'create_association' },
      required: true,
    },
    {
      id: 'associationCategory',
      title: 'Association Category',
      type: 'dropdown',
      options: [
        { label: 'HubSpot Defined', id: 'HUBSPOT_DEFINED' },
        { label: 'User Defined', id: 'USER_DEFINED' },
        { label: 'Integrator Defined', id: 'INTEGRATOR_DEFINED' },
      ],
      value: () => 'HUBSPOT_DEFINED',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_association' },
    },
    {
      id: 'associationTypeId',
      title: 'Association Type ID',
      type: 'short-input',
      placeholder: 'Leave empty for the default association (e.g., 198 = email→contact)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_association' },
    },
    {
      id: 'lineItemId',
      title: 'Line Item ID',
      type: 'short-input',
      placeholder: 'Leave empty to list all line items',
      condition: { field: 'operation', value: 'get_line_items' },
    },
    {
      id: 'lineItemId',
      title: 'Line Item ID',
      type: 'short-input',
      placeholder: 'Numeric ID, or custom ID (requires ID Property below)',
      condition: { field: 'operation', value: 'update_line_item' },
      required: true,
    },
    {
      id: 'quoteId',
      title: 'Quote ID',
      type: 'short-input',
      placeholder: 'Leave empty to list all quotes',
      condition: { field: 'operation', value: 'get_quotes' },
    },
    {
      id: 'appointmentId',
      title: 'Appointment ID',
      type: 'short-input',
      placeholder: 'Leave empty to list all appointments',
      condition: { field: 'operation', value: 'get_appointments' },
    },
    {
      id: 'appointmentId',
      title: 'Appointment ID',
      type: 'short-input',
      placeholder: 'Numeric ID, or custom ID (requires ID Property below)',
      condition: { field: 'operation', value: 'update_appointment' },
      required: true,
    },
    {
      id: 'cartId',
      title: 'Cart ID',
      type: 'short-input',
      placeholder: 'Leave empty to list all carts',
      condition: { field: 'operation', value: 'get_carts' },
    },
    {
      id: 'eventId',
      title: 'Marketing Event ID',
      type: 'short-input',
      placeholder: 'Leave empty to list all marketing events',
      condition: { field: 'operation', value: 'get_marketing_events' },
    },
    {
      id: 'listId',
      title: 'List ID',
      type: 'short-input',
      placeholder: 'Leave empty to search all lists',
      condition: { field: 'operation', value: 'get_lists' },
    },
    {
      id: 'listName',
      title: 'List Name',
      type: 'short-input',
      placeholder: 'Name for the new list',
      condition: { field: 'operation', value: 'create_list' },
      required: true,
    },
    {
      id: 'objectTypeId',
      title: 'Object Type ID',
      type: 'short-input',
      placeholder: 'e.g., "0-1" for contacts, "0-2" for companies',
      condition: { field: 'operation', value: 'create_list' },
      required: true,
    },
    {
      id: 'processingType',
      title: 'Processing Type',
      type: 'dropdown',
      options: [
        { label: 'Manual (Static)', id: 'MANUAL' },
        { label: 'Dynamic (Active)', id: 'DYNAMIC' },
      ],
      condition: { field: 'operation', value: 'create_list' },
      required: true,
    },
    {
      id: 'idProperty',
      title: 'ID Property',
      type: 'short-input',
      placeholder: 'Required if using email/domain (e.g., "email" or "domain")',
      condition: {
        field: 'operation',
        value: [
          'get_contacts',
          'update_contact',
          'get_companies',
          'update_company',
          'get_deals',
          'update_deal',
          'get_tickets',
          'update_ticket',
          'get_line_items',
          'update_line_item',
          'get_quotes',
          'get_appointments',
          'update_appointment',
        ],
      },
    },
    {
      id: 'propertiesToSet',
      title: 'Properties',
      type: 'long-input',
      placeholder:
        'JSON object with properties (e.g., {"email": "test@example.com", "firstname": "John"})',
      condition: {
        field: 'operation',
        value: [
          'create_contact',
          'update_contact',
          'create_company',
          'update_company',
          'create_deal',
          'update_deal',
          'create_ticket',
          'update_ticket',
          'create_line_item',
          'update_line_item',
          'create_appointment',
          'update_appointment',
          'create_note',
          'create_email',
        ],
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert HubSpot CRM developer. Generate HubSpot property objects as JSON based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON object with HubSpot properties. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw JSON object that can be used directly in HubSpot API create/update operations.

### HUBSPOT PROPERTIES STRUCTURE
HubSpot properties are defined as a flat JSON object with property names as keys and their values as the corresponding values. Property names must match HubSpot's internal property names (usually lowercase, snake_case or no spaces).

### COMMON CONTACT PROPERTIES
**Standard Properties**:
- **email**: Email address (required for most operations)
- **firstname**: First name
- **lastname**: Last name
- **phone**: Phone number
- **mobilephone**: Mobile phone number
- **company**: Company name
- **jobtitle**: Job title
- **website**: Website URL
- **address**: Street address
- **city**: City
- **state**: State/Region
- **zip**: Postal code
- **country**: Country
- **lifecyclestage**: Lifecycle stage (e.g., "lead", "customer", "subscriber", "opportunity")
- **hs_lead_status**: Lead status (e.g., "NEW", "OPEN", "IN_PROGRESS", "QUALIFIED")

**Additional Properties**:
- **salutation**: Salutation (e.g., "Mr.", "Ms.", "Dr.")
- **degree**: Degree
- **industry**: Industry
- **fax**: Fax number
- **numemployees**: Number of employees (for companies)
- **annualrevenue**: Annual revenue (for companies)

### COMMON COMPANY PROPERTIES
**Standard Properties**:
- **name**: Company name (required)
- **domain**: Company domain (e.g., "example.com")
- **city**: City
- **state**: State/Region
- **zip**: Postal code
- **country**: Country
- **phone**: Phone number
- **industry**: Industry
- **type**: Company type (e.g., "PROSPECT", "PARTNER", "RESELLER", "VENDOR", "OTHER")
- **description**: Company description
- **website**: Website URL
- **numberofemployees**: Number of employees
- **annualrevenue**: Annual revenue

**Additional Properties**:
- **timezone**: Timezone
- **linkedin_company_page**: LinkedIn URL
- **twitterhandle**: Twitter handle
- **facebook_company_page**: Facebook URL
- **founded_year**: Year founded

### EXAMPLES

**Simple Contact**: "Create contact with email john@example.com and name John Doe"
→ {
  "email": "john@example.com",
  "firstname": "John",
  "lastname": "Doe"
}

**Complete Contact**: "Create a lead contact with full details"
→ {
  "email": "jane.smith@acme.com",
  "firstname": "Jane",
  "lastname": "Smith",
  "phone": "+1-555-123-4567",
  "company": "Acme Corp",
  "jobtitle": "Marketing Manager",
  "website": "https://acme.com",
  "city": "San Francisco",
  "state": "California",
  "country": "United States",
  "lifecyclestage": "lead",
  "hs_lead_status": "NEW"
}

**Simple Company**: "Create company Acme Corp with domain acme.com"
→ {
  "name": "Acme Corp",
  "domain": "acme.com"
}

**Complete Company**: "Create a technology company with full details"
→ {
  "name": "TechStart Inc",
  "domain": "techstart.io",
  "industry": "TECHNOLOGY",
  "phone": "+1-555-987-6543",
  "city": "Austin",
  "state": "Texas",
  "country": "United States",
  "website": "https://techstart.io",
  "description": "Innovative software solutions",
  "numberofemployees": 50,
  "annualrevenue": 5000000,
  "type": "PROSPECT"
}

**Update Contact**: "Update contact phone and job title"
→ {
  "phone": "+1-555-999-8888",
  "jobtitle": "Senior Manager"
}

### REMEMBER
Return ONLY the JSON object with properties - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the properties you want to set...',
        generationType: 'json-object',
      },
    },
    {
      id: 'properties',
      title: 'Properties to Return',
      type: 'short-input',
      placeholder: 'Comma-separated list (e.g., "email,firstname,lastname")',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_contacts',
          'get_companies',
          'get_deals',
          'get_tickets',
          'get_notes',
          'get_emails',
          'get_line_items',
          'get_quotes',
          'get_appointments',
          'get_carts',
          'get_users',
        ],
      },
    },
    {
      id: 'associations',
      title: 'Associations',
      type: 'short-input',
      placeholder: 'Comma-separated object types (e.g., "companies,deals")',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_contacts',
          'get_companies',
          'get_deals',
          'get_tickets',
          'get_notes',
          'get_emails',
          'get_line_items',
          'get_quotes',
          'get_appointments',
          'get_carts',
          'create_contact',
          'create_company',
          'create_deal',
          'create_ticket',
          'create_line_item',
          'create_appointment',
          'create_note',
          'create_email',
        ],
      },
    },
    {
      id: 'limit',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'Max results (list: 100, search: 200)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_users',
          'get_contacts',
          'get_companies',
          'get_deals',
          'get_tickets',
          'get_notes',
          'get_emails',
          'get_line_items',
          'get_quotes',
          'get_appointments',
          'get_carts',
          'list_owners',
          'list_associations',
          'get_marketing_events',
          'get_lists',
          'search_contacts',
          'search_companies',
          'search_deals',
          'search_tickets',
          'search_notes',
          'search_emails',
        ],
      },
    },
    {
      id: 'after',
      title: 'Pagination Cursor',
      type: 'short-input',
      placeholder: 'Cursor from previous response paging.next.after',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_contacts',
          'get_companies',
          'get_deals',
          'get_tickets',
          'get_notes',
          'get_emails',
          'get_line_items',
          'get_quotes',
          'get_appointments',
          'get_carts',
          'list_owners',
          'list_associations',
          'get_users',
          'get_marketing_events',
          'get_lists',
          'search_contacts',
          'search_companies',
          'search_deals',
          'search_tickets',
          'search_notes',
          'search_emails',
        ],
      },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search term (e.g., company name, contact email)',
      condition: {
        field: 'operation',
        value: [
          'search_contacts',
          'search_companies',
          'search_deals',
          'search_tickets',
          'search_notes',
          'search_emails',
          'get_lists',
        ],
      },
    },
    {
      id: 'filterGroups',
      title: 'Filter Groups',
      type: 'long-input',
      placeholder:
        'JSON array of filter groups (e.g., [{"filters":[{"propertyName":"email","operator":"EQ","value":"test@example.com"}]}])',
      condition: {
        field: 'operation',
        value: [
          'search_contacts',
          'search_companies',
          'search_deals',
          'search_tickets',
          'search_notes',
          'search_emails',
        ],
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert HubSpot CRM developer. Generate HubSpot filter groups as JSON arrays based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON array of filter groups. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw JSON array that can be used directly in HubSpot API search operations.

### HUBSPOT FILTER GROUPS STRUCTURE
Filter groups are arrays of filter objects. Each filter group contains an array of filters. Multiple filter groups are combined with OR logic, while filters within a group are combined with AND logic.

Structure:
[
  {
    "filters": [
      {
        "propertyName": "property_name",
        "operator": "OPERATOR",
        "value": "value"
      }
    ]
  }
]

### FILTER OPERATORS
HubSpot supports the following operators:

**Comparison Operators**:
- **EQ**: Equals - exact match
- **NEQ**: Not equals
- **LT**: Less than (for numbers and dates)
- **LTE**: Less than or equal to
- **GT**: Greater than (for numbers and dates)
- **GTE**: Greater than or equal to
- **BETWEEN**: Between two values (requires "highValue" field)

**String Operators**:
- **CONTAINS_TOKEN**: Contains the token (word)
- **NOT_CONTAINS_TOKEN**: Does not contain the token

**Existence Operators**:
- **HAS_PROPERTY**: Property has any value (value can be "*")
- **NOT_HAS_PROPERTY**: Property has no value (value can be "*")

**Set Operators**:
- **IN**: Value is in the provided list (value is semicolon-separated)
- **NOT_IN**: Value is not in the provided list

### COMMON CONTACT PROPERTIES FOR FILTERING
- **email**: Email address
- **firstname**: First name
- **lastname**: Last name
- **lifecyclestage**: Lifecycle stage (lead, customer, subscriber, opportunity)
- **hs_lead_status**: Lead status (NEW, OPEN, IN_PROGRESS, QUALIFIED)
- **createdate**: Creation date (milliseconds timestamp)
- **lastmodifieddate**: Last modified date
- **phone**: Phone number
- **company**: Company name
- **jobtitle**: Job title

### COMMON COMPANY PROPERTIES FOR FILTERING
- **name**: Company name
- **domain**: Company domain
- **industry**: Industry
- **type**: Company type
- **city**: City
- **state**: State
- **country**: Country
- **numberofemployees**: Number of employees
- **annualrevenue**: Annual revenue
- **createdate**: Creation date

### EXAMPLES

**Simple Equality**: "Find contacts with email john@example.com"
→ [
  {
    "filters": [
      {
        "propertyName": "email",
        "operator": "EQ",
        "value": "john@example.com"
      }
    ]
  }
]

**Multiple Filters (AND)**: "Find lead contacts in San Francisco"
→ [
  {
    "filters": [
      {
        "propertyName": "lifecyclestage",
        "operator": "EQ",
        "value": "lead"
      },
      {
        "propertyName": "city",
        "operator": "EQ",
        "value": "San Francisco"
      }
    ]
  }
]

**Multiple Filter Groups (OR)**: "Find contacts who are either leads or customers"
→ [
  {
    "filters": [
      {
        "propertyName": "lifecyclestage",
        "operator": "EQ",
        "value": "lead"
      }
    ]
  },
  {
    "filters": [
      {
        "propertyName": "lifecyclestage",
        "operator": "EQ",
        "value": "customer"
      }
    ]
  }
]

**Contains Text**: "Find contacts with Gmail addresses"
→ [
  {
    "filters": [
      {
        "propertyName": "email",
        "operator": "CONTAINS_TOKEN",
        "value": "@gmail.com"
      }
    ]
  }
]

**IN Operator**: "Find companies in tech or finance industries"
→ [
  {
    "filters": [
      {
        "propertyName": "industry",
        "operator": "IN",
        "value": "TECHNOLOGY;FINANCE"
      }
    ]
  }
]

**Has Property**: "Find contacts with phone numbers"
→ [
  {
    "filters": [
      {
        "propertyName": "phone",
        "operator": "HAS_PROPERTY",
        "value": "*"
      }
    ]
  }
]

**Range Filter**: "Find companies with 10 to 100 employees"
→ [
  {
    "filters": [
      {
        "propertyName": "numberofemployees",
        "operator": "GTE",
        "value": "10"
      },
      {
        "propertyName": "numberofemployees",
        "operator": "LTE",
        "value": "100"
      }
    ]
  }
]

### REMEMBER
Return ONLY the JSON array of filter groups - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the filters you want to apply...',
        generationType: 'json-object',
      },
    },
    {
      id: 'sorts',
      title: 'Sort Order',
      type: 'long-input',
      placeholder:
        'JSON array of sort objects (e.g., [{"propertyName":"createdate","direction":"DESCENDING"}])',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'search_contacts',
          'search_companies',
          'search_deals',
          'search_tickets',
          'search_notes',
          'search_emails',
        ],
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert HubSpot CRM developer. Generate HubSpot sort arrays as JSON based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON array of sort objects. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw JSON array that can be used directly in HubSpot API search operations.

### HUBSPOT SORT STRUCTURE
Sorts are defined as an array of objects, each containing a property name and a direction. Results will be sorted by the first sort object, then by the second if values are equal, and so on.

Structure:
[
  {
    "propertyName": "property_name",
    "direction": "ASCENDING" | "DESCENDING"
  }
]

### SORT DIRECTIONS
- **ASCENDING**: Sort from lowest to highest (A-Z, 0-9, oldest to newest)
- **DESCENDING**: Sort from highest to lowest (Z-A, 9-0, newest to oldest)

### COMMON SORTABLE PROPERTIES

**Contact Properties**:
- **createdate**: Creation date (when the contact was created)
- **lastmodifieddate**: Last modified date (when the contact was last updated)
- **firstname**: First name (alphabetical)
- **lastname**: Last name (alphabetical)
- **email**: Email address (alphabetical)
- **lifecyclestage**: Lifecycle stage
- **hs_lead_status**: Lead status
- **company**: Company name (alphabetical)
- **jobtitle**: Job title (alphabetical)
- **phone**: Phone number

**Company Properties**:
- **createdate**: Creation date
- **lastmodifieddate**: Last modified date
- **name**: Company name (alphabetical)
- **domain**: Domain (alphabetical)
- **industry**: Industry
- **city**: City (alphabetical)
- **state**: State (alphabetical)
- **numberofemployees**: Number of employees (numeric)
- **annualrevenue**: Annual revenue (numeric)

### EXAMPLES

**Simple Sort**: "Sort by creation date, newest first"
→ [
  {
    "propertyName": "createdate",
    "direction": "DESCENDING"
  }
]

**Alphabetical Sort**: "Sort contacts by last name A to Z"
→ [
  {
    "propertyName": "lastname",
    "direction": "ASCENDING"
  }
]

**Multiple Sorts**: "Sort by lifecycle stage, then by last name"
→ [
  {
    "propertyName": "lifecyclestage",
    "direction": "ASCENDING"
  },
  {
    "propertyName": "lastname",
    "direction": "ASCENDING"
  }
]

**Numeric Sort**: "Sort companies by revenue, highest first"
→ [
  {
    "propertyName": "annualrevenue",
    "direction": "DESCENDING"
  }
]

**Recent First**: "Show most recently updated contacts first"
→ [
  {
    "propertyName": "lastmodifieddate",
    "direction": "DESCENDING"
  }
]

**Name and Date**: "Sort by company name, then by creation date newest first"
→ [
  {
    "propertyName": "name",
    "direction": "ASCENDING"
  },
  {
    "propertyName": "createdate",
    "direction": "DESCENDING"
  }
]

### REMEMBER
Return ONLY the JSON array of sort objects - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe how you want to sort the results...',
        generationType: 'json-object',
      },
    },
    {
      id: 'searchProperties',
      title: 'Properties to Return',
      type: 'long-input',
      placeholder: 'JSON array of properties (e.g., ["email","firstname","lastname"])',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'search_contacts',
          'search_companies',
          'search_deals',
          'search_tickets',
          'search_notes',
          'search_emails',
        ],
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert HubSpot CRM developer. Generate HubSpot property arrays as JSON based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON array of property names. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw JSON array of strings that can be used directly in HubSpot API search operations.

### HUBSPOT PROPERTIES ARRAY STRUCTURE
Properties to return are defined as a simple array of property name strings. These specify which fields should be included in the search results.

Structure:
["property1", "property2", "property3"]

### COMMON CONTACT PROPERTIES

**Basic Information**:
- **email**: Email address
- **firstname**: First name
- **lastname**: Last name
- **phone**: Phone number
- **mobilephone**: Mobile phone number

**Professional Information**:
- **company**: Company name
- **jobtitle**: Job title
- **industry**: Industry
- **department**: Department
- **seniority**: Seniority level

**Address Information**:
- **address**: Street address
- **city**: City
- **state**: State/Region
- **zip**: Postal code
- **country**: Country

**CRM Information**:
- **lifecyclestage**: Lifecycle stage
- **hs_lead_status**: Lead status
- **hubspot_owner_id**: Owner ID
- **hs_analytics_source**: Original source

**Dates**:
- **createdate**: Creation date
- **lastmodifieddate**: Last modified date
- **hs_lifecyclestage_lead_date**: Lead date
- **hs_lifecyclestage_customer_date**: Customer date

**Website & Social**:
- **website**: Website URL
- **linkedin_url**: LinkedIn profile URL
- **twitterhandle**: Twitter handle

### COMMON COMPANY PROPERTIES

**Basic Information**:
- **name**: Company name
- **domain**: Company domain
- **phone**: Phone number
- **industry**: Industry
- **type**: Company type

**Address Information**:
- **city**: City
- **state**: State/Region
- **zip**: Postal code
- **country**: Country
- **address**: Street address

**Business Information**:
- **numberofemployees**: Number of employees
- **annualrevenue**: Annual revenue
- **founded_year**: Year founded
- **description**: Company description

**Website & Social**:
- **website**: Website URL
- **linkedin_company_page**: LinkedIn company page
- **twitterhandle**: Twitter handle
- **facebook_company_page**: Facebook page

**CRM Information**:
- **hubspot_owner_id**: Owner ID
- **createdate**: Creation date
- **lastmodifieddate**: Last modified date
- **hs_lastmodifieddate**: Last modified date (detailed)

### EXAMPLES

**Basic Contact Fields**: "Return email, name, and phone"
→ ["email", "firstname", "lastname", "phone"]

**Complete Contact Profile**: "Return all contact details"
→ ["email", "firstname", "lastname", "phone", "mobilephone", "company", "jobtitle", "address", "city", "state", "zip", "country", "lifecyclestage", "hs_lead_status", "createdate"]

**Business Contact Info**: "Return professional information"
→ ["email", "firstname", "lastname", "company", "jobtitle", "phone", "industry"]

**Basic Company Fields**: "Return company name, domain, and industry"
→ ["name", "domain", "industry"]

**Complete Company Profile**: "Return all company information"
→ ["name", "domain", "industry", "phone", "city", "state", "country", "numberofemployees", "annualrevenue", "website", "description", "type", "createdate"]

**Contact with Dates**: "Return contact info with timestamps"
→ ["email", "firstname", "lastname", "createdate", "lastmodifieddate", "lifecyclestage"]

**Company Financial Info**: "Return company size and revenue"
→ ["name", "domain", "numberofemployees", "annualrevenue", "industry"]

**Social Media Properties**: "Return social media links"
→ ["email", "firstname", "lastname", "linkedin_url", "twitterhandle"]

**CRM Status Fields**: "Return lifecycle and owner information"
→ ["email", "firstname", "lastname", "lifecyclestage", "hs_lead_status", "hubspot_owner_id"]

### REMEMBER
Return ONLY the JSON array of property names - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe which properties you want to return...',
        generationType: 'json-object',
      },
    },
    ...getTrigger('hubspot_poller').subBlocks,
  ],
  tools: {
    access: [
      'hubspot_get_users',
      'hubspot_list_contacts',
      'hubspot_get_contact',
      'hubspot_create_contact',
      'hubspot_update_contact',
      'hubspot_search_contacts',
      'hubspot_list_companies',
      'hubspot_get_company',
      'hubspot_create_company',
      'hubspot_update_company',
      'hubspot_search_companies',
      'hubspot_list_deals',
      'hubspot_get_deal',
      'hubspot_create_deal',
      'hubspot_update_deal',
      'hubspot_search_deals',
      'hubspot_list_tickets',
      'hubspot_get_ticket',
      'hubspot_create_ticket',
      'hubspot_update_ticket',
      'hubspot_search_tickets',
      'hubspot_list_notes',
      'hubspot_get_note',
      'hubspot_create_note',
      'hubspot_search_notes',
      'hubspot_list_emails',
      'hubspot_get_email',
      'hubspot_create_email',
      'hubspot_search_emails',
      'hubspot_get_properties',
      'hubspot_list_associations',
      'hubspot_create_association',
      'hubspot_list_line_items',
      'hubspot_get_line_item',
      'hubspot_create_line_item',
      'hubspot_update_line_item',
      'hubspot_list_quotes',
      'hubspot_get_quote',
      'hubspot_list_appointments',
      'hubspot_get_appointment',
      'hubspot_create_appointment',
      'hubspot_update_appointment',
      'hubspot_list_carts',
      'hubspot_get_cart',
      'hubspot_list_owners',
      'hubspot_list_marketing_events',
      'hubspot_get_marketing_event',
      'hubspot_list_lists',
      'hubspot_get_list',
      'hubspot_create_list',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_users':
            return 'hubspot_get_users'
          case 'get_contacts':
            return params.contactId ? 'hubspot_get_contact' : 'hubspot_list_contacts'
          case 'create_contact':
            return 'hubspot_create_contact'
          case 'update_contact':
            return 'hubspot_update_contact'
          case 'search_contacts':
            return 'hubspot_search_contacts'
          case 'get_companies':
            return params.companyId ? 'hubspot_get_company' : 'hubspot_list_companies'
          case 'create_company':
            return 'hubspot_create_company'
          case 'update_company':
            return 'hubspot_update_company'
          case 'search_companies':
            return 'hubspot_search_companies'
          case 'get_deals':
            return params.dealId ? 'hubspot_get_deal' : 'hubspot_list_deals'
          case 'create_deal':
            return 'hubspot_create_deal'
          case 'update_deal':
            return 'hubspot_update_deal'
          case 'search_deals':
            return 'hubspot_search_deals'
          case 'get_tickets':
            return params.ticketId ? 'hubspot_get_ticket' : 'hubspot_list_tickets'
          case 'create_ticket':
            return 'hubspot_create_ticket'
          case 'update_ticket':
            return 'hubspot_update_ticket'
          case 'search_tickets':
            return 'hubspot_search_tickets'
          case 'get_notes':
            return params.noteId ? 'hubspot_get_note' : 'hubspot_list_notes'
          case 'create_note':
            return 'hubspot_create_note'
          case 'search_notes':
            return 'hubspot_search_notes'
          case 'get_emails':
            return params.emailId ? 'hubspot_get_email' : 'hubspot_list_emails'
          case 'create_email':
            return 'hubspot_create_email'
          case 'search_emails':
            return 'hubspot_search_emails'
          case 'get_properties':
            return 'hubspot_get_properties'
          case 'list_associations':
            return 'hubspot_list_associations'
          case 'create_association':
            return 'hubspot_create_association'
          case 'get_line_items':
            return params.lineItemId ? 'hubspot_get_line_item' : 'hubspot_list_line_items'
          case 'create_line_item':
            return 'hubspot_create_line_item'
          case 'update_line_item':
            return 'hubspot_update_line_item'
          case 'get_quotes':
            return params.quoteId ? 'hubspot_get_quote' : 'hubspot_list_quotes'
          case 'get_appointments':
            return params.appointmentId ? 'hubspot_get_appointment' : 'hubspot_list_appointments'
          case 'create_appointment':
            return 'hubspot_create_appointment'
          case 'update_appointment':
            return 'hubspot_update_appointment'
          case 'get_carts':
            return params.cartId ? 'hubspot_get_cart' : 'hubspot_list_carts'
          case 'list_owners':
            return 'hubspot_list_owners'
          case 'get_marketing_events':
            return params.eventId ? 'hubspot_get_marketing_event' : 'hubspot_list_marketing_events'
          case 'get_lists':
            return params.listId ? 'hubspot_get_list' : 'hubspot_list_lists'
          case 'create_list':
            return 'hubspot_create_list'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          operation,
          propertiesToSet,
          properties,
          searchProperties,
          filterGroups,
          sorts,
          associations,
          listName,
          associationTypeId,
          archived,
          ...rest
        } = params

        const cleanParams: Record<string, any> = {
          oauthCredential,
        }

        const createUpdateOps = [
          'create_contact',
          'update_contact',
          'create_company',
          'update_company',
          'create_deal',
          'update_deal',
          'create_ticket',
          'update_ticket',
          'create_line_item',
          'update_line_item',
          'create_appointment',
          'update_appointment',
          'create_note',
          'create_email',
        ]
        if (propertiesToSet && createUpdateOps.includes(operation as string)) {
          cleanParams.properties = propertiesToSet
        }

        const getListOps = [
          'get_contacts',
          'get_companies',
          'get_deals',
          'get_tickets',
          'get_notes',
          'get_emails',
          'get_line_items',
          'get_quotes',
          'get_appointments',
          'get_carts',
          'get_users',
        ]
        if (properties && !searchProperties && getListOps.includes(operation as string)) {
          cleanParams.properties = properties
        }

        const searchOps = [
          'search_contacts',
          'search_companies',
          'search_deals',
          'search_tickets',
          'search_notes',
          'search_emails',
        ]
        if (searchProperties && searchOps.includes(operation as string)) {
          cleanParams.properties = searchProperties
        }

        if (filterGroups && searchOps.includes(operation as string)) {
          cleanParams.filterGroups = filterGroups
        }

        if (sorts && searchOps.includes(operation as string)) {
          cleanParams.sorts = sorts
        }

        const associationOps = [
          ...getListOps,
          'create_contact',
          'create_company',
          'create_deal',
          'create_ticket',
          'create_line_item',
          'create_appointment',
          'create_note',
          'create_email',
        ]
        if (associations && associationOps.includes(operation as string)) {
          cleanParams.associations = associations
        }

        if (listName && operation === 'create_list') {
          cleanParams.name = listName
        }

        if (
          operation === 'create_association' &&
          associationTypeId !== undefined &&
          associationTypeId !== ''
        ) {
          cleanParams.associationTypeId = Number(associationTypeId)
        }

        if (operation === 'get_properties' && archived !== undefined && archived !== '') {
          cleanParams.archived = archived === true || archived === 'true'
        }

        if (operation === 'get_lists') {
          if (rest.limit) {
            cleanParams.count = rest.limit
            rest.limit = undefined
          }
          if (rest.after) {
            cleanParams.offset = rest.after
            rest.after = undefined
          }
        }

        const excludeKeys = [
          'propertiesToSet',
          'properties',
          'searchProperties',
          'filterGroups',
          'sorts',
          'associations',
          'listName',
        ]
        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '' && !excludeKeys.includes(key)) {
            cleanParams[key] = value
          }
        })

        return cleanParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'HubSpot access token' },
    contactId: { type: 'string', description: 'Contact ID or email' },
    companyId: { type: 'string', description: 'Company ID or domain' },
    dealId: { type: 'string', description: 'Deal ID' },
    ticketId: { type: 'string', description: 'Ticket ID' },
    lineItemId: { type: 'string', description: 'Line item ID' },
    quoteId: { type: 'string', description: 'Quote ID' },
    appointmentId: { type: 'string', description: 'Appointment ID' },
    cartId: { type: 'string', description: 'Cart ID' },
    eventId: { type: 'string', description: 'Marketing event ID' },
    listId: { type: 'string', description: 'List ID' },
    noteId: { type: 'string', description: 'Note ID' },
    emailId: { type: 'string', description: 'Email engagement ID' },
    objectType: { type: 'string', description: 'Object type (e.g., contacts, companies, deals)' },
    propertyName: { type: 'string', description: 'Single property name to retrieve' },
    archived: { type: 'boolean', description: 'Whether to return only archived properties' },
    objectId: { type: 'string', description: 'Source record ID for associations' },
    toObjectType: { type: 'string', description: 'Target object type for associations' },
    toObjectId: { type: 'string', description: 'Target record ID for associations' },
    associationCategory: { type: 'string', description: 'Association category for a labeled link' },
    associationTypeId: { type: 'number', description: 'Association type ID for a labeled link' },
    idProperty: { type: 'string', description: 'Property name to use as unique identifier' },
    propertiesToSet: { type: 'json', description: 'Properties to create/update (JSON object)' },
    properties: {
      type: 'string',
      description: 'Comma-separated properties to return (for list/get)',
    },
    associations: { type: 'string', description: 'Comma-separated object types for associations' },
    limit: { type: 'string', description: 'Maximum results per page' },
    after: { type: 'string', description: 'Pagination cursor' },
    query: { type: 'string', description: 'Search query string' },
    filterGroups: { type: 'json', description: 'Filter groups for search (JSON array)' },
    sorts: { type: 'json', description: 'Sort order (JSON array of strings or objects)' },
    searchProperties: { type: 'json', description: 'Properties to return in search (JSON array)' },
    listName: { type: 'string', description: 'Name for new list' },
    objectTypeId: { type: 'string', description: 'Object type ID for list' },
    processingType: { type: 'string', description: 'List processing type (MANUAL or DYNAMIC)' },
  },
  outputs: {
    users: { type: 'json', description: 'Array of user objects' },
    contacts: { type: 'json', description: 'Array of contact objects' },
    contact: { type: 'json', description: 'Single contact object' },
    companies: { type: 'json', description: 'Array of company objects' },
    company: { type: 'json', description: 'Single company object' },
    deals: { type: 'json', description: 'Array of deal objects' },
    deal: { type: 'json', description: 'Single deal object' },
    tickets: { type: 'json', description: 'Array of ticket objects' },
    ticket: { type: 'json', description: 'Single ticket object' },
    lineItems: { type: 'json', description: 'Array of line item objects' },
    lineItem: { type: 'json', description: 'Single line item object' },
    quotes: { type: 'json', description: 'Array of quote objects' },
    quote: { type: 'json', description: 'Single quote object' },
    appointments: { type: 'json', description: 'Array of appointment objects' },
    appointment: { type: 'json', description: 'Single appointment object' },
    carts: { type: 'json', description: 'Array of cart objects' },
    cart: { type: 'json', description: 'Single cart object' },
    owners: { type: 'json', description: 'Array of owner objects' },
    events: { type: 'json', description: 'Array of marketing event objects' },
    event: { type: 'json', description: 'Single marketing event object' },
    lists: { type: 'json', description: 'Array of list objects' },
    list: { type: 'json', description: 'Single list object' },
    notes: { type: 'json', description: 'Array of note objects' },
    note: { type: 'json', description: 'Single note object' },
    emails: { type: 'json', description: 'Array of email engagement objects' },
    email: { type: 'json', description: 'Single email engagement object' },
    properties: {
      type: 'json',
      description: 'Array of property definitions (name, label, type, fieldType, options)',
    },
    results: {
      type: 'json',
      description: 'Array of associated records (toObjectId, associationTypes)',
    },
    fromObjectId: { type: 'string', description: 'Source record ID (for create association)' },
    toObjectId: {
      type: 'string',
      description: 'Associated target record ID (for create association)',
    },
    labels: { type: 'json', description: 'Association labels (for create association)' },
    total: { type: 'number', description: 'Total number of matching results (for search)' },
    paging: { type: 'json', description: 'Pagination info with next/prev cursors' },
    metadata: { type: 'json', description: 'Operation metadata' },
    success: { type: 'boolean', description: 'Operation success status' },
  } as any,
  triggerAllowed: true,
  triggers: {
    enabled: true,
    available: ['hubspot_poller'],
  },
}

export const HubSpotBlockMeta = {
  tags: ['marketing', 'sales-engagement', 'customer-support'],
  url: 'https://www.hubspot.com',
  templates: [
    {
      icon: HubspotIcon,
      title: 'HubSpot deal search',
      prompt:
        'Create a knowledge base connected to my HubSpot account so all deals, contacts, and activity history are automatically synced and searchable. Then build an agent I can ask things like "what happened with the Stripe integration deal?" or "which deals closed last quarter over $50k?" and get answers with HubSpot record links.',
      modules: ['knowledge-base', 'agent'],
      category: 'sales',
      tags: ['sales', 'crm', 'research'],
    },
    {
      icon: HubspotIcon,
      title: 'Win/loss analyzer',
      prompt:
        'Build a workflow that pulls closed deals from HubSpot each week, analyzes patterns in wins vs losses — deal size, industry, sales cycle length, objections — and generates a report file with actionable insights on what to change. Schedule it to run every Monday.',
      modules: ['agent', 'files', 'scheduled', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'analysis', 'reporting'],
    },

    {
      icon: HubspotIcon,
      title: 'Get HubSpot deal alerts in Slack',
      prompt:
        'Build a workflow that watches HubSpot for deal stage changes, new contacts, and revenue milestones, then posts instant Slack notifications to your sales team.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['slack'],
    },
    {
      icon: HubspotIcon,
      title: 'Send personalised emails from HubSpot events',
      prompt:
        'Build a workflow that triggers whenever a HubSpot contact enters a new lifecycle stage and sends a personalised Gmail message tailored to that stage.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['gmail'],
    },
    {
      icon: HubspotIcon,
      title: 'HubSpot lead enrichment and dedupe',
      prompt:
        'Build a workflow that on a new HubSpot contact searches for existing duplicates, enriches the record with company size, industry, and verified email, and updates the contact and its associated company with the cleaned data.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation', 'enrichment'],
    },
    {
      icon: HubspotIcon,
      title: 'HubSpot pipeline weekly digest',
      prompt:
        'Create a scheduled weekly workflow that lists HubSpot deals by stage, computes movement and at-risk deals with an agent, logs the snapshot to a table, and emails a pipeline summary to the sales leadership team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting', 'crm'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: HubspotIcon,
      title: 'HubSpot ticket triage',
      prompt:
        'Build a workflow that on a new HubSpot support ticket classifies priority and topic, adds a triage note, associates it with the right company, and posts an alert to the support Slack channel for high-priority cases.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'crm'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HubspotIcon,
      title: 'Backfill HubSpot contact email history from Gmail',
      prompt:
        'Build a workflow that finds HubSpot contacts in the lead stage with no logged email activity, searches my Gmail for each person’s thread, and logs it back to HubSpot as an email engagement associated with the contact.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'upsert-contact',
      description:
        'Find a HubSpot contact by email and update it, or create it if it does not exist.',
      content:
        '# Upsert Contact\n\nKeep a contact record current without creating duplicates.\n\n## Steps\n1. Search contacts by the email address to check if the person already exists.\n2. If a match is found, update the contact with the new property values.\n3. If no match exists, create a new contact with the email and known properties.\n4. Read the contact back to confirm the final property values.\n\n## Output\nReturn the contact ID and whether it was created or updated, along with the properties that were set.',
    },
    {
      name: 'create-deal-for-account',
      description: 'Create a HubSpot deal and associate it with the right company and contact.',
      content:
        '# Create Deal For Account\n\nLog a new opportunity tied to the correct account.\n\n## Steps\n1. Search companies to resolve the company by name or domain; create it if missing.\n2. Search contacts to find the primary contact for the deal.\n3. Create the deal with name, amount, pipeline, and stage, associating it with the company and contact.\n4. Read the deal back to confirm associations and stage.\n\n## Output\nReturn the deal ID, its stage and amount, and the associated company and contact IDs.',
    },
    {
      name: 'triage-support-ticket',
      description:
        'Classify a HubSpot ticket, set priority, and associate it with the correct company.',
      content:
        '# Triage Support Ticket\n\nRoute and prioritize an incoming support ticket.\n\n## Steps\n1. Get the ticket to read its subject and content.\n2. Classify topic and priority from the content.\n3. Update the ticket with the priority and any pipeline stage change.\n4. Search companies to find the requesting account and associate the ticket with it.\n\n## Output\nReturn the ticket ID, assigned priority and topic, and the associated company. Flag high-priority tickets for escalation.',
    },
    {
      name: 'summarize-open-deals',
      description: 'Search HubSpot deals by stage and produce a pipeline summary with totals.',
      content:
        '# Summarize Open Deals\n\nReport on the active sales pipeline.\n\n## Steps\n1. Search deals filtered to open stages, paginating through all results.\n2. Group deals by pipeline stage and capture amount and close date.\n3. Sum amounts per stage and overall, and flag deals with a close date in the past.\n4. Identify the largest deals and any missing key properties.\n\n## Output\nReturn a per-stage breakdown with deal counts and total value, a grand total, and a flagged list of overdue or incomplete deals. Suitable for a sales pipeline review.',
    },
    {
      name: 'build-quote-from-deal',
      description: 'Gather a HubSpot deal and its line items to assemble a quote summary.',
      content:
        '# Build Quote From Deal\n\nCompile the commercial details needed to quote a deal.\n\n## Steps\n1. Get the deal by ID for its name, amount, and stage.\n2. List line items and get details to capture product, quantity, and price for each.\n3. Get the associated quote if one exists, or summarize the line items into a draft quote.\n4. Total the line items and compare against the deal amount, flagging mismatches.\n\n## Output\nReturn the deal summary, an itemized line-item list with totals, and any existing quote reference. Flag discrepancies between the line-item total and the deal amount.',
    },
    {
      name: 'log-email-to-contact',
      description: 'Log an email engagement in HubSpot and associate it with a contact.',
      content:
        '# Log Email To Contact\n\nRecord an email activity on a contact’s timeline.\n\n## Steps\n1. Search contacts by email to resolve the contact ID.\n2. Create an email engagement with hs_timestamp, subject, body, and direction.\n3. Associate the email with the contact (associationTypeId 198, or the default association).\n4. List associations from the contact to emails to confirm the link.\n\n## Output\nReturn the email engagement ID and the associated contact ID.',
    },
    {
      name: 'audit-contacts-missing-activity',
      description: 'Find contacts in a lead stage that have no logged email activity.',
      content:
        '# Audit Contacts Missing Activity\n\nSurface leads with no recorded email history.\n\n## Steps\n1. Get properties for contacts to read the hs_lead_status options and confirm the target stage value.\n2. Search contacts filtered to that lead status, paginating through all results.\n3. For each contact, list associations to emails and flag those with zero associated emails.\n4. Collect the contacts that need follow-up.\n\n## Output\nReturn the list of contact IDs with no logged email activity, ready for backfill.',
    },
    {
      name: 'inspect-property-options',
      description: 'Read the enumeration (picklist) values for a HubSpot property.',
      content:
        '# Inspect Property Options\n\nList the allowed values for a dropdown property.\n\n## Steps\n1. Get properties for the object type (e.g., contacts).\n2. Find the property by name (e.g., lifecyclestage or hs_lead_status).\n3. Read its options array for label/value pairs.\n\n## Output\nReturn the property label and its enumeration options as label/value pairs.',
    },
  ],
} as const satisfies BlockMeta
