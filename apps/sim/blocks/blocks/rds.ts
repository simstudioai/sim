import { RDSIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { RdsResponse } from '@/tools/rds/types'

export const RDSBlock: BlockConfig<RdsResponse> = {
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
    },
    // Set clause for updates
    {
      id: 'data',
      title: 'Update Data (JSON)',
      type: 'code',
      placeholder: '{\n  "name": "Jane Doe",\n  "email": "jane@example.com"\n}',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    // Conditions for update/delete (parameterized for SQL injection prevention)
    {
      id: 'conditions',
      title: 'Conditions (JSON)',
      type: 'code',
      placeholder: '{\n  "id": 1\n}',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'conditions',
      title: 'Conditions (JSON)',
      type: 'code',
      placeholder: '{\n  "id": 1\n}',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
  ],
  tools: {
    access: ['rds_query', 'rds_insert', 'rds_update', 'rds_delete', 'rds_execute'],
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
          default:
            throw new Error(`Invalid RDS operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, data, conditions, ...rest } = params

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
  },
}
