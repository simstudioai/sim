import { getErrorMessage } from '@sim/utils/errors'
import { PostgresIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { PostgresResponse } from '@/tools/postgresql/types'

export const PostgreSQLBlock: BlockConfig<PostgresResponse> = {
  type: 'postgresql',
  name: 'PostgreSQL',
  description: 'Connect to PostgreSQL database',
  longDescription:
    'Integrate PostgreSQL into the workflow. Can query, insert, update, delete, and execute raw SQL.',
  docsLink: 'https://docs.sim.ai/integrations/postgresql',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#336791',
  icon: PostgresIcon,
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
      id: 'host',
      title: 'Host',
      type: 'short-input',
      placeholder: 'localhost or your.database.host',
      required: true,
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      placeholder: '5432',
      value: () => '5432',
      required: true,
    },
    {
      id: 'database',
      title: 'Database Name',
      type: 'short-input',
      placeholder: 'your_database',
      required: true,
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'postgres',
      required: true,
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      password: true,
      placeholder: 'Your database password',
      required: true,
    },
    {
      id: 'ssl',
      title: 'SSL Mode',
      type: 'dropdown',
      options: [
        { label: 'Disabled', id: 'disabled' },
        { label: 'Required', id: 'required' },
        { label: 'Preferred', id: 'preferred' },
      ],
      value: () => 'preferred',
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
        prompt: `You are an expert PostgreSQL database developer. Write PostgreSQL SQL queries based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query.

### QUERY GUIDELINES
1. **Syntax**: Use PostgreSQL-specific syntax and functions
2. **Performance**: Write efficient queries with proper indexing considerations
3. **Security**: Use parameterized queries when applicable
4. **Readability**: Format queries with proper indentation and spacing
5. **Best Practices**: Follow PostgreSQL naming conventions

### POSTGRESQL FEATURES
- Use PostgreSQL-specific functions (COALESCE, EXTRACT, etc.)
- Leverage advanced features like CTEs, window functions, arrays
- Use proper PostgreSQL data types (TEXT, TIMESTAMPTZ, JSONB, etc.)
- Include appropriate LIMIT clauses for large result sets

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

**With CTE**: "Get top 10 products by sales"
→ WITH product_sales AS (
      SELECT 
          p.id,
          p.name,
          SUM(oi.quantity * oi.price) as total_sales
      FROM products p
      JOIN order_items oi ON p.id = oi.product_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY p.id, p.name
  )
  SELECT * FROM product_sales
  ORDER BY total_sales DESC
  LIMIT 10;

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
        prompt: `You are an expert PostgreSQL database developer. Write PostgreSQL SQL queries based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query.

### QUERY GUIDELINES
1. **Syntax**: Use PostgreSQL-specific syntax and functions
2. **Performance**: Write efficient queries with proper indexing considerations
3. **Security**: Use parameterized queries when applicable
4. **Readability**: Format queries with proper indentation and spacing
5. **Best Practices**: Follow PostgreSQL naming conventions

### POSTGRESQL FEATURES
- Use PostgreSQL-specific functions (COALESCE, EXTRACT, etc.)
- Leverage advanced features like CTEs, window functions, arrays
- Use proper PostgreSQL data types (TEXT, TIMESTAMPTZ, JSONB, etc.)
- Include appropriate LIMIT clauses for large result sets

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

**With CTE**: "Get top 10 products by sales"
→ WITH product_sales AS (
      SELECT 
          p.id,
          p.name,
          SUM(oi.quantity * oi.price) as total_sales
      FROM products p
      JOIN order_items oi ON p.id = oi.product_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY p.id, p.name
  )
  SELECT * FROM product_sales
  ORDER BY total_sales DESC
  LIMIT 10;

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
    // Where clause for update/delete
    {
      id: 'where',
      title: 'WHERE Condition',
      type: 'short-input',
      placeholder: 'id = 1',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'where',
      title: 'WHERE Condition',
      type: 'short-input',
      placeholder: 'id = 1',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
    {
      id: 'schema',
      title: 'Schema Name',
      type: 'short-input',
      placeholder: 'public',
      value: () => 'public',
      condition: { field: 'operation', value: 'introspect' },
    },
  ],
  tools: {
    access: [
      'postgresql_query',
      'postgresql_insert',
      'postgresql_update',
      'postgresql_delete',
      'postgresql_execute',
      'postgresql_introspect',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'postgresql_query'
          case 'insert':
            return 'postgresql_insert'
          case 'update':
            return 'postgresql_update'
          case 'delete':
            return 'postgresql_delete'
          case 'execute':
            return 'postgresql_execute'
          case 'introspect':
            return 'postgresql_introspect'
          default:
            throw new Error(`Invalid PostgreSQL operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, data, ...rest } = params

        // Parse JSON data if it's a string
        let parsedData
        if (data && typeof data === 'string' && data.trim()) {
          try {
            parsedData = JSON.parse(data)
          } catch (parseError) {
            const errorMsg = getErrorMessage(parseError, 'Unknown JSON error')
            throw new Error(`Invalid JSON data format: ${errorMsg}. Please check your JSON syntax.`)
          }
        } else if (data && typeof data === 'object') {
          parsedData = data
        }

        // Build connection config
        const connectionConfig = {
          host: rest.host,
          port: typeof rest.port === 'string' ? Number.parseInt(rest.port, 10) : rest.port || 5432,
          database: rest.database,
          username: rest.username,
          password: rest.password,
          ssl: rest.ssl || 'preferred',
        }

        // Build params object
        const result: any = { ...connectionConfig }

        if (rest.table) result.table = rest.table
        if (rest.query) result.query = rest.query
        if (rest.where) result.where = rest.where
        if (rest.schema) result.schema = rest.schema
        if (parsedData !== undefined) result.data = parsedData

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Database operation to perform' },
    host: { type: 'string', description: 'Database host' },
    port: { type: 'string', description: 'Database port' },
    database: { type: 'string', description: 'Database name' },
    username: { type: 'string', description: 'Database username' },
    password: { type: 'string', description: 'Database password' },
    ssl: { type: 'string', description: 'SSL mode' },
    table: { type: 'string', description: 'Table name' },
    query: { type: 'string', description: 'SQL query to execute' },
    data: { type: 'json', description: 'Data for insert/update operations' },
    where: { type: 'string', description: 'WHERE clause for update/delete' },
    schema: { type: 'string', description: 'Schema name for introspection' },
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
    tables: {
      type: 'array',
      description: 'Array of table schemas with columns, keys, and indexes (introspect operation)',
    },
    schemas: {
      type: 'array',
      description: 'List of available schemas in the database (introspect operation)',
    },
  },
}

export const PostgreSQLBlockMeta = {
  tags: ['data-analytics'],
  url: 'https://www.postgresql.org',
  templates: [
    {
      icon: PostgresIcon,
      title: 'Ask Postgres in plain English',
      prompt:
        'Build a workflow that takes a natural-language question, has an agent turn it into a PostgreSQL SELECT query, runs it against the database, and returns the resulting rows as a readable answer.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'reporting'],
    },
    {
      icon: PostgresIcon,
      title: 'Postgres metrics digest to Slack',
      prompt:
        'Create a scheduled workflow that queries key business metrics from PostgreSQL each morning, has an agent summarize the numbers and notable changes, and posts the digest to a Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PostgresIcon,
      title: 'Document your Postgres schema',
      prompt:
        'Build a workflow that introspects a PostgreSQL schema to list its tables, columns, keys, and indexes, then has an agent write plain-English documentation describing what each table holds.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'documentation'],
    },
    {
      icon: PostgresIcon,
      title: 'Upsert records into Postgres',
      prompt:
        'Create a workflow that takes incoming records, checks PostgreSQL for an existing row by key, then inserts a new row or updates the existing one so the table stays in sync without duplicates.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'sync'],
    },
    {
      icon: PostgresIcon,
      title: 'Nightly Postgres data cleanup',
      prompt:
        'Build a scheduled workflow that deletes rows in PostgreSQL older than a retention cutoff and reports how many rows were removed, so tables stay lean on an interval.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'automation'],
    },
    {
      icon: PostgresIcon,
      title: 'Postgres results to Sim table',
      prompt:
        'Create a scheduled workflow that runs a PostgreSQL query for the latest records and writes each row into a Sim table, so the data is available for downstream blocks without a live database call.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['database', 'sync'],
    },
    {
      icon: PostgresIcon,
      title: 'Postgres threshold breach alert',
      prompt:
        'Build a scheduled workflow that queries a PostgreSQL count or aggregate, compares it to a threshold, and posts a Slack alert only when the value crosses the limit so the team hears about problems early.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PostgresIcon,
      title: 'Log form submissions to Postgres',
      prompt:
        'Create a workflow that takes an incoming payload, validates the fields, and inserts a new row into a PostgreSQL table so every submission is durably recorded.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['database', 'automation'],
    },
  ],
  skills: [
    {
      name: 'query-to-answer',
      description: 'Turn a natural-language question into a PostgreSQL SELECT and return the rows.',
      content:
        '# Query To Answer\n\nAnswer a question by generating and running a PostgreSQL SELECT.\n\n## Steps\n1. Introspect the relevant schema first so the agent knows the real table and column names.\n2. Have the agent write a single SELECT with an explicit LIMIT for large result sets.\n3. Run the query and inspect rows and rowCount.\n4. Summarize the rows back to the caller in plain language.\n\n## Output\nReturn the answer text, the underlying rows, and the rowCount.',
    },
    {
      name: 'upsert-records',
      description: 'Insert new rows or update existing ones by key so a table stays deduplicated.',
      content:
        "# Upsert Records\n\nKeep a table in sync by inserting new rows or updating existing ones on a key.\n\n## Preferred: atomic upsert with execute\nUse the execute operation to run a single `INSERT ... ON CONFLICT ... DO UPDATE`, which is atomic and avoids the race between a separate read and write. This requires a unique or primary-key constraint on the conflict target.\n\n```sql\nINSERT INTO users (id, name, email)\nVALUES ('u1', 'Jane', 'jane@example.com')\nON CONFLICT (id)\nDO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email;\n```\n\n`EXCLUDED` refers to the row proposed for insertion, so `DO UPDATE SET col = EXCLUDED.col` applies the incoming values.\n\n## Fallback: read then write\nIf the key has no unique constraint, query the table for an existing row by key, then run insert when none exists or update with a WHERE condition on the key when one does.\n\n## Steps\n1. Ensure the conflict target has a unique or primary-key constraint.\n2. Run execute with `INSERT ... ON CONFLICT (key) DO UPDATE SET ... = EXCLUDED. ...` for each record.\n3. Inspect rowCount to confirm the write landed.\n\n## Output\nReport how many records were upserted and the total rowCount changed.",
    },
    {
      name: 'document-schema',
      description: 'Introspect a schema and produce plain-English documentation of its tables.',
      content:
        '# Document Schema\n\nDescribe a PostgreSQL schema in readable terms.\n\n## Steps\n1. Run introspect on the target schema to get tables, columns, keys, and indexes.\n2. Have an agent describe what each table stores and how they relate via foreign keys.\n3. Note primary keys and indexes that hint at common access patterns.\n4. Assemble the descriptions into a single document.\n\n## Output\nReturn the list of tables with a short description of each and the raw introspection result.',
    },
    {
      name: 'retention-cleanup',
      description: 'Delete rows older than a retention cutoff and report the count removed.',
      content:
        '# Retention Cleanup\n\nRemove stale rows on a schedule.\n\n## Steps\n1. Compute the retention cutoff timestamp for the run.\n2. Optionally query a count of rows older than the cutoff to preview the impact.\n3. Run delete with a WHERE condition comparing the timestamp column to the cutoff.\n4. Capture the rowCount removed for the run.\n\n## Output\nReport how many rows were deleted and the cutoff that was applied.',
    },
  ],
} as const satisfies BlockMeta
