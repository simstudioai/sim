import { RDSIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { RdsIntrospectResponse, RdsResponse } from '@/tools/rds/types'

export const RDSBlock: BlockConfig<RdsResponse | RdsIntrospectResponse> = {
  type: 'rds',
  name: 'Amazon RDS',
  description: 'Connect to Amazon RDS via Data API',
  longDescription:
    'Integrate Amazon RDS Aurora Serverless into the workflow using the Data API. Can query, insert, update, delete, and execute raw SQL without managing database connections.',
  docsLink: 'https://docs.sim.ai/tools/rds',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  icon: RDSIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Query (SELECT)', id: 'query' },
        { label: 'Insert Data', id: 'insert' },
        { label: 'Update Data', id: 'update' },
        { label: 'Delete Data', id: 'delete' },
        { label: 'Execute Raw SQL', id: 'execute' },
        { label: 'Introspect Schema', id: 'introspect' },
      ],
      value: () => 'query',
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'resourceArn',
      title: 'Resource ARN',
      type: 'short-input',
      placeholder: 'arn:aws:rds:us-east-1:123456789:cluster:my-cluster',
      required: true,
    },
    {
      id: 'secretArn',
      title: 'Secret ARN',
      type: 'short-input',
      placeholder: 'arn:aws:secretsmanager:us-east-1:123456789:secret:my-secret',
      required: true,
    },
    {
      id: 'database',
      title: 'Database Name',
      type: 'short-input',
      placeholder: 'your_database',
      required: false,
    },
    // Table field for insert/update/delete operations
    {
      id: 'table',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'users',
      condition: { field: 'operation', value: 'insert' },
      required: true,
    },
    {
      id: 'table',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'users',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'table',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'users',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
    // SQL Query field
    {
      id: 'query',
      title: 'SQL Query',
      type: 'code',
      placeholder: 'SELECT * FROM users WHERE active = true',
      condition: { field: 'operation', value: 'query' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert SQL database developer. Write SQL queries based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query.

### QUERY GUIDELINES
1. **Syntax**: Use standard SQL syntax compatible with both MySQL and PostgreSQL
2. **Performance**: Write efficient queries with proper indexing considerations
3. **Security**: Use parameterized queries when applicable
4. **Readability**: Format queries with proper indentation and spacing
5. **Best Practices**: Follow standard SQL naming conventions

### EXAMPLES

**Simple Select**: "Get all active users"
→ SELECT id, name, email, created_at
  FROM users
  WHERE active = true
  ORDER BY created_at DESC;

**Complex Join**: "Get users with their order counts and total spent"
→ SELECT
      u.id,
      u.name,
      u.email,
      COUNT(o.id) as order_count,
      COALESCE(SUM(o.total), 0) as total_spent
  FROM users u
  LEFT JOIN orders o ON u.id = o.user_id
  WHERE u.active = true
  GROUP BY u.id, u.name, u.email
  HAVING COUNT(o.id) > 0
  ORDER BY total_spent DESC;

### REMEMBER
Return ONLY the SQL query - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the SQL query you need...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'query',
      title: 'SQL Query',
      type: 'code',
      placeholder: 'SELECT * FROM table_name',
      condition: { field: 'operation', value: 'execute' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert SQL database developer. Write SQL queries based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query.

### QUERY GUIDELINES
1. **Syntax**: Use standard SQL syntax compatible with both MySQL and PostgreSQL
2. **Performance**: Write efficient queries with proper indexing considerations
3. **Security**: Use parameterized queries when applicable
4. **Readability**: Format queries with proper indentation and spacing
5. **Best Practices**: Follow standard SQL naming conventions

### EXAMPLES

**Simple Select**: "Get all active users"
→ SELECT id, name, email, created_at
  FROM users
  WHERE active = true
  ORDER BY created_at DESC;

**Create Table**: "Create a users table"
→ CREATE TABLE users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

### REMEMBER
Return ONLY the SQL query - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the SQL query you need...',
        generationType: 'sql-query',
      },
    },
    // Data for insert operations
    {
      id: 'data',
      title: 'Data (JSON)',
      type: 'code',
      placeholder: '{\n  "name": "John Doe",\n  "email": "john@example.com",\n  "active": true\n}',
      condition: { field: 'operation', value: 'insert' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert database developer. Generate a JSON object for inserting data into an Amazon RDS table based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY a valid JSON object. Do not include any explanations, markdown formatting, or additional text.

### GUIDELINES
1. Use appropriate data types (strings in quotes, numbers without, booleans as true/false)
2. Use snake_case for field names (common database convention)
3. Include relevant fields based on the table structure
4. Use null for optional fields that should be empty

### EXAMPLE
User: "Insert a new customer with name, email, and premium status"
Output:
{
  "name": "John Doe",
  "email": "john@example.com",
  "is_premium": true,
  "created_at": "NOW()"
}`,
        placeholder: 'Describe the data you want to insert...',
        generationType: 'json-object',
      },
    },
    // Set clause for updates
    {
      id: 'data',
      title: 'Update Data (JSON)',
      type: 'code',
      placeholder: '{\n  "name": "Jane Doe",\n  "email": "jane@example.com"\n}',
      condition: { field: 'operation', value: 'update' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert database developer. Generate a JSON object for updating data in an Amazon RDS table based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY a valid JSON object containing the fields to update. Do not include any explanations, markdown formatting, or additional text.

### GUIDELINES
1. Only include fields that need to be updated
2. Use appropriate data types (strings in quotes, numbers without, booleans as true/false)
3. Use snake_case for field names
4. Consider including updated_at field if appropriate

### EXAMPLE
User: "Update the customer to inactive and clear their subscription"
Output:
{
  "is_active": false,
  "subscription_id": null,
  "updated_at": "NOW()"
}`,
        placeholder: 'Describe the fields you want to update...',
        generationType: 'json-object',
      },
    },
    // Conditions for update/delete (parameterized for SQL injection prevention)
    {
      id: 'conditions',
      title: 'Conditions (JSON)',
      type: 'code',
      placeholder: '{\n  "id": 1\n}',
      condition: { field: 'operation', value: 'update' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for RDS WHERE conditions based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON object starting with { and ending with }
- Each key-value pair represents a column and its expected value
- Multiple conditions will be combined with AND
- Use appropriate data types (strings, numbers, booleans)

### EXAMPLE
User: "Update records where user_id is 123 and status is active"
Output:
{
  "user_id": 123,
  "status": "active"
}

Return ONLY the JSON object.`,
        placeholder: 'Describe the conditions...',
        generationType: 'json-object',
      },
    },
    {
      id: 'conditions',
      title: 'Conditions (JSON)',
      type: 'code',
      placeholder: '{\n  "id": 1\n}',
      condition: { field: 'operation', value: 'delete' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for RDS WHERE conditions based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON object starting with { and ending with }
- Each key-value pair represents a column and its expected value
- Multiple conditions will be combined with AND
- Use appropriate data types (strings, numbers, booleans)
- Be careful with delete conditions - they determine which rows are removed

### EXAMPLE
User: "Delete records where status is expired and created before 2023"
Output:
{
  "status": "expired",
  "created_year": 2022
}

Return ONLY the JSON object.`,
        placeholder: 'Describe the conditions...',
        generationType: 'json-object',
      },
    },
    {
      id: 'schema',
      title: 'Schema Name',
      type: 'short-input',
      placeholder: 'public (PostgreSQL) or database name (MySQL)',
      condition: { field: 'operation', value: 'introspect' },
      required: false,
    },
    {
      id: 'engine',
      title: 'Database Engine',
      type: 'dropdown',
      options: [
        { label: 'Auto-detect', id: '' },
        { label: 'Aurora PostgreSQL', id: 'aurora-postgresql' },
        { label: 'Aurora MySQL', id: 'aurora-mysql' },
      ],
      condition: { field: 'operation', value: 'introspect' },
      value: () => '',
    },
  ],
  tools: {
    access: [
      'rds_query',
      'rds_insert',
      'rds_update',
      'rds_delete',
      'rds_execute',
      'rds_introspect',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'rds_query'
          case 'insert':
            return 'rds_insert'
          case 'update':
            return 'rds_update'
          case 'delete':
            return 'rds_delete'
          case 'execute':
            return 'rds_execute'
          case 'introspect':
            return 'rds_introspect'
          default:
            throw new Error(`Invalid RDS operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, data, conditions, schema, engine, ...rest } = params

        // Parse JSON fields
        const parseJson = (value: unknown, fieldName: string) => {
          if (!value) return undefined
          if (typeof value === 'object') return value
          if (typeof value === 'string' && value.trim()) {
            try {
              return JSON.parse(value)
            } catch (parseError) {
              const errorMsg =
                parseError instanceof Error ? parseError.message : 'Unknown JSON error'
              throw new Error(`Invalid JSON in ${fieldName}: ${errorMsg}`)
            }
          }
          return undefined
        }

        const parsedData = parseJson(data, 'data')
        const parsedConditions = parseJson(conditions, 'conditions')

        // Build connection config
        const connectionConfig = {
          region: rest.region,
          accessKeyId: rest.accessKeyId,
          secretAccessKey: rest.secretAccessKey,
          resourceArn: rest.resourceArn,
          secretArn: rest.secretArn,
          database: rest.database,
        }

        // Build params object
        const result: Record<string, unknown> = { ...connectionConfig }

        if (rest.table) result.table = rest.table
        if (rest.query) result.query = rest.query
        if (parsedConditions !== undefined) result.conditions = parsedConditions
        if (parsedData !== undefined) result.data = parsedData
        if (schema) result.schema = schema
        if (engine) result.engine = engine

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Database operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    resourceArn: { type: 'string', description: 'Aurora DB cluster ARN' },
    secretArn: { type: 'string', description: 'Secrets Manager secret ARN' },
    database: { type: 'string', description: 'Database name' },
    table: { type: 'string', description: 'Table name' },
    query: { type: 'string', description: 'SQL query to execute' },
    data: { type: 'json', description: 'Data for insert/update operations' },
    conditions: { type: 'json', description: 'Conditions for update/delete (e.g., {"id": 1})' },
    schema: { type: 'string', description: 'Schema to introspect (for introspect operation)' },
    engine: {
      type: 'string',
      description: 'Database engine (aurora-postgresql or aurora-mysql, auto-detected if not set)',
    },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    rows: {
      type: 'array',
      description: 'Array of rows returned from the query',
    },
    rowCount: {
      type: 'number',
      description: 'Number of rows affected by the operation',
    },
    engine: {
      type: 'string',
      description: 'Detected database engine type (for introspect operation)',
    },
    tables: {
      type: 'array',
      description:
        'Array of table schemas with columns, keys, and indexes (for introspect operation)',
    },
    schemas: {
      type: 'array',
      description: 'List of available schemas in the database (for introspect operation)',
    },
  },
}
