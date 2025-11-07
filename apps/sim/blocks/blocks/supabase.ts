import { SupabaseIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console/logger'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { SupabaseResponse } from '@/tools/supabase/types'

const logger = createLogger('SupabaseBlock')

export const SupabaseBlock: BlockConfig<SupabaseResponse> = {
  type: 'supabase',
  name: 'Supabase',
  description: 'Use Supabase database',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Supabase into the workflow. Supports database operations (query, insert, update, delete, upsert), full-text search, RPC functions, row counting, vector search, and complete storage management (upload, download, list, move, copy, delete files and buckets).',
  docsLink: 'https://docs.sim.ai/tools/supabase',
  category: 'tools',
  bgColor: '#1C1C1C',
  icon: SupabaseIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Database Operations
        { label: 'Get Many Rows', id: 'query' },
        { label: 'Get a Row', id: 'get_row' },
        { label: 'Create a Row', id: 'insert' },
        { label: 'Update a Row', id: 'update' },
        { label: 'Delete a Row', id: 'delete' },
        { label: 'Upsert a Row', id: 'upsert' },
        { label: 'Count Rows', id: 'count' },
        // Advanced Database Operations
        { label: 'Full-Text Search', id: 'text_search' },
        { label: 'Vector Search', id: 'vector_search' },
        { label: 'Call RPC Function', id: 'rpc' },
        // Storage - File Operations
        { label: 'Storage: Upload File', id: 'storage_upload' },
        { label: 'Storage: Download File', id: 'storage_download' },
        { label: 'Storage: List Files', id: 'storage_list' },
        { label: 'Storage: Delete Files', id: 'storage_delete' },
        { label: 'Storage: Move File', id: 'storage_move' },
        { label: 'Storage: Copy File', id: 'storage_copy' },
        { label: 'Storage: Get Public URL', id: 'storage_get_public_url' },
        { label: 'Storage: Create Signed URL', id: 'storage_create_signed_url' },
        // Storage - Bucket Operations
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
      id: 'apiKey',
      title: 'Service Role Secret',
      type: 'short-input',
      placeholder: 'Your Supabase service role secret key',
      password: true,
      required: true,
    },
    // Data input for create/update operations
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
    // Filter for get_row, update, delete operations (required)
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
    // Optional filter for query operation
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
    // Optional order by for query operation
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'column_name (add DESC for descending)',
      condition: { field: 'operation', value: 'query' },
    },
    // Optional limit for query operation
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'query' },
    },
    // Vector search operation fields
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
    // RPC operation fields
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
    // Text Search operation fields
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
    // Count operation fields
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
    // Storage bucket field (for all storage operations except list_buckets)
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
    // Storage Upload fields
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'folder/file.jpg',
      condition: { field: 'operation', value: 'storage_upload' },
      required: true,
    },
    {
      id: 'fileContent',
      title: 'File Content',
      type: 'code',
      placeholder: 'Base64 encoded for binary files, or plain text',
      condition: { field: 'operation', value: 'storage_upload' },
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
    // Storage Download fields
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
    // Storage List fields
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
    // Storage Delete fields
    {
      id: 'paths',
      title: 'File Paths (JSON array)',
      type: 'code',
      placeholder: '["folder/file1.jpg", "folder/file2.jpg"]',
      condition: { field: 'operation', value: 'storage_delete' },
      required: true,
    },
    // Storage Move fields
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
    // Storage Copy fields
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
    // Storage Get Public URL fields
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
    // Storage Create Signed URL fields
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
    // Storage Create Bucket fields
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
          ...rest
        } = params

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

        // Handle query embedding for vector search
        let parsedQueryEmbedding
        if (queryEmbedding && typeof queryEmbedding === 'string' && queryEmbedding.trim()) {
          try {
            parsedQueryEmbedding = JSON.parse(queryEmbedding)
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(
              `Invalid query embedding format: ${errorMsg}. Please provide a valid array of numbers like [0.1, 0.2, 0.3].`
            )
          }
        } else if (queryEmbedding && Array.isArray(queryEmbedding)) {
          parsedQueryEmbedding = queryEmbedding
        }

        // Handle RPC params
        let parsedRpcParams
        if (rpcParams && typeof rpcParams === 'string' && rpcParams.trim()) {
          try {
            parsedRpcParams = JSON.parse(rpcParams)
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(
              `Invalid RPC params format: ${errorMsg}. Please provide a valid JSON object.`
            )
          }
        } else if (rpcParams && typeof rpcParams === 'object') {
          parsedRpcParams = rpcParams
        }

        // Handle paths array for storage delete
        let parsedPaths
        if (paths && typeof paths === 'string' && paths.trim()) {
          try {
            parsedPaths = JSON.parse(paths)
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(
              `Invalid paths format: ${errorMsg}. Please provide a valid JSON array like ["path1", "path2"].`
            )
          }
        } else if (paths && Array.isArray(paths)) {
          parsedPaths = paths
        }

        // Handle allowedMimeTypes array
        let parsedAllowedMimeTypes
        if (allowedMimeTypes && typeof allowedMimeTypes === 'string' && allowedMimeTypes.trim()) {
          try {
            parsedAllowedMimeTypes = JSON.parse(allowedMimeTypes)
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(
              `Invalid allowedMimeTypes format: ${errorMsg}. Please provide a valid JSON array.`
            )
          }
        } else if (allowedMimeTypes && Array.isArray(allowedMimeTypes)) {
          parsedAllowedMimeTypes = allowedMimeTypes
        }

        // Convert string booleans to actual booleans
        const parsedUpsert = upsert === 'true' || upsert === true
        const parsedDownload = download === 'true' || download === true
        const parsedIsPublic = rest.isPublic === 'true' || rest.isPublic === true

        // Build params object, only including defined values
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
    offset: { type: 'number', description: 'Number of rows to skip' },
    // Vector search operation inputs
    functionName: {
      type: 'string',
      description: 'PostgreSQL function name for vector search or RPC',
    },
    queryEmbedding: { type: 'array', description: 'Query vector/embedding for similarity search' },
    matchThreshold: { type: 'number', description: 'Minimum similarity threshold (0-1)' },
    matchCount: { type: 'number', description: 'Maximum number of similar results to return' },
    // RPC operation inputs
    params: { type: 'json', description: 'Parameters to pass to RPC function' },
    // Text search inputs
    column: { type: 'string', description: 'Column name to search in' },
    query: { type: 'string', description: 'Search query' },
    searchType: { type: 'string', description: 'Search type: plain, phrase, or websearch' },
    language: { type: 'string', description: 'Language for text search' },
    // Count operation inputs
    countType: { type: 'string', description: 'Count type: exact, planned, or estimated' },
    // Storage operation inputs
    bucket: { type: 'string', description: 'Storage bucket name' },
    path: { type: 'string', description: 'File path in storage' },
    fileContent: { type: 'string', description: 'File content (base64 for binary)' },
    contentType: { type: 'string', description: 'MIME type of the file' },
    fileName: { type: 'string', description: 'Optional filename override for downloaded file' },
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
      type: 'files',
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
  },
}
