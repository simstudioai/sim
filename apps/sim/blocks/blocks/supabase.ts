import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { SupabaseBlockDisplay } from '@/blocks/blocks/supabase.display'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { SupabaseResponse } from '@/tools/supabase/types'

const logger = createLogger('SupabaseBlock')

export const SupabaseBlock: BlockConfig<SupabaseResponse> = {
  ...SupabaseBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Many Rows', id: 'query' },
        { label: 'Get a Row', id: 'get_row' },
        { label: 'Create a Row', id: 'insert' },
        { label: 'Update a Row', id: 'update' },
        { label: 'Delete a Row', id: 'delete' },
        { label: 'Upsert a Row', id: 'upsert' },
        { label: 'Count Rows', id: 'count' },
        { label: 'Full-Text Search', id: 'text_search' },
        { label: 'Vector Search', id: 'vector_search' },
        { label: 'Call RPC Function', id: 'rpc' },
        { label: 'Invoke Edge Function', id: 'invoke_function' },
        { label: 'Introspect Schema', id: 'introspect' },
        { label: 'Storage: Upload File', id: 'storage_upload' },
        { label: 'Storage: Download File', id: 'storage_download' },
        { label: 'Storage: List Files', id: 'storage_list' },
        { label: 'Storage: Delete Files', id: 'storage_delete' },
        { label: 'Storage: Move File', id: 'storage_move' },
        { label: 'Storage: Copy File', id: 'storage_copy' },
        { label: 'Storage: Get Public URL', id: 'storage_get_public_url' },
        { label: 'Storage: Create Signed URL', id: 'storage_create_signed_url' },
        { label: 'Storage: Create Bucket', id: 'storage_create_bucket' },
        { label: 'Storage: List Buckets', id: 'storage_list_buckets' },
        { label: 'Storage: Delete Bucket', id: 'storage_delete_bucket' },
      ],
      value: () => 'query',
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      password: true,
      placeholder: 'Your Supabase project ID (e.g., jdrkgepadsdopsntdlom)',
      required: true,
    },
    {
      id: 'table',
      title: 'Table',
      type: 'short-input',
      placeholder: 'Name of the table',
      required: true,
      condition: {
        field: 'operation',
        value: ['query', 'get_row', 'insert', 'update', 'delete', 'upsert', 'count', 'text_search'],
      },
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'short-input',
      placeholder: 'public (default)',
      condition: {
        field: 'operation',
        value: ['query', 'get_row', 'insert', 'update', 'delete', 'upsert', 'count', 'text_search'],
      },
    },
    {
      id: 'select',
      title: 'Select Columns',
      type: 'short-input',
      placeholder: '* (all columns) or id,name,email',
      condition: {
        field: 'operation',
        value: ['query', 'get_row'],
      },
    },
    {
      id: 'apiKey',
      title: 'Service Role Secret',
      type: 'short-input',
      placeholder: 'Your Supabase service role secret key',
      password: true,
      required: true,
    },
    {
      id: 'data',
      title: 'Data',
      type: 'code',
      placeholder: '{\n  "column1": "value1",\n  "column2": "value2"\n}',
      condition: { field: 'operation', value: 'insert' },
      required: true,
    },
    {
      id: 'data',
      title: 'Data',
      type: 'code',
      placeholder: '{\n  "column1": "value1",\n  "column2": "value2"\n}',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'data',
      title: 'Data',
      type: 'code',
      placeholder: '{\n  "column1": "value1",\n  "column2": "value2"\n}',
      condition: { field: 'operation', value: 'upsert' },
      required: true,
    },
    {
      id: 'onConflict',
      title: 'On Conflict (column)',
      type: 'short-input',
      placeholder: 'email (defaults to primary key)',
      condition: { field: 'operation', value: 'upsert' },
      mode: 'advanced',
    },
    {
      id: 'filter',
      title: 'Filter (PostgREST syntax)',
      type: 'short-input',
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
    {
      id: 'filter',
      title: 'Filter (PostgREST syntax)',
      type: 'short-input',
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
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'column_name (add DESC for descending)',
      condition: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Supabase order by clause based on the user's description.

### FORMAT
column_name [ASC|DESC]

### RULES
- Column name only: sorts ascending by default
- Add DESC after column name for descending order
- Add ASC after column name for ascending order (explicit)
- Column names are case-sensitive and should match your database schema

### COMMON PATTERNS
- Newest first: created_at DESC
- Oldest first: created_at ASC
- Alphabetical: name
- Reverse alphabetical: name DESC
- Highest value first: price DESC
- Lowest value first: price ASC

### EXAMPLES
- "sort by start time newest first" -> start_time DESC
- "order by name alphabetically" -> name
- "sort by created date oldest first" -> created_at ASC
- "highest scores first" -> score DESC
- "sort by updated timestamp descending" -> updated_at DESC
- "order by email" -> email

Return ONLY the order by expression - no explanations, no extra text.`,
        placeholder: 'Describe how to sort (e.g., "newest first by created_at")...',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'functionName',
      title: 'Function Name',
      type: 'short-input',
      placeholder: 'match_documents',
      condition: { field: 'operation', value: 'vector_search' },
      required: true,
    },
    {
      id: 'queryEmbedding',
      title: 'Query Embedding',
      type: 'code',
      placeholder: '[0.1, 0.2, 0.3, ...]',
      condition: { field: 'operation', value: 'vector_search' },
      required: true,
    },
    {
      id: 'matchThreshold',
      title: 'Match Threshold',
      type: 'short-input',
      placeholder: '0.78',
      condition: { field: 'operation', value: 'vector_search' },
    },
    {
      id: 'matchCount',
      title: 'Match Count',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'vector_search' },
    },
    {
      id: 'functionName',
      title: 'Function Name',
      type: 'short-input',
      placeholder: 'my_function_name',
      condition: { field: 'operation', value: 'rpc' },
      required: true,
    },
    {
      id: 'params',
      title: 'Parameters (JSON)',
      type: 'code',
      placeholder: '{\n  "param1": "value1",\n  "param2": "value2"\n}',
      condition: { field: 'operation', value: 'rpc' },
    },
    {
      id: 'functionName',
      title: 'Function Name',
      type: 'short-input',
      placeholder: 'hello-world',
      condition: { field: 'operation', value: 'invoke_function' },
      required: true,
    },
    {
      id: 'method',
      title: 'HTTP Method',
      type: 'dropdown',
      options: [
        { label: 'POST', id: 'POST' },
        { label: 'GET', id: 'GET' },
        { label: 'PUT', id: 'PUT' },
        { label: 'PATCH', id: 'PATCH' },
        { label: 'DELETE', id: 'DELETE' },
      ],
      value: () => 'POST',
      condition: { field: 'operation', value: 'invoke_function' },
    },
    {
      id: 'functionBody',
      title: 'Request Body (JSON)',
      type: 'code',
      placeholder: '{\n  "name": "world"\n}',
      condition: { field: 'operation', value: 'invoke_function' },
    },
    {
      id: 'functionHeaders',
      title: 'Headers (JSON)',
      type: 'code',
      placeholder: '{\n  "x-custom-header": "value"\n}',
      condition: { field: 'operation', value: 'invoke_function' },
      mode: 'advanced',
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'short-input',
      placeholder: 'public (leave empty for all user schemas)',
      condition: { field: 'operation', value: 'introspect' },
    },
    {
      id: 'column',
      title: 'Column to Search',
      type: 'short-input',
      placeholder: 'content',
      condition: { field: 'operation', value: 'text_search' },
      required: true,
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'search terms',
      condition: { field: 'operation', value: 'text_search' },
      required: true,
    },
    {
      id: 'searchType',
      title: 'Search Type',
      type: 'dropdown',
      options: [
        { label: 'Websearch (natural language)', id: 'websearch' },
        { label: 'Plain', id: 'plain' },
        { label: 'Phrase', id: 'phrase' },
      ],
      value: () => 'websearch',
      condition: { field: 'operation', value: 'text_search' },
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'english',
      condition: { field: 'operation', value: 'text_search' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'text_search' },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'text_search' },
    },
    {
      id: 'filter',
      title: 'Filter (PostgREST syntax)',
      type: 'short-input',
      placeholder: 'status=eq.active',
      condition: { field: 'operation', value: 'count' },
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
    {
      id: 'countType',
      title: 'Count Type',
      type: 'dropdown',
      options: [
        { label: 'Exact', id: 'exact' },
        { label: 'Planned', id: 'planned' },
        { label: 'Estimated', id: 'estimated' },
      ],
      value: () => 'exact',
      condition: { field: 'operation', value: 'count' },
    },
    {
      id: 'bucket',
      title: 'Bucket Name',
      type: 'short-input',
      placeholder: 'my-bucket',
      condition: {
        field: 'operation',
        value: [
          'storage_upload',
          'storage_download',
          'storage_list',
          'storage_delete',
          'storage_move',
          'storage_copy',
          'storage_create_bucket',
          'storage_delete_bucket',
          'storage_get_public_url',
          'storage_create_signed_url',
        ],
      },
      required: true,
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'myfile.pdf',
      condition: { field: 'operation', value: 'storage_upload' },
      required: true,
    },
    {
      id: 'path',
      title: 'Folder Path (optional)',
      type: 'short-input',
      placeholder: 'folder/subfolder/',
      condition: { field: 'operation', value: 'storage_upload' },
    },
    {
      id: 'file',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'fileData',
      placeholder: 'Upload file to storage',
      condition: { field: 'operation', value: 'storage_upload' },
      mode: 'basic',
      multiple: false,
      required: true,
    },
    {
      id: 'fileContent',
      title: 'File Content',
      type: 'short-input',
      canonicalParamId: 'fileData',
      placeholder: 'File reference from previous block',
      condition: { field: 'operation', value: 'storage_upload' },
      mode: 'advanced',
      required: true,
    },
    {
      id: 'contentType',
      title: 'Content Type (MIME)',
      type: 'short-input',
      placeholder: 'image/jpeg',
      condition: { field: 'operation', value: 'storage_upload' },
    },
    {
      id: 'cacheControl',
      title: 'Cache Control (seconds)',
      type: 'short-input',
      placeholder: '3600',
      condition: { field: 'operation', value: 'storage_upload' },
      mode: 'advanced',
    },
    {
      id: 'upsert',
      title: 'Upsert (overwrite if exists)',
      type: 'dropdown',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'storage_upload' },
    },
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'folder/file.jpg',
      condition: { field: 'operation', value: 'storage_download' },
      required: true,
    },
    {
      id: 'fileName',
      title: 'File Name Override',
      type: 'short-input',
      placeholder: 'my-file.jpg',
      condition: { field: 'operation', value: 'storage_download' },
    },
    {
      id: 'path',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: 'folder/',
      condition: { field: 'operation', value: 'storage_list' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'storage_list' },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'storage_list' },
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Name', id: 'name' },
        { label: 'Created At', id: 'created_at' },
        { label: 'Updated At', id: 'updated_at' },
        { label: 'Last Accessed At', id: 'last_accessed_at' },
      ],
      value: () => 'name',
      condition: { field: 'operation', value: 'storage_list' },
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      value: () => 'asc',
      condition: { field: 'operation', value: 'storage_list' },
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'search term',
      condition: { field: 'operation', value: 'storage_list' },
    },
    {
      id: 'paths',
      title: 'File Paths (JSON array)',
      type: 'code',
      placeholder: '["folder/file1.jpg", "folder/file2.jpg"]',
      condition: { field: 'operation', value: 'storage_delete' },
      required: true,
    },
    {
      id: 'fromPath',
      title: 'From Path',
      type: 'short-input',
      placeholder: 'folder/old.jpg',
      condition: { field: 'operation', value: 'storage_move' },
      required: true,
    },
    {
      id: 'toPath',
      title: 'To Path',
      type: 'short-input',
      placeholder: 'newfolder/new.jpg',
      condition: { field: 'operation', value: 'storage_move' },
      required: true,
    },
    {
      id: 'fromPath',
      title: 'From Path',
      type: 'short-input',
      placeholder: 'folder/source.jpg',
      condition: { field: 'operation', value: 'storage_copy' },
      required: true,
    },
    {
      id: 'toPath',
      title: 'To Path',
      type: 'short-input',
      placeholder: 'folder/copy.jpg',
      condition: { field: 'operation', value: 'storage_copy' },
      required: true,
    },
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'folder/file.jpg',
      condition: { field: 'operation', value: 'storage_get_public_url' },
      required: true,
    },
    {
      id: 'download',
      title: 'Force Download',
      type: 'dropdown',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'storage_get_public_url' },
    },
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'folder/file.jpg',
      condition: { field: 'operation', value: 'storage_create_signed_url' },
      required: true,
    },
    {
      id: 'expiresIn',
      title: 'Expires In (seconds)',
      type: 'short-input',
      placeholder: '3600',
      condition: { field: 'operation', value: 'storage_create_signed_url' },
      required: true,
    },
    {
      id: 'download',
      title: 'Force Download',
      type: 'dropdown',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'storage_create_signed_url' },
    },
    {
      id: 'isPublic',
      title: 'Public Bucket',
      type: 'dropdown',
      options: [
        { label: 'False (Private)', id: 'false' },
        { label: 'True (Public)', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'storage_create_bucket' },
    },
    {
      id: 'fileSizeLimit',
      title: 'File Size Limit (bytes)',
      type: 'short-input',
      placeholder: '52428800',
      condition: { field: 'operation', value: 'storage_create_bucket' },
    },
    {
      id: 'allowedMimeTypes',
      title: 'Allowed MIME Types (JSON array)',
      type: 'code',
      placeholder: '["image/png", "image/jpeg"]',
      condition: { field: 'operation', value: 'storage_create_bucket' },
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
      'supabase_count',
      'supabase_text_search',
      'supabase_vector_search',
      'supabase_rpc',
      'supabase_invoke_function',
      'supabase_introspect',
      'supabase_storage_upload',
      'supabase_storage_download',
      'supabase_storage_list',
      'supabase_storage_delete',
      'supabase_storage_move',
      'supabase_storage_copy',
      'supabase_storage_create_bucket',
      'supabase_storage_list_buckets',
      'supabase_storage_delete_bucket',
      'supabase_storage_get_public_url',
      'supabase_storage_create_signed_url',
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
          case 'count':
            return 'supabase_count'
          case 'text_search':
            return 'supabase_text_search'
          case 'vector_search':
            return 'supabase_vector_search'
          case 'rpc':
            return 'supabase_rpc'
          case 'invoke_function':
            return 'supabase_invoke_function'
          case 'introspect':
            return 'supabase_introspect'
          case 'storage_upload':
            return 'supabase_storage_upload'
          case 'storage_download':
            return 'supabase_storage_download'
          case 'storage_list':
            return 'supabase_storage_list'
          case 'storage_delete':
            return 'supabase_storage_delete'
          case 'storage_move':
            return 'supabase_storage_move'
          case 'storage_copy':
            return 'supabase_storage_copy'
          case 'storage_create_bucket':
            return 'supabase_storage_create_bucket'
          case 'storage_list_buckets':
            return 'supabase_storage_list_buckets'
          case 'storage_delete_bucket':
            return 'supabase_storage_delete_bucket'
          case 'storage_get_public_url':
            return 'supabase_storage_get_public_url'
          case 'storage_create_signed_url':
            return 'supabase_storage_create_signed_url'
          default:
            throw new Error(`Invalid Supabase operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          operation,
          data,
          filter,
          queryEmbedding,
          params: rpcParams,
          paths,
          allowedMimeTypes,
          upsert,
          download,
          fileData,
          functionBody,
          functionHeaders,
          method,
          ...rest
        } = params

        const normalizedFileData = normalizeFileInput(fileData, {
          single: true,
        })

        let parsedData
        if (data && typeof data === 'string' && data.trim()) {
          try {
            parsedData = JSON.parse(data)
          } catch (parseError) {
            const errorMsg = getErrorMessage(parseError, 'Unknown JSON error')
            throw new Error(
              `Invalid JSON data format: ${errorMsg}. Please check your JSON syntax (e.g., strings must be quoted like "value").`
            )
          }
        } else if (data && typeof data === 'object') {
          parsedData = data
        }

        let parsedFilter
        if (filter && typeof filter === 'string' && filter.trim()) {
          parsedFilter = filter.trim()
        }

        let parsedQueryEmbedding
        if (queryEmbedding && typeof queryEmbedding === 'string' && queryEmbedding.trim()) {
          try {
            parsedQueryEmbedding = JSON.parse(queryEmbedding)
          } catch (parseError) {
            const errorMsg = getErrorMessage(parseError, 'Unknown JSON error')
            throw new Error(
              `Invalid query embedding format: ${errorMsg}. Please provide a valid array of numbers like [0.1, 0.2, 0.3].`
            )
          }
        } else if (queryEmbedding && Array.isArray(queryEmbedding)) {
          parsedQueryEmbedding = queryEmbedding
        }

        let parsedRpcParams
        if (rpcParams && typeof rpcParams === 'string' && rpcParams.trim()) {
          try {
            parsedRpcParams = JSON.parse(rpcParams)
          } catch (parseError) {
            const errorMsg = getErrorMessage(parseError, 'Unknown JSON error')
            throw new Error(
              `Invalid RPC params format: ${errorMsg}. Please provide a valid JSON object.`
            )
          }
        } else if (rpcParams && typeof rpcParams === 'object') {
          parsedRpcParams = rpcParams
        }

        let parsedPaths
        if (paths && typeof paths === 'string' && paths.trim()) {
          try {
            parsedPaths = JSON.parse(paths)
          } catch (parseError) {
            const errorMsg = getErrorMessage(parseError, 'Unknown JSON error')
            throw new Error(
              `Invalid paths format: ${errorMsg}. Please provide a valid JSON array like ["path1", "path2"].`
            )
          }
        } else if (paths && Array.isArray(paths)) {
          parsedPaths = paths
        }

        let parsedAllowedMimeTypes
        if (allowedMimeTypes && typeof allowedMimeTypes === 'string' && allowedMimeTypes.trim()) {
          try {
            parsedAllowedMimeTypes = JSON.parse(allowedMimeTypes)
          } catch (parseError) {
            const errorMsg = getErrorMessage(parseError, 'Unknown JSON error')
            throw new Error(
              `Invalid allowedMimeTypes format: ${errorMsg}. Please provide a valid JSON array.`
            )
          }
        } else if (allowedMimeTypes && Array.isArray(allowedMimeTypes)) {
          parsedAllowedMimeTypes = allowedMimeTypes
        }

        const parsedUpsert = upsert === 'true' || upsert === true
        const parsedDownload = download === 'true' || download === true
        const parsedIsPublic = rest.isPublic === 'true' || rest.isPublic === true

        const result = { ...rest }

        if (parsedData !== undefined) {
          result.data = parsedData
        }

        if (parsedFilter !== undefined && parsedFilter !== '') {
          result.filter = parsedFilter
        }

        if (parsedQueryEmbedding !== undefined) {
          result.queryEmbedding = parsedQueryEmbedding
        }

        if (parsedRpcParams !== undefined) {
          result.params = parsedRpcParams
        }

        if (operation === 'invoke_function') {
          if (method !== undefined) {
            result.method = method
          }

          if (functionBody && typeof functionBody === 'string' && functionBody.trim()) {
            try {
              result.body = JSON.parse(functionBody)
            } catch (parseError) {
              const errorMsg = getErrorMessage(parseError, 'Unknown JSON error')
              throw new Error(
                `Invalid Edge Function body format: ${errorMsg}. Please provide a valid JSON object.`
              )
            }
          } else if (functionBody && typeof functionBody === 'object') {
            result.body = functionBody
          }

          if (functionHeaders) {
            let parsedHeaders
            if (typeof functionHeaders === 'string' && functionHeaders.trim()) {
              try {
                parsedHeaders = JSON.parse(functionHeaders)
              } catch (parseError) {
                const errorMsg = getErrorMessage(parseError, 'Unknown JSON error')
                throw new Error(
                  `Invalid Edge Function headers format: ${errorMsg}. Please provide a valid JSON object.`
                )
              }
            } else if (typeof functionHeaders === 'object') {
              parsedHeaders = functionHeaders
            }

            if (parsedHeaders !== undefined) {
              if (
                typeof parsedHeaders !== 'object' ||
                parsedHeaders === null ||
                Array.isArray(parsedHeaders)
              ) {
                throw new Error(
                  'Edge Function headers must be a JSON object of header name to value (not an array).'
                )
              }
              result.headers = parsedHeaders
            }
          }
        }

        if (parsedPaths !== undefined) {
          result.paths = parsedPaths
        }

        if (parsedAllowedMimeTypes !== undefined) {
          result.allowedMimeTypes = parsedAllowedMimeTypes
        }

        if (upsert !== undefined) {
          result.upsert = parsedUpsert
        }

        if (download !== undefined) {
          result.download = parsedDownload
        }

        if (rest.isPublic !== undefined) {
          result.isPublic = parsedIsPublic
        }

        if (normalizedFileData !== undefined) {
          result.fileData = normalizedFileData
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    projectId: { type: 'string', description: 'Supabase project identifier' },
    table: { type: 'string', description: 'Database table name' },
    select: { type: 'string', description: 'Columns to return (comma-separated, defaults to *)' },
    apiKey: { type: 'string', description: 'Service role secret key' },
    data: { type: 'json', description: 'Row data' },
    filter: { type: 'string', description: 'PostgREST filter syntax' },
    orderBy: { type: 'string', description: 'Sort column' },
    limit: { type: 'number', description: 'Result limit' },
    offset: { type: 'number', description: 'Number of rows to skip' },
    functionName: {
      type: 'string',
      description:
        'Function name — PostgreSQL function for RPC or vector search, or Edge Function name to invoke',
    },
    queryEmbedding: { type: 'array', description: 'Query vector/embedding for similarity search' },
    matchThreshold: { type: 'number', description: 'Minimum similarity threshold (0-1)' },
    matchCount: { type: 'number', description: 'Maximum number of similar results to return' },
    params: { type: 'json', description: 'Parameters to pass to RPC function' },
    method: { type: 'string', description: 'HTTP method for the Edge Function request' },
    body: { type: 'json', description: 'Request body to send to the Edge Function' },
    headers: { type: 'json', description: 'Additional headers for the Edge Function request' },
    onConflict: { type: 'string', description: 'Conflict target column(s) for upsert' },
    column: { type: 'string', description: 'Column name to search in' },
    query: { type: 'string', description: 'Search query' },
    searchType: { type: 'string', description: 'Search type: plain, phrase, or websearch' },
    language: { type: 'string', description: 'Language for text search' },
    countType: { type: 'string', description: 'Count type: exact, planned, or estimated' },
    schema: { type: 'string', description: 'Database schema to introspect (e.g., public)' },
    bucket: { type: 'string', description: 'Storage bucket name' },
    path: { type: 'string', description: 'File or folder path in storage' },
    fileData: { type: 'json', description: 'File data (UserFile)' },
    contentType: { type: 'string', description: 'MIME type of the file' },
    cacheControl: { type: 'string', description: 'Cache-Control max-age in seconds for upload' },
    fileName: { type: 'string', description: 'File name for upload or download override' },
    upsert: { type: 'boolean', description: 'Whether to overwrite existing file' },
    download: { type: 'boolean', description: 'Whether to force download' },
    paths: { type: 'array', description: 'Array of file paths' },
    fromPath: { type: 'string', description: 'Source file path for move/copy' },
    toPath: { type: 'string', description: 'Destination file path for move/copy' },
    sortBy: { type: 'string', description: 'Column to sort by' },
    sortOrder: { type: 'string', description: 'Sort order: asc or desc' },
    search: { type: 'string', description: 'Search term for filtering' },
    expiresIn: { type: 'number', description: 'Expiration time in seconds for signed URL' },
    isPublic: { type: 'boolean', description: 'Whether bucket should be public' },
    fileSizeLimit: { type: 'number', description: 'Maximum file size in bytes' },
    allowedMimeTypes: { type: 'array', description: 'Array of allowed MIME types' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    results: {
      type: 'json',
      description:
        'Database records, storage objects, or operation results depending on the operation type',
    },
    count: {
      type: 'number',
      description: 'Row count for count operations',
    },
    file: {
      type: 'file',
      description: 'Downloaded file stored in execution files',
    },
    publicUrl: {
      type: 'string',
      description: 'Public URL for storage file',
    },
    signedUrl: {
      type: 'string',
      description: 'Temporary signed URL for storage file',
    },
    tables: {
      type: 'json',
      description: 'Array of table schemas for introspect operation',
    },
    schemas: {
      type: 'json',
      description: 'Array of schema names found in the database',
    },
  },
}
