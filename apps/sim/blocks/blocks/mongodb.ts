import { MongoDBIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { MongoDBResponse } from '@/tools/mongodb/types'

export const MongoDBBlock: BlockConfig<MongoDBResponse> = {
  type: 'mongodb',
  name: 'MongoDB',
  description: 'Connect to MongoDB database',
  longDescription:
    'Connect to any MongoDB database to execute queries, manage data, and perform database operations. Supports find, insert, update, delete, and aggregation operations with secure connection handling.',
  docsLink: 'https://docs.sim.ai/tools/mongodb',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MongoDBIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Find Documents', id: 'query' },
        { label: 'Insert Documents', id: 'insert' },
        { label: 'Update Documents', id: 'update' },
        { label: 'Delete Documents', id: 'delete' },
        { label: 'Aggregate Pipeline', id: 'execute' },
      ],
      value: () => 'query',
    },
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      layout: 'full',
      placeholder: 'localhost or your.mongodb.host',
      required: true,
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      layout: 'full',
      placeholder: '27017',
      value: () => '27017',
      required: true,
    },
    {
      id: 'database',
      title: 'Database Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'your_database',
      required: true,
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      layout: 'full',
      placeholder: 'mongodb_user',
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      layout: 'full',
      password: true,
      placeholder: 'Your database password',
    },
    {
      id: 'authSource',
      title: 'Auth Source',
      type: 'short-input',
      layout: 'full',
      placeholder: 'admin',
    },
    {
      id: 'ssl',
      title: 'SSL Mode',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Disabled', id: 'disabled' },
        { label: 'Required', id: 'required' },
        { label: 'Preferred', id: 'preferred' },
      ],
      value: () => 'preferred',
    },
    {
      id: 'collection',
      title: 'Collection Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'users',
      required: true,
    },
    {
      id: 'query',
      title: 'Query Filter (JSON)',
      type: 'code',
      layout: 'full',
      placeholder: '{"status": "active"}',
      condition: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert MongoDB developer. Write MongoDB query filters based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the MongoDB query filter as valid JSON. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw JSON filter.

### QUERY GUIDELINES
1. **Syntax**: Use MongoDB query operators and syntax
2. **Performance**: Write efficient queries with proper indexing considerations
3. **Security**: Avoid dangerous operators like $where, $regex, $expr
4. **Readability**: Format JSON with proper structure
5. **Best Practices**: Follow MongoDB naming conventions

### MONGODB FEATURES
- Use MongoDB query operators ($eq, $ne, $gt, $lt, $in, $and, $or, etc.)
- Leverage MongoDB data types (ObjectId, Date, etc.)
- Use dot notation for nested fields
- Include appropriate field selections

### EXAMPLES

**Simple Filter**: "Find active users"
→ {"status": "active"}

**Complex Filter**: "Find users created in the last 30 days with premium status"
→ {
  "createdAt": {"$gte": {"$date": "2024-01-01T00:00:00Z"}},
  "status": "premium"
}

**Multiple Conditions**: "Find products with price between 10 and 100 and category electronics"
→ {
  "price": {"$gte": 10, "$lte": 100},
  "category": "electronics"
}

### REMEMBER
Return ONLY the MongoDB filter JSON - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the documents you want to find...',
        generationType: 'mongodb-filter',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      layout: 'full',
      placeholder: '100',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'sort',
      title: 'Sort (JSON)',
      type: 'code',
      layout: 'full',
      placeholder: '{"createdAt": -1}',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'documents',
      title: 'Documents (JSON Array)',
      type: 'code',
      layout: 'full',
      placeholder:
        '[\n  {\n    "name": "John Doe",\n    "email": "john@example.com",\n    "status": "active"\n  }\n]',
      condition: { field: 'operation', value: 'insert' },
      required: true,
    },
    {
      id: 'filter',
      title: 'Filter (JSON)',
      type: 'code',
      layout: 'full',
      placeholder: '{"_id": "ObjectId(\\"...\\")" }',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'update',
      title: 'Update (JSON)',
      type: 'code',
      layout: 'full',
      placeholder: '{"$set": {"name": "Jane Doe", "email": "jane@example.com"}}',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'upsert',
      title: 'Upsert',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'multi',
      title: 'Update Multiple',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'filter',
      title: 'Filter (JSON)',
      type: 'code',
      layout: 'full',
      placeholder: '{"_id": "ObjectId(\\"...\\")" }',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
    {
      id: 'multi',
      title: 'Delete Multiple',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'delete' },
    },
    {
      id: 'pipeline',
      title: 'Aggregation Pipeline (JSON Array)',
      type: 'code',
      layout: 'full',
      placeholder:
        '[\n  {"$match": {"status": "active"}},\n  {"$group": {"_id": "$category", "count": {"$sum": 1}}}\n]',
      condition: { field: 'operation', value: 'execute' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert MongoDB developer. Write MongoDB aggregation pipelines based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the MongoDB aggregation pipeline as valid JSON array. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw JSON pipeline array.

### PIPELINE GUIDELINES
1. **Syntax**: Use MongoDB aggregation operators and syntax
2. **Performance**: Write efficient pipelines with proper stage ordering
3. **Security**: Avoid dangerous operators like $where, $function, $accumulator
4. **Readability**: Format JSON with proper structure
5. **Best Practices**: Follow MongoDB aggregation best practices

### MONGODB AGGREGATION STAGES
- Use common stages ($match, $group, $sort, $project, $lookup, $unwind, etc.)
- Chain stages logically for optimal performance
- Use proper aggregation operators ($sum, $avg, $count, $push, etc.)
- Leverage MongoDB's powerful aggregation framework

### EXAMPLES

**Simple Grouping**: "Count documents by category"
→ [
  {"$group": {"_id": "$category", "count": {"$sum": 1}}}
]

**Complex Pipeline**: "Get average order value by customer with more than 5 orders"
→ [
  {"$group": {"_id": "$customerId", "orderCount": {"$sum": 1}, "totalValue": {"$sum": "$amount"}}},
  {"$match": {"orderCount": {"$gt": 5}}},
  {"$project": {"customerId": "$_id", "averageOrderValue": {"$divide": ["$totalValue", "$orderCount"]}}},
  {"$sort": {"averageOrderValue": -1}}
]

### REMEMBER
Return ONLY the MongoDB aggregation pipeline JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the aggregation you want to perform...',
        generationType: 'mongodb-pipeline',
      },
    },
  ],
  tools: {
    access: [
      'mongodb_query',
      'mongodb_insert',
      'mongodb_update',
      'mongodb_delete',
      'mongodb_execute',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'mongodb_query'
          case 'insert':
            return 'mongodb_insert'
          case 'update':
            return 'mongodb_update'
          case 'delete':
            return 'mongodb_delete'
          case 'execute':
            return 'mongodb_execute'
          default:
            throw new Error(`Invalid MongoDB operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, documents, ...rest } = params

        let parsedDocuments
        if (documents && typeof documents === 'string' && documents.trim()) {
          try {
            parsedDocuments = JSON.parse(documents)
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown JSON error'
            throw new Error(
              `Invalid JSON documents format: ${errorMsg}. Please check your JSON syntax.`
            )
          }
        } else if (documents && typeof documents === 'object') {
          parsedDocuments = documents
        }

        const connectionConfig = {
          host: rest.host,
          port: typeof rest.port === 'string' ? Number.parseInt(rest.port, 10) : rest.port || 27017,
          database: rest.database,
          username: rest.username,
          password: rest.password,
          authSource: rest.authSource,
          ssl: rest.ssl || 'preferred',
        }

        const result: any = { ...connectionConfig }

        if (rest.collection) result.collection = rest.collection
        if (rest.query) result.query = rest.query
        if (rest.limit)
          result.limit =
            typeof rest.limit === 'string' ? Number.parseInt(rest.limit, 10) : rest.limit
        if (rest.sort) result.sort = rest.sort
        if (rest.filter) result.filter = rest.filter
        if (rest.update) result.update = rest.update
        if (rest.pipeline) result.pipeline = rest.pipeline
        if (rest.upsert) result.upsert = rest.upsert === 'true' || rest.upsert === true
        if (rest.multi) result.multi = rest.multi === 'true' || rest.multi === true
        if (parsedDocuments !== undefined) result.documents = parsedDocuments

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Database operation to perform' },
    host: { type: 'string', description: 'MongoDB host' },
    port: { type: 'string', description: 'MongoDB port' },
    database: { type: 'string', description: 'Database name' },
    username: { type: 'string', description: 'MongoDB username' },
    password: { type: 'string', description: 'MongoDB password' },
    authSource: { type: 'string', description: 'Authentication database' },
    ssl: { type: 'string', description: 'SSL mode' },
    collection: { type: 'string', description: 'Collection name' },
    query: { type: 'string', description: 'Query filter as JSON string' },
    limit: { type: 'number', description: 'Limit number of documents' },
    sort: { type: 'string', description: 'Sort criteria as JSON string' },
    documents: { type: 'json', description: 'Documents to insert' },
    filter: { type: 'string', description: 'Filter criteria as JSON string' },
    update: { type: 'string', description: 'Update operations as JSON string' },
    pipeline: { type: 'string', description: 'Aggregation pipeline as JSON string' },
    upsert: { type: 'boolean', description: 'Create document if not found' },
    multi: { type: 'boolean', description: 'Operate on multiple documents' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    documents: {
      type: 'array',
      description: 'Array of documents returned from the operation',
    },
    documentCount: {
      type: 'number',
      description: 'Number of documents affected by the operation',
    },
    insertedId: {
      type: 'string',
      description: 'ID of the inserted document (single insert)',
    },
    insertedIds: {
      type: 'array',
      description: 'Array of IDs for inserted documents (multiple insert)',
    },
    modifiedCount: {
      type: 'number',
      description: 'Number of documents modified (update operations)',
    },
    deletedCount: {
      type: 'number',
      description: 'Number of documents deleted (delete operations)',
    },
    matchedCount: {
      type: 'number',
      description: 'Number of documents matched (update operations)',
    },
  },
}
