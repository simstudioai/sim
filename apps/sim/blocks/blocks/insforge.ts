import { InsForgeIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { InsForgeBaseResponse } from '@/tools/insforge/types'

export const InsForgeBlock: BlockConfig<InsForgeBaseResponse> = {
  type: 'insforge',
  name: 'InsForge',
  description: 'Use InsForge backend',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate InsForge into the workflow. Supports database operations (query, insert, update, delete, upsert), storage management (upload, download, list, delete files), serverless function invocation, and AI capabilities (chat completions, vision, image generation).',
  docsLink: 'https://docs.sim.ai/tools/insforge',
  category: 'tools',
  bgColor: '#000000',
  icon: InsForgeIcon,
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
        // Storage Operations
        { label: 'Storage: Upload File', id: 'storage_upload' },
        { label: 'Storage: Download File', id: 'storage_download' },
        { label: 'Storage: List Files', id: 'storage_list' },
        { label: 'Storage: Delete Files', id: 'storage_delete' },
        // Functions
        { label: 'Invoke Function', id: 'invoke' },
        // AI Operations
        { label: 'AI: Chat Completion', id: 'completion' },
        { label: 'AI: Vision', id: 'vision' },
        { label: 'AI: Image Generation', id: 'image_generation' },
      ],
      value: () => 'query',
    },
    {
      id: 'baseUrl',
      title: 'Base URL',
      type: 'short-input',
      placeholder: 'https://your-app.insforge.app',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Your InsForge anon key or service role key',
      password: true,
      required: true,
    },
    // Database table field
    {
      id: 'table',
      title: 'Table',
      type: 'short-input',
      placeholder: 'Name of the table',
      required: true,
      condition: {
        field: 'operation',
        value: ['query', 'get_row', 'insert', 'update', 'delete', 'upsert'],
      },
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
    },
    {
      id: 'filter',
      title: 'Filter (PostgREST syntax)',
      type: 'short-input',
      placeholder: 'id=eq.123',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'filter',
      title: 'Filter (PostgREST syntax)',
      type: 'short-input',
      placeholder: 'id=eq.123',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
    // Optional filter for query operation
    {
      id: 'filter',
      title: 'Filter (PostgREST syntax)',
      type: 'short-input',
      placeholder: 'status=eq.active',
      condition: { field: 'operation', value: 'query' },
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
    // Storage bucket field
    {
      id: 'bucket',
      title: 'Bucket Name',
      type: 'short-input',
      placeholder: 'my-bucket',
      condition: {
        field: 'operation',
        value: ['storage_upload', 'storage_download', 'storage_list', 'storage_delete'],
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
    // Storage Delete fields
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'folder/file.jpg',
      condition: { field: 'operation', value: 'storage_delete' },
      required: true,
    },
    // Functions fields
    {
      id: 'functionName',
      title: 'Function Name',
      type: 'short-input',
      placeholder: 'my-function',
      condition: { field: 'operation', value: 'invoke' },
      required: true,
    },
    {
      id: 'body',
      title: 'Request Body (JSON)',
      type: 'code',
      placeholder: '{\n  "key": "value"\n}',
      condition: { field: 'operation', value: 'invoke' },
    },
    // AI Completion fields
    {
      id: 'model',
      title: 'Model',
      type: 'short-input',
      placeholder: 'gpt-4o-mini',
      condition: { field: 'operation', value: 'completion' },
    },
    {
      id: 'messages',
      title: 'Messages (JSON array)',
      type: 'code',
      placeholder:
        '[\n  {"role": "system", "content": "You are a helpful assistant."},\n  {"role": "user", "content": "Hello!"}\n]',
      condition: { field: 'operation', value: 'completion' },
      required: true,
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'short-input',
      placeholder: '1.0',
      condition: { field: 'operation', value: 'completion' },
    },
    {
      id: 'maxTokens',
      title: 'Max Tokens',
      type: 'short-input',
      placeholder: '1000',
      condition: { field: 'operation', value: 'completion' },
    },
    // AI Vision fields
    {
      id: 'model',
      title: 'Model',
      type: 'short-input',
      placeholder: 'gpt-4o',
      condition: { field: 'operation', value: 'vision' },
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Describe what you see in this image...',
      condition: { field: 'operation', value: 'vision' },
      required: true,
    },
    {
      id: 'imageUrl',
      title: 'Image URL',
      type: 'short-input',
      placeholder: 'https://example.com/image.jpg',
      condition: { field: 'operation', value: 'vision' },
      required: true,
    },
    {
      id: 'maxTokens',
      title: 'Max Tokens',
      type: 'short-input',
      placeholder: '1000',
      condition: { field: 'operation', value: 'vision' },
    },
    // AI Image Generation fields
    {
      id: 'model',
      title: 'Model',
      type: 'short-input',
      placeholder: 'dall-e-3',
      condition: { field: 'operation', value: 'image_generation' },
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'A beautiful sunset over the ocean...',
      condition: { field: 'operation', value: 'image_generation' },
      required: true,
    },
    {
      id: 'size',
      title: 'Size',
      type: 'dropdown',
      options: [
        { label: '1024x1024', id: '1024x1024' },
        { label: '1792x1024', id: '1792x1024' },
        { label: '1024x1792', id: '1024x1792' },
      ],
      value: () => '1024x1024',
      condition: { field: 'operation', value: 'image_generation' },
    },
    {
      id: 'quality',
      title: 'Quality',
      type: 'dropdown',
      options: [
        { label: 'Standard', id: 'standard' },
        { label: 'HD', id: 'hd' },
      ],
      value: () => 'standard',
      condition: { field: 'operation', value: 'image_generation' },
    },
    {
      id: 'n',
      title: 'Number of Images',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'image_generation' },
    },
  ],
  tools: {
    access: [
      'insforge_query',
      'insforge_get_row',
      'insforge_insert',
      'insforge_update',
      'insforge_delete',
      'insforge_upsert',
      'insforge_storage_upload',
      'insforge_storage_download',
      'insforge_storage_list',
      'insforge_storage_delete',
      'insforge_invoke',
      'insforge_completion',
      'insforge_vision',
      'insforge_image_generation',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'insforge_query'
          case 'get_row':
            return 'insforge_get_row'
          case 'insert':
            return 'insforge_insert'
          case 'update':
            return 'insforge_update'
          case 'delete':
            return 'insforge_delete'
          case 'upsert':
            return 'insforge_upsert'
          case 'storage_upload':
            return 'insforge_storage_upload'
          case 'storage_download':
            return 'insforge_storage_download'
          case 'storage_list':
            return 'insforge_storage_list'
          case 'storage_delete':
            return 'insforge_storage_delete'
          case 'invoke':
            return 'insforge_invoke'
          case 'completion':
            return 'insforge_completion'
          case 'vision':
            return 'insforge_vision'
          case 'image_generation':
            return 'insforge_image_generation'
          default:
            throw new Error(`Invalid InsForge operation: ${params.operation}`)
        }
      },
      params: (params) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { operation, data, body, messages, upsert, ...rest } = params

        // Parse JSON data if it's a string
        let parsedData
        if (data && typeof data === 'string' && data.trim()) {
          try {
            parsedData = JSON.parse(data)
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(`Invalid JSON data format: ${errorMsg}`)
          }
        } else if (data && typeof data === 'object') {
          parsedData = data
        }

        // Handle body for function invoke
        let parsedBody
        if (body && typeof body === 'string' && body.trim()) {
          try {
            parsedBody = JSON.parse(body)
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(`Invalid body format: ${errorMsg}`)
          }
        } else if (body && typeof body === 'object') {
          parsedBody = body
        }

        // Handle messages for AI completion
        let parsedMessages
        if (messages && typeof messages === 'string' && messages.trim()) {
          try {
            parsedMessages = JSON.parse(messages)
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(`Invalid messages format: ${errorMsg}`)
          }
        } else if (messages && Array.isArray(messages)) {
          parsedMessages = messages
        }

        // Convert string booleans to actual booleans
        const parsedUpsert = upsert === 'true' || upsert === true

        // Build params object, only including defined values
        const result = { ...rest }

        if (parsedData !== undefined) {
          result.data = parsedData
        }

        if (parsedBody !== undefined) {
          result.body = parsedBody
        }

        if (parsedMessages !== undefined) {
          result.messages = parsedMessages
        }

        if (upsert !== undefined) {
          result.upsert = parsedUpsert
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    baseUrl: { type: 'string', description: 'InsForge backend URL' },
    apiKey: { type: 'string', description: 'API key' },
    // Database inputs
    table: { type: 'string', description: 'Database table name' },
    data: { type: 'json', description: 'Row data' },
    filter: { type: 'string', description: 'PostgREST filter syntax' },
    orderBy: { type: 'string', description: 'Sort column' },
    limit: { type: 'number', description: 'Result limit' },
    offset: { type: 'number', description: 'Number of rows to skip' },
    // Storage inputs
    bucket: { type: 'string', description: 'Storage bucket name' },
    path: { type: 'string', description: 'File path in storage' },
    fileContent: { type: 'string', description: 'File content (base64 for binary)' },
    contentType: { type: 'string', description: 'MIME type of the file' },
    fileName: { type: 'string', description: 'Optional filename override' },
    upsert: { type: 'boolean', description: 'Whether to overwrite existing file' },
    paths: { type: 'array', description: 'Array of file paths' },
    // Functions inputs
    functionName: { type: 'string', description: 'Name of the function to invoke' },
    body: { type: 'json', description: 'Request body for function' },
    // AI inputs
    model: { type: 'string', description: 'AI model to use' },
    messages: { type: 'array', description: 'Chat messages' },
    temperature: { type: 'number', description: 'Sampling temperature' },
    maxTokens: { type: 'number', description: 'Maximum tokens to generate' },
    prompt: { type: 'string', description: 'Prompt for AI operations' },
    imageUrl: { type: 'string', description: 'URL of image to analyze' },
    size: { type: 'string', description: 'Image size for generation' },
    quality: { type: 'string', description: 'Image quality for generation' },
    n: { type: 'number', description: 'Number of images to generate' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    results: {
      type: 'json',
      description: 'Database records, storage objects, or operation results',
    },
    file: {
      type: 'files',
      description: 'Downloaded file stored in execution files',
    },
    content: {
      type: 'string',
      description: 'AI generated text content',
    },
    images: {
      type: 'array',
      description: 'Generated images with URLs',
    },
    usage: {
      type: 'json',
      description: 'Token usage statistics for AI operations',
    },
  },
}
