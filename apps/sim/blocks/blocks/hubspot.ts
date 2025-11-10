import { HubspotIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { HubSpotResponse } from '@/tools/hubspot/types'
import { getTrigger } from '@/triggers'
import { hubspotAllTriggerOptions } from '@/triggers/hubspot/utils'

export const HubSpotBlock: BlockConfig<HubSpotResponse> = {
  type: 'hubspot',
  name: 'HubSpot',
  description: 'Interact with HubSpot CRM or trigger workflows from HubSpot events',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate HubSpot into your workflow. Manage contacts, companies, deals, tickets, and other CRM objects with powerful automation capabilities. Can be used in trigger mode to start workflows when contacts are created, deleted, or updated.',
  docsLink: 'https://docs.sim.ai/tools/hubspot',
  category: 'tools',
  bgColor: '#FF7A59',
  icon: HubspotIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Users', id: 'get_users' },
        { label: 'Get Contacts', id: 'get_contacts' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Search Contacts', id: 'search_contacts' },
        { label: 'Get Companies', id: 'get_companies' },
        { label: 'Create Company', id: 'create_company' },
        { label: 'Update Company', id: 'update_company' },
        { label: 'Search Companies', id: 'search_companies' },
        { label: 'Get Deals', id: 'get_deals' },
      ],
      value: () => 'get_contacts',
    },
    {
      id: 'credential',
      title: 'HubSpot Account',
      type: 'oauth-input',
      provider: 'hubspot',
      serviceId: 'hubspot',
      requiredScopes: [
        'crm.objects.contacts.read',
        'crm.objects.contacts.write',
        'crm.objects.companies.read',
        'crm.objects.companies.write',
        'crm.objects.deals.read',
        'crm.objects.deals.write',
        'crm.objects.owners.read',
        'crm.objects.users.read',
        'crm.objects.users.write',
        'crm.objects.marketing_events.read',
        'crm.objects.marketing_events.write',
        'crm.objects.line_items.read',
        'crm.objects.line_items.write',
        'crm.objects.quotes.read',
        'crm.objects.quotes.write',
        'crm.objects.appointments.read',
        'crm.objects.appointments.write',
        'crm.objects.carts.read',
        'crm.objects.carts.write',
        'crm.import',
        'crm.lists.read',
        'crm.lists.write',
        'tickets',
      ],
      placeholder: 'Select HubSpot account',
      required: true,
    },
    {
      id: 'contactId',
      title: 'Contact ID or Email',
      type: 'short-input',
      placeholder: 'Optional - Leave empty to list all contacts',
      condition: { field: 'operation', value: ['get_contacts', 'update_contact'] },
    },
    {
      id: 'companyId',
      title: 'Company ID or Domain',
      type: 'short-input',
      placeholder: 'Optional - Leave empty to list all companies',
      condition: { field: 'operation', value: ['get_companies', 'update_company'] },
    },
    {
      id: 'idProperty',
      title: 'ID Property',
      type: 'short-input',
      placeholder: 'Optional - e.g., "email" for contacts, "domain" for companies',
      condition: {
        field: 'operation',
        value: ['get_contacts', 'update_contact', 'get_companies', 'update_company'],
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
        value: ['create_contact', 'update_contact', 'create_company', 'update_company'],
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
      condition: { field: 'operation', value: ['get_contacts', 'get_companies', 'get_deals'] },
    },
    {
      id: 'associations',
      title: 'Associations',
      type: 'short-input',
      placeholder: 'Comma-separated object types (e.g., "companies,deals")',
      condition: {
        field: 'operation',
        value: ['get_contacts', 'get_companies', 'get_deals', 'create_contact', 'create_company'],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (list: 100, search: 200)',
      condition: {
        field: 'operation',
        value: [
          'get_users',
          'get_contacts',
          'get_companies',
          'get_deals',
          'search_contacts',
          'search_companies',
        ],
      },
    },
    {
      id: 'after',
      title: 'After (Pagination)',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      condition: {
        field: 'operation',
        value: [
          'get_contacts',
          'get_companies',
          'get_deals',
          'search_contacts',
          'search_companies',
        ],
      },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search term (e.g., company name, contact email)',
      condition: { field: 'operation', value: ['search_contacts', 'search_companies'] },
    },
    {
      id: 'filterGroups',
      title: 'Filter Groups',
      type: 'long-input',
      placeholder:
        'JSON array of filter groups (e.g., [{"filters":[{"propertyName":"email","operator":"EQ","value":"test@example.com"}]}])',
      condition: { field: 'operation', value: ['search_contacts', 'search_companies'] },
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
      condition: { field: 'operation', value: ['search_contacts', 'search_companies'] },
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
      condition: { field: 'operation', value: ['search_contacts', 'search_companies'] },
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
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: hubspotAllTriggerOptions,
      value: () => 'hubspot_contact_created',
      required: true,
    },
    ...getTrigger('hubspot_contact_created').subBlocks.slice(1),
    ...getTrigger('hubspot_contact_deleted').subBlocks.slice(1),
    ...getTrigger('hubspot_contact_privacy_deleted').subBlocks.slice(1),
    ...getTrigger('hubspot_contact_property_changed').subBlocks.slice(1),
    ...getTrigger('hubspot_company_created').subBlocks.slice(1),
    ...getTrigger('hubspot_company_deleted').subBlocks.slice(1),
    ...getTrigger('hubspot_company_property_changed').subBlocks.slice(1),
    ...getTrigger('hubspot_conversation_creation').subBlocks.slice(1),
    ...getTrigger('hubspot_conversation_deletion').subBlocks.slice(1),
    ...getTrigger('hubspot_conversation_new_message').subBlocks.slice(1),
    ...getTrigger('hubspot_conversation_privacy_deletion').subBlocks.slice(1),
    ...getTrigger('hubspot_conversation_property_changed').subBlocks.slice(1),
    ...getTrigger('hubspot_deal_created').subBlocks.slice(1),
    ...getTrigger('hubspot_deal_deleted').subBlocks.slice(1),
    ...getTrigger('hubspot_deal_property_changed').subBlocks.slice(1),
    ...getTrigger('hubspot_ticket_created').subBlocks.slice(1),
    ...getTrigger('hubspot_ticket_deleted').subBlocks.slice(1),
    ...getTrigger('hubspot_ticket_property_changed').subBlocks.slice(1),
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
            return 'hubspot_list_deals'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          operation,
          propertiesToSet,
          properties,
          searchProperties,
          filterGroups,
          sorts,
          associations,
          ...rest
        } = params

        const cleanParams: Record<string, any> = {
          credential,
        }

        if (propertiesToSet) {
          try {
            cleanParams.properties =
              typeof propertiesToSet === 'string' ? JSON.parse(propertiesToSet) : propertiesToSet
          } catch (error) {
            throw new Error('Invalid JSON in properties field')
          }
        }

        if (properties && !searchProperties) {
          cleanParams.properties = properties
        }

        if (searchProperties) {
          try {
            cleanParams.properties =
              typeof searchProperties === 'string' ? JSON.parse(searchProperties) : searchProperties
          } catch (error) {
            throw new Error('Invalid JSON in searchProperties field')
          }
        }

        if (filterGroups) {
          try {
            cleanParams.filterGroups =
              typeof filterGroups === 'string' ? JSON.parse(filterGroups) : filterGroups
          } catch (error) {
            throw new Error('Invalid JSON in filterGroups field')
          }
        }

        if (sorts) {
          try {
            cleanParams.sorts = typeof sorts === 'string' ? JSON.parse(sorts) : sorts
          } catch (error) {
            throw new Error('Invalid JSON in sorts field')
          }
        }

        if (associations) {
          cleanParams.associations = associations
        }

        // Add other params
        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            cleanParams[key] = value
          }
        })

        return cleanParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'HubSpot access token' },
    contactId: { type: 'string', description: 'Contact ID or email' },
    companyId: { type: 'string', description: 'Company ID or domain' },
    idProperty: { type: 'string', description: 'Property name to use as unique identifier' },
    propertiesToSet: { type: 'json', description: 'Properties to create/update (JSON object)' },
    properties: {
      type: 'string',
      description: 'Comma-separated properties to return (for list/get)',
    },
    associations: { type: 'string', description: 'Comma-separated object types for associations' },
    limit: { type: 'string', description: 'Maximum results (list: 100, search: 200)' },
    after: { type: 'string', description: 'Pagination cursor' },
    query: { type: 'string', description: 'Search query string' },
    filterGroups: { type: 'json', description: 'Filter groups for search (JSON array)' },
    sorts: { type: 'json', description: 'Sort order (JSON array of strings or objects)' },
    searchProperties: { type: 'json', description: 'Properties to return in search (JSON array)' },
  },
  outputs: {
    users: { type: 'json', description: 'Array of user objects' },
    contacts: { type: 'json', description: 'Array of contact objects' },
    contact: { type: 'json', description: 'Single contact object' },
    companies: { type: 'json', description: 'Array of company objects' },
    company: { type: 'json', description: 'Single company object' },
    deals: { type: 'json', description: 'Array of deal objects' },
    total: { type: 'number', description: 'Total number of matching results (for search)' },
    paging: { type: 'json', description: 'Pagination info with next/prev cursors' },
    metadata: { type: 'json', description: 'Operation metadata' },
    success: { type: 'boolean', description: 'Operation success status' },
    payload: {
      type: 'json',
      description: 'Full webhook payload array from HubSpot containing event details',
    },
    provider: {
      type: 'string',
      description: 'Provider name (hubspot)',
    },
    providerConfig: {
      appId: {
        type: 'string',
        description: 'HubSpot App ID',
      },
      clientId: {
        type: 'string',
        description: 'HubSpot Client ID',
      },
      triggerId: {
        type: 'string',
        description: 'Trigger ID (e.g., hubspot_company_created)',
      },
      clientSecret: {
        type: 'string',
        description: 'HubSpot Client Secret',
      },
      developerApiKey: {
        type: 'string',
        description: 'HubSpot Developer API Key',
      },
      curlSetWebhookUrl: {
        type: 'string',
        description: 'curl command to set webhook URL',
      },
      curlCreateSubscription: {
        type: 'string',
        description: 'curl command to create subscription',
      },
      webhookUrlDisplay: {
        type: 'string',
        description: 'Webhook URL display value',
      },
      propertyName: {
        type: 'string',
        description: 'Optional property name filter (for property change triggers)',
      },
    },
  } as any,
  triggerAllowed: true,
  triggers: {
    enabled: true,
    available: [
      'hubspot_contact_created',
      'hubspot_contact_deleted',
      'hubspot_contact_privacy_deleted',
      'hubspot_contact_property_changed',
      'hubspot_company_created',
      'hubspot_company_deleted',
      'hubspot_company_property_changed',
      'hubspot_conversation_creation',
      'hubspot_conversation_deletion',
      'hubspot_conversation_new_message',
      'hubspot_conversation_privacy_deletion',
      'hubspot_conversation_property_changed',
      'hubspot_deal_created',
      'hubspot_deal_deleted',
      'hubspot_deal_property_changed',
      'hubspot_ticket_created',
      'hubspot_ticket_deleted',
      'hubspot_ticket_property_changed',
    ],
  },
}
