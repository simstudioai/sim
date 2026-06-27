import { getErrorMessage } from '@sim/utils/errors'
import { RDSIcon } from '@/components/icons'
import { RDSBlockDisplay } from '@/blocks/blocks/rds.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import type { RdsIntrospectResponse, RdsResponse } from '@/tools/rds/types'

export const RDSBlock: BlockConfig<RdsResponse | RdsIntrospectResponse> = {
  ...RDSBlockDisplay,
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
              const errorMsg = getErrorMessage(parseError, 'Unknown JSON error')
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

export const RDSBlockMeta = {
  tags: ['cloud'],
  url: 'https://aws.amazon.com/rds',
  templates: [
    {
      icon: RDSIcon,
      title: 'RDS daily metrics digest',
      prompt:
        'Build a scheduled workflow that runs an aggregate SQL query against my Amazon RDS database each morning, summarizes the key numbers with an agent, and posts the digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RDSIcon,
      title: 'RDS natural-language query agent',
      prompt:
        'Create an agent that introspects my Amazon RDS schema, turns plain-English questions into SQL, runs the query through the Data API, and returns the results in a readable answer.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'analysis'],
    },
    {
      icon: RDSIcon,
      title: 'RDS lead capture',
      prompt:
        'Build a workflow triggered by a form submission that validates the payload and inserts a new lead row into my Amazon RDS database, then confirms the write back to the submitter.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'forms'],
    },
    {
      icon: RDSIcon,
      title: 'RDS to spreadsheet export',
      prompt:
        'Create a scheduled workflow that queries Amazon RDS for the latest records, writes the rows into a Sim table, and keeps a running export the operations team can review.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'sync'],
    },
    {
      icon: RDSIcon,
      title: 'RDS record updater from Slack',
      prompt:
        'Build a workflow that reads update requests posted in a Slack channel, parses the target record and fields with an agent, and runs the matching UPDATE against Amazon RDS with the conditions applied.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RDSIcon,
      title: 'RDS row-change alerter',
      prompt:
        'Create a scheduled workflow that queries Amazon RDS for rows matching a watch condition, compares them to the previous run stored in a table, and posts a Slack alert when a tracked record changes.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RDSIcon,
      title: 'RDS + BigQuery analytics mirror',
      prompt:
        'Build a scheduled workflow that queries analytical tables from Amazon RDS, loads the rows into BigQuery for downstream BI, and writes a sync log to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
      alsoIntegrations: ['google_bigquery'],
    },
  ],
  skills: [
    {
      name: 'run-readonly-query',
      description:
        'Run a parameterized SELECT against Amazon RDS via the Data API and return the rows.',
      content:
        '# Run Read-only Query\n\nQuery an RDS database through the Data API to answer a question.\n\n## Steps\n1. Write a SELECT statement that returns only the columns needed.\n2. Use parameters for any user-supplied values instead of string concatenation.\n3. Execute the statement and collect the result rows.\n\n## Output\nThe returned rows in a readable table plus a row count. If the result is large, summarize and note that it was limited.',
    },
    {
      name: 'lookup-record',
      description:
        'Fetch a specific record from Amazon RDS by an identifier and return its fields.',
      content:
        '# Lookup Record\n\nRetrieve one row from an RDS table by a key.\n\n## Steps\n1. Identify the table and the unique identifier (id, email, order number).\n2. Run a parameterized SELECT filtered by that identifier.\n3. Return the matching row, or report that no record was found.\n\n## Output\nThe record fields if found, or a clear "not found" result. Do not invent field values.',
    },
    {
      name: 'insert-record',
      description:
        'Insert a new row into an Amazon RDS table from provided field values via the Data API.',
      content:
        '# Insert Record\n\nWrite a new record into an RDS table through the Data API.\n\n## Steps\n1. Identify the target table and map the input values to its columns as key-value pairs.\n2. Run the insert operation with that data object.\n3. To load several rows, repeat the insert for each item, or use the Execute Raw SQL operation with a multi-row INSERT statement.\n\n## Output\nConfirm the table written to and how many rows were inserted. Flag any items skipped for missing required fields.',
    },
  ],
} as const satisfies BlockMeta
