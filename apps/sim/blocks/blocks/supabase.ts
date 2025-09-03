import { SupabaseIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console/logger'
import type { BlockConfig } from '@/blocks/types'
import type { SupabaseResponse } from '@/tools/supabase/types'

const logger = createLogger('SupabaseBlock')

export const SupabaseBlock: BlockConfig<SupabaseResponse> = {
  type: 'supabase',
  name: 'Supabase',
  description: 'Use Supabase database',
  longDescription:
    'Integrate with Supabase to manage your database, authentication, storage, and more. Query data, manage users, and interact with Supabase services directly.',
  docsLink: 'https://docs.sim.ai/tools/supabase',
  category: 'tools',
  bgColor: '#1C1C1C',
  icon: SupabaseIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Get Many Rows', id: 'query' },
        { label: 'Get a Row', id: 'get_row' },
        { label: 'Create a Row', id: 'insert' },
        { label: 'Update a Row', id: 'update' },
        { label: 'Delete a Row', id: 'delete' },
        { label: 'Upsert a Row', id: 'upsert' },
      ],
      value: () => 'query',
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      layout: 'full',
      password: true,
      placeholder: 'Your Supabase project ID (e.g., jdrkgepadsdopsntdlom)',
      required: true,
    },
    {
      id: 'table',
      title: 'Table',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Name of the table',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'Service Role Secret',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Supabase service role secret key',
      password: true,
      required: true,
    },
    // Data input for create/update operations
    {
      id: 'data',
      title: 'Data',
      type: 'code',
      layout: 'full',
      placeholder: '{\n  "column1": "value1",\n  "column2": "value2"\n}',
      condition: { field: 'operation', value: 'insert' },
      required: true,
    },
    {
      id: 'data',
      title: 'Data',
      type: 'code',
      layout: 'full',
      placeholder: '{\n  "column1": "value1",\n  "column2": "value2"\n}',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'data',
      title: 'Data',
      type: 'code',
      layout: 'full',
      placeholder: '{\n  "column1": "value1",\n  "column2": "value2"\n}',
      condition: { field: 'operation', value: 'upsert' },
      required: true,
    },
    // Filter for get_row, update, delete operations (required)
    {
      id: 'filter',
      title: 'Filter (PostgREST syntax)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'id=eq.123',
      condition: { field: 'operation', value: 'get_row' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert in PostgREST API syntax. Generate PostgREST filter expressions based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the PostgREST filter expression. Do not include any explanations, markdown formatting, or additional text. Just the raw filter expression.

### POSTGREST FILTER SYNTAX
PostgREST uses a specific syntax for filtering data. The format is:
column=operator.value

### OPERATORS
- **eq** - equals: \`id=eq.123\`
- **neq** - not equals: \`status=neq.inactive\`
- **gt** - greater than: \`age=gt.18\`
- **gte** - greater than or equal: \`score=gte.80\`
- **lt** - less than: \`price=lt.100\`
- **lte** - less than or equal: \`rating=lte.5\`
- **like** - pattern matching: \`name=like.*john*\`
- **ilike** - case-insensitive like: \`email=ilike.*@gmail.com\`
- **in** - in list: \`category=in.(tech,science,art)\`
- **is** - is null/not null: \`deleted_at=is.null\`
- **not** - negation: \`not.and=(status.eq.active,verified.eq.true)\`

### COMBINING FILTERS
- **AND**: Use \`&\` or \`and=(...)\`: \`id=eq.123&status=eq.active\`
- **OR**: Use \`or=(...)\`: \`or=(status.eq.active,status.eq.pending)\`

### EXAMPLES

**Simple equality**: "Find user with ID 123"
→ id=eq.123

**Text search**: "Find users with Gmail addresses"
→ email=ilike.*@gmail.com

**Range filter**: "Find products under $50"
→ price=lt.50

**Multiple conditions**: "Find active users over 18"
→ age=gt.18&status=eq.active

**OR condition**: "Find active or pending orders"
→ or=(status.eq.active,status.eq.pending)

**In list**: "Find posts in specific categories"
→ category=in.(tech,science,health)

**Null check**: "Find users without a profile picture"
→ profile_image=is.null

### REMEMBER
Return ONLY the PostgREST filter expression - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the filter condition you need...',
        generationType: 'postgrest',
      },
    },
    {
      id: 'filter',
      title: 'Filter (PostgREST syntax)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'id=eq.123',
      condition: { field: 'operation', value: 'update' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert in PostgREST API syntax. Generate PostgREST filter expressions based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the PostgREST filter expression. Do not include any explanations, markdown formatting, or additional text. Just the raw filter expression.

### POSTGREST FILTER SYNTAX
PostgREST uses a specific syntax for filtering data. The format is:
column=operator.value

### OPERATORS
- **eq** - equals: \`id=eq.123\`
- **neq** - not equals: \`status=neq.inactive\`
- **gt** - greater than: \`age=gt.18\`
- **gte** - greater than or equal: \`score=gte.80\`
- **lt** - less than: \`price=lt.100\`
- **lte** - less than or equal: \`rating=lte.5\`
- **like** - pattern matching: \`name=like.*john*\`
- **ilike** - case-insensitive like: \`email=ilike.*@gmail.com\`
- **in** - in list: \`category=in.(tech,science,art)\`
- **is** - is null/not null: \`deleted_at=is.null\`
- **not** - negation: \`not.and=(status.eq.active,verified.eq.true)\`

### COMBINING FILTERS
- **AND**: Use \`&\` or \`and=(...)\`: \`id=eq.123&status=eq.active\`
- **OR**: Use \`or=(...)\`: \`or=(status.eq.active,status.eq.pending)\`

### EXAMPLES

**Simple equality**: "Find user with ID 123"
→ id=eq.123

**Text search**: "Find users with Gmail addresses"
→ email=ilike.*@gmail.com

**Range filter**: "Find products under $50"
→ price=lt.50

**Multiple conditions**: "Find active users over 18"
→ age=gt.18&status=eq.active

**OR condition**: "Find active or pending orders"
→ or=(status.eq.active,status.eq.pending)

**In list**: "Find posts in specific categories"
→ category=in.(tech,science,health)

**Null check**: "Find users without a profile picture"
→ profile_image=is.null

### REMEMBER
Return ONLY the PostgREST filter expression - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the filter condition you need...',
        generationType: 'postgrest',
      },
    },
    {
      id: 'filter',
      title: 'Filter (PostgREST syntax)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'id=eq.123',
      condition: { field: 'operation', value: 'delete' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert in PostgREST API syntax. Generate PostgREST filter expressions based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the PostgREST filter expression. Do not include any explanations, markdown formatting, or additional text. Just the raw filter expression.

### POSTGREST FILTER SYNTAX
PostgREST uses a specific syntax for filtering data. The format is:
column=operator.value

### OPERATORS
- **eq** - equals: \`id=eq.123\`
- **neq** - not equals: \`status=neq.inactive\`
- **gt** - greater than: \`age=gt.18\`
- **gte** - greater than or equal: \`score=gte.80\`
- **lt** - less than: \`price=lt.100\`
- **lte** - less than or equal: \`rating=lte.5\`
- **like** - pattern matching: \`name=like.*john*\`
- **ilike** - case-insensitive like: \`email=ilike.*@gmail.com\`
- **in** - in list: \`category=in.(tech,science,art)\`
- **is** - is null/not null: \`deleted_at=is.null\`
- **not** - negation: \`not.and=(status.eq.active,verified.eq.true)\`

### COMBINING FILTERS
- **AND**: Use \`&\` or \`and=(...)\`: \`id=eq.123&status=eq.active\`
- **OR**: Use \`or=(...)\`: \`or=(status.eq.active,status.eq.pending)\`

### EXAMPLES

**Simple equality**: "Find user with ID 123"
→ id=eq.123

**Text search**: "Find users with Gmail addresses"
→ email=ilike.*@gmail.com

**Range filter**: "Find products under $50"
→ price=lt.50

**Multiple conditions**: "Find active users over 18"
→ age=gt.18&status=eq.active

**OR condition**: "Find active or pending orders"
→ or=(status.eq.active,status.eq.pending)

**In list**: "Find posts in specific categories"
→ category=in.(tech,science,health)

**Null check**: "Find users without a profile picture"
→ profile_image=is.null

### REMEMBER
Return ONLY the PostgREST filter expression - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the filter condition you need...',
        generationType: 'postgrest',
      },
    },
    // Optional filter for query operation
    {
      id: 'filter',
      title: 'Filter (PostgREST syntax)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'status=eq.active',
      condition: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert in PostgREST API syntax. Generate PostgREST filter expressions based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the PostgREST filter expression. Do not include any explanations, markdown formatting, or additional text. Just the raw filter expression.

### POSTGREST FILTER SYNTAX
PostgREST uses a specific syntax for filtering data. The format is:
column=operator.value

### OPERATORS
- **eq** - equals: \`id=eq.123\`
- **neq** - not equals: \`status=neq.inactive\`
- **gt** - greater than: \`age=gt.18\`
- **gte** - greater than or equal: \`score=gte.80\`
- **lt** - less than: \`price=lt.100\`
- **lte** - less than or equal: \`rating=lte.5\`
- **like** - pattern matching: \`name=like.*john*\`
- **ilike** - case-insensitive like: \`email=ilike.*@gmail.com\`
- **in** - in list: \`category=in.(tech,science,art)\`
- **is** - is null/not null: \`deleted_at=is.null\`
- **not** - negation: \`not.and=(status.eq.active,verified.eq.true)\`

### COMBINING FILTERS
- **AND**: Use \`&\` or \`and=(...)\`: \`id=eq.123&status=eq.active\`
- **OR**: Use \`or=(...)\`: \`or=(status.eq.active,status.eq.pending)\`

### EXAMPLES

**Simple equality**: "Find user with ID 123"
→ id=eq.123

**Text search**: "Find users with Gmail addresses"
→ email=ilike.*@gmail.com

**Range filter**: "Find products under $50"
→ price=lt.50

**Multiple conditions**: "Find active users over 18"
→ age=gt.18&status=eq.active

**OR condition**: "Find active or pending orders"
→ or=(status.eq.active,status.eq.pending)

**In list**: "Find posts in specific categories"
→ category=in.(tech,science,health)

**Null check**: "Find users without a profile picture"
→ profile_image=is.null

### REMEMBER
Return ONLY the PostgREST filter expression - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the filter condition...',
        generationType: 'postgrest',
      },
    },
    // Optional order by for query operation
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      layout: 'full',
      placeholder: 'column_name (add DESC for descending)',
      condition: { field: 'operation', value: 'query' },
    },
    // Optional limit for query operation
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      layout: 'full',
      placeholder: '100',
      condition: { field: 'operation', value: 'query' },
    },
  ],
  tools: {
    access: [
      'supabase_query',
      'supabase_insert',
      'supabase_get_row',
      'supabase_update',
      'supabase_delete',
      'supabase_upsert',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'supabase_query'
          case 'insert':
            return 'supabase_insert'
          case 'get_row':
            return 'supabase_get_row'
          case 'update':
            return 'supabase_update'
          case 'delete':
            return 'supabase_delete'
          case 'upsert':
            return 'supabase_upsert'
          default:
            throw new Error(`Invalid Supabase operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, data, filter, ...rest } = params

        // Parse JSON data if it's a string
        let parsedData
        if (data && typeof data === 'string' && data.trim()) {
          try {
            parsedData = JSON.parse(data)
          } catch (parseError) {
            // Provide more detailed error information
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(
              `Invalid JSON data format: ${errorMsg}. Please check your JSON syntax (e.g., strings must be quoted like "value").`
            )
          }
        } else if (data && typeof data === 'object') {
          parsedData = data
        }

        // Handle filter - just pass through PostgREST syntax
        let parsedFilter
        if (filter && typeof filter === 'string' && filter.trim()) {
          parsedFilter = filter.trim()
        }

        // Build params object, only including defined values
        const result = { ...rest }

        if (parsedData !== undefined) {
          result.data = parsedData
        }

        if (parsedFilter !== undefined && parsedFilter !== '') {
          result.filter = parsedFilter
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    projectId: { type: 'string', description: 'Supabase project identifier' },
    table: { type: 'string', description: 'Database table name' },
    apiKey: { type: 'string', description: 'Service role secret key' },
    // Data for insert/update operations
    data: { type: 'json', description: 'Row data' },
    // Filter for operations
    filter: { type: 'string', description: 'PostgREST filter syntax' },
    // Query operation inputs
    orderBy: { type: 'string', description: 'Sort column' },
    limit: { type: 'number', description: 'Result limit' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    results: {
      type: 'json',
      description: 'Database records returned from query, insert, update, or delete operations',
    },
  },
}
