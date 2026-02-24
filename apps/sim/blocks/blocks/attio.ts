import { AttioIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { AttioResponse } from '@/tools/attio/types'

export const AttioBlock: BlockConfig<AttioResponse> = {
  type: 'attio',
  name: 'Attio',
  description: 'Interact with Attio CRM to manage records',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Attio into your workflow. Manage people, companies, deals, and custom objects with powerful CRM automation capabilities. Create, update, search, and list records across your Attio workspace.',
  docsLink: 'https://docs.attio.com',
  category: 'tools',
  bgColor: '#000000',
  icon: AttioIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Records', id: 'list_records' },
        { label: 'Get Record', id: 'get_record' },
        { label: 'Create Record', id: 'create_record' },
        { label: 'Update Record', id: 'update_record' },
        { label: 'Search Records', id: 'search_records' },
      ],
      value: () => 'list_records',
    },
    {
      id: 'credential',
      title: 'Attio Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'attio',
      requiredScopes: [
        'record_permission:read',
        'record_permission:read-write',
        'object_configuration:read',
      ],
      placeholder: 'Select Attio account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Attio Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'object',
      title: 'Object Type',
      type: 'short-input',
      placeholder: 'Object slug (e.g., "people", "companies", or custom object)',
      condition: {
        field: 'operation',
        value: ['list_records', 'get_record', 'create_record', 'update_record'],
      },
      required: {
        field: 'operation',
        value: ['list_records', 'get_record', 'create_record', 'update_record'],
      },
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'The unique record ID',
      condition: { field: 'operation', value: ['get_record', 'update_record'] },
      required: { field: 'operation', value: ['get_record', 'update_record'] },
    },
    {
      id: 'values',
      title: 'Record Values',
      type: 'long-input',
      placeholder:
        'JSON object with attribute values (e.g., {"name": "John Doe", "email_addresses": "john@example.com"})',
      condition: { field: 'operation', value: ['create_record', 'update_record'] },
      required: { field: 'operation', value: ['create_record', 'update_record'] },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert Attio CRM developer. Generate Attio record values as JSON based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON object with Attio attribute values. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw JSON object that can be used directly in Attio API create/update operations.

### ATTIO VALUES STRUCTURE
Attio record values are defined as a JSON object with attribute slugs as keys. Values can be simple types or arrays for multi-value attributes.

### COMMON PEOPLE ATTRIBUTES
- **name**: Full name (text)
- **email_addresses**: Email address(es) - string or array
- **phone_numbers**: Phone number(s) - string or array
- **job_title**: Job title (text)
- **description**: Description/notes (text)
- **linkedin_url**: LinkedIn profile URL (text)
- **twitter_url**: Twitter/X profile URL (text)

### COMMON COMPANY ATTRIBUTES
- **name**: Company name (text)
- **domains**: Domain(s) - string or array (e.g., "example.com")
- **description**: Company description (text)
- **industry**: Industry (text)
- **employee_count**: Number of employees (number)
- **linkedin_url**: LinkedIn company page (text)
- **twitter_url**: Twitter/X handle (text)

### EXAMPLES

**Simple Person**: "Create a person named John Doe with email john@example.com"
→ {
  "name": "John Doe",
  "email_addresses": "john@example.com"
}

**Complete Person**: "Create a person with full details"
→ {
  "name": "Jane Smith",
  "email_addresses": ["jane@company.com", "jane.personal@email.com"],
  "phone_numbers": "+1-555-123-4567",
  "job_title": "Marketing Director",
  "description": "Key decision maker for marketing initiatives"
}

**Simple Company**: "Create a company called Acme Corp"
→ {
  "name": "Acme Corp",
  "domains": "acme.com"
}

**Complete Company**: "Create a tech company with full details"
→ {
  "name": "TechStart Inc",
  "domains": ["techstart.io", "techstart.com"],
  "industry": "Technology",
  "employee_count": 50,
  "description": "Innovative software solutions company"
}

### REMEMBER
Return ONLY the JSON object with attribute values - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the record values you want to set...',
        generationType: 'json-object',
      },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search term (names, domains, emails, phone numbers)',
      condition: { field: 'operation', value: 'search_records' },
      required: { field: 'operation', value: 'search_records' },
    },
    {
      id: 'objects',
      title: 'Object Types to Search',
      type: 'short-input',
      placeholder: 'Comma-separated object slugs (e.g., "people,companies") or leave empty for all',
      condition: { field: 'operation', value: 'search_records' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (default: 25, max: 500 for list, 25 for search)',
      condition: {
        field: 'operation',
        value: ['list_records', 'search_records'],
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Number of records to skip for pagination',
      condition: { field: 'operation', value: 'list_records' },
    },
    {
      id: 'attributes',
      title: 'Attributes to Return',
      type: 'short-input',
      placeholder: 'Comma-separated attribute slugs (e.g., "name,email_addresses")',
      condition: { field: 'operation', value: 'list_records' },
    },
  ],
  tools: {
    access: [
      'attio_list_records',
      'attio_get_record',
      'attio_create_record',
      'attio_update_record',
      'attio_search_records',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'list_records':
            return 'attio_list_records'
          case 'get_record':
            return 'attio_get_record'
          case 'create_record':
            return 'attio_create_record'
          case 'update_record':
            return 'attio_update_record'
          case 'search_records':
            return 'attio_search_records'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { oauthCredential, operation, attributes, objects, ...rest } = params

        const cleanParams: Record<string, any> = {
          oauthCredential,
        }

        if (attributes && operation === 'list_records') {
          const parsedAttributes =
            typeof attributes === 'string'
              ? attributes.split(',').map((a: string) => a.trim())
              : attributes
          cleanParams.attributes = parsedAttributes
        }

        if (objects && operation === 'search_records') {
          const parsedObjects =
            typeof objects === 'string' ? objects.split(',').map((o: string) => o.trim()) : objects
          cleanParams.objects = parsedObjects
        }

        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            if (key === 'limit' || key === 'offset') {
              cleanParams[key] = Number(value)
            } else {
              cleanParams[key] = value
            }
          }
        })

        return cleanParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Attio access token' },
    object: { type: 'string', description: 'Object type slug (e.g., people, companies)' },
    recordId: { type: 'string', description: 'Record ID for get/update operations' },
    values: { type: 'json', description: 'Record values to create/update (JSON object)' },
    query: { type: 'string', description: 'Search query string' },
    objects: { type: 'string', description: 'Comma-separated object types to search' },
    limit: { type: 'number', description: 'Maximum results to return' },
    offset: { type: 'number', description: 'Number of records to skip' },
    attributes: { type: 'string', description: 'Comma-separated attribute slugs to return' },
  },
  outputs: {
    records: { type: 'json', description: 'Array of record objects' },
    record: { type: 'json', description: 'Single record object' },
    recordId: { type: 'string', description: 'Record ID' },
    total: { type: 'number', description: 'Total number of matching results' },
    paging: { type: 'json', description: 'Pagination info' },
    metadata: { type: 'json', description: 'Operation metadata' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
