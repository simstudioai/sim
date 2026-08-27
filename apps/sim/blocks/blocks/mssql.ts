import { getErrorMessage } from '@sim/utils/errors'
import { MicrosoftSqlIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { MSSQLResponse } from '@/tools/mssql/types'

const MSSQL_WAND_PROMPT = `You are an expert Microsoft SQL Server developer. Write T-SQL queries based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query.

### QUERY GUIDELINES
1. **Syntax**: Use Microsoft SQL Server (T-SQL) syntax and functions
2. **Performance**: Write efficient queries with proper indexing considerations
3. **Security**: Use parameterized queries when applicable
4. **Readability**: Format queries with proper indentation and spacing
5. **Best Practices**: Follow SQL Server naming conventions and bracket-quote identifiers when needed

### T-SQL FEATURES
- Use TOP (n) instead of LIMIT, and OFFSET ... FETCH NEXT for paging
- Use SQL Server functions (ISNULL, COALESCE, DATEADD, DATEDIFF, GETUTCDATE, FORMAT)
- Leverage CTEs, window functions, and MERGE where they fit
- Use proper SQL Server data types (NVARCHAR, DATETIME2, BIT, UNIQUEIDENTIFIER)

### EXAMPLES

**Simple Select**: "Get all active users"
→ SELECT TOP (100) id, name, email, created_at
  FROM dbo.users
  WHERE is_active = 1
  ORDER BY created_at DESC;

**Complex Join**: "Get users with their order counts and total spent"
→ SELECT
      u.id,
      u.name,
      u.email,
      COUNT(o.id) AS order_count,
      ISNULL(SUM(o.total), 0) AS total_spent
  FROM dbo.users u
  LEFT JOIN dbo.orders o ON u.id = o.user_id
  WHERE u.is_active = 1
  GROUP BY u.id, u.name, u.email
  HAVING COUNT(o.id) > 0
  ORDER BY total_spent DESC;

**With CTE**: "Get top 10 products by sales in the last 30 days"
→ WITH product_sales AS (
      SELECT
          p.id,
          p.name,
          SUM(oi.quantity * oi.price) AS total_sales
      FROM dbo.products p
      JOIN dbo.order_items oi ON p.id = oi.product_id
      JOIN dbo.orders o ON oi.order_id = o.id
      WHERE o.created_at >= DATEADD(day, -30, GETUTCDATE())
      GROUP BY p.id, p.name
  )
  SELECT TOP (10) *
  FROM product_sales
  ORDER BY total_sales DESC;

### REMEMBER
Return ONLY the SQL query - no explanations, no markdown, no extra text.`

export const MSSQLBlock: BlockConfig<MSSQLResponse> = {
  type: 'mssql',
  name: 'Microsoft SQL Server',
  description: 'Connect to Microsoft SQL Server database',
  longDescription:
    'Integrate Microsoft SQL Server into the workflow. Can query, insert, update, delete, execute raw T-SQL, and introspect schemas.',
  docsLink: 'https://docs.sim.ai/integrations/mssql',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#FFFFFF',
  icon: MicrosoftSqlIcon,
  canvasPresentation: {
    defaultTitle: 'Microsoft SQL Server',
    sentences: {
      byOperation: {
        query: [
          { text: 'Run SELECT query', field: 'query', core: true },
          { text: 'on', field: 'database' },
        ],
        insert: [
          { text: 'Insert', field: 'data', core: true },
          { text: 'into', field: 'table', core: true },
        ],
        update: [
          { text: 'Update rows in', field: 'table', core: true },
          { text: ', where', field: 'where' },
          { text: ', setting', field: 'data' },
        ],
        delete: [
          { text: 'Delete rows from', field: 'table', core: true },
          { text: ', where', field: 'where' },
        ],
        execute: [
          { text: 'Execute raw T-SQL', field: 'query', core: true },
          { text: 'on', field: 'database' },
        ],
        introspect: [
          { text: 'Read the schema of', field: 'database', core: true },
          { text: ', under', field: 'schema' },
        ],
      },
    },
  },
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
      placeholder: 'your.database.host',
      required: true,
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      placeholder: '1433',
      value: () => '1433',
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
      placeholder: 'sa',
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
      id: 'encrypt',
      title: 'Encrypt Connection',
      type: 'dropdown',
      options: [
        { label: 'Enabled', id: 'enabled' },
        { label: 'Disabled', id: 'disabled' },
      ],
      value: () => 'enabled',
    },
    {
      id: 'trustServerCertificate',
      title: 'Trust Server Certificate',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Disabled', id: 'disabled' },
        { label: 'Enabled', id: 'enabled' },
      ],
      value: () => 'disabled',
    },
    {
      id: 'connectionTimeout',
      title: 'Timeout (ms)',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '15000',
    },
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
    {
      id: 'query',
      title: 'SQL Query',
      type: 'code',
      placeholder: 'SELECT TOP (100) * FROM dbo.users WHERE is_active = 1',
      condition: { field: 'operation', value: 'query' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: MSSQL_WAND_PROMPT,
        placeholder: 'Describe the SQL query you need...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'query',
      title: 'SQL Query',
      type: 'code',
      placeholder: 'SELECT * FROM dbo.table_name',
      condition: { field: 'operation', value: 'execute' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: MSSQL_WAND_PROMPT,
        placeholder: 'Describe the SQL query you need...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'data',
      title: 'Data (JSON)',
      canvasNoun: 'a row',
      type: 'code',
      placeholder: '{\n  "name": "John Doe",\n  "email": "john@example.com",\n  "is_active": 1\n}',
      condition: { field: 'operation', value: 'insert' },
      required: true,
    },
    {
      id: 'data',
      title: 'Update Data (JSON)',
      type: 'code',
      placeholder: '{\n  "name": "Jane Doe",\n  "email": "jane@example.com"\n}',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
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
      placeholder: 'dbo',
      value: () => 'dbo',
      condition: { field: 'operation', value: 'introspect' },
    },
  ],
  tools: {
    access: [
      'mssql_query',
      'mssql_insert',
      'mssql_update',
      'mssql_delete',
      'mssql_execute',
      'mssql_introspect',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'mssql_query'
          case 'insert':
            return 'mssql_insert'
          case 'update':
            return 'mssql_update'
          case 'delete':
            return 'mssql_delete'
          case 'execute':
            return 'mssql_execute'
          case 'introspect':
            return 'mssql_introspect'
          default:
            throw new Error(`Invalid Microsoft SQL Server operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, data, ...rest } = params

        let parsedData: Record<string, unknown> | undefined
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

        const result: Record<string, unknown> = {
          host: rest.host,
          port: typeof rest.port === 'string' ? Number.parseInt(rest.port, 10) : rest.port || 1433,
          database: rest.database,
          username: rest.username,
          password: rest.password,
          encrypt: rest.encrypt || 'enabled',
          trustServerCertificate: rest.trustServerCertificate || 'disabled',
        }

        if (rest.connectionTimeout) {
          result.connectionTimeout =
            typeof rest.connectionTimeout === 'string'
              ? Number.parseInt(rest.connectionTimeout, 10)
              : rest.connectionTimeout
        }
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
    encrypt: { type: 'string', description: 'Encrypt the connection with TLS' },
    trustServerCertificate: {
      type: 'string',
      description: 'Trust a self-signed server certificate',
    },
    connectionTimeout: {
      type: 'string',
      description: 'Connection and request timeout in milliseconds',
    },
    table: { type: 'string', description: 'Table name' },
    query: { type: 'string', description: 'T-SQL query to execute' },
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
      description: 'Number of rows returned or affected by the operation',
    },
    tables: {
      type: 'array',
      description: 'Array of table schemas with columns, keys, and indexes (introspect operation)',
    },
    schemas: {
      type: 'array',
      description: 'List of available schemas in the database (introspect operation)',
    },
    truncated: {
      type: 'boolean',
      description: 'True when the result hit a row or byte ceiling and rows were dropped',
    },
    truncationReason: {
      type: 'string',
      description: 'Explanation of the ceiling that truncated the result',
    },
  },
}

export const MSSQLBlockMeta = {
  tags: ['data-analytics'],
  url: 'https://www.microsoft.com/en-us/sql-server',
  templates: [
    {
      icon: MicrosoftSqlIcon,
      title: 'Ask SQL Server in plain English',
      prompt:
        'Build a workflow that takes a natural-language question, has an agent turn it into a T-SQL SELECT, runs it against Microsoft SQL Server, and returns the resulting rows as a readable answer.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'reporting'],
    },
    {
      icon: MicrosoftSqlIcon,
      title: 'SQL Server metrics digest to Slack',
      prompt:
        'Create a scheduled workflow that queries key business metrics from Microsoft SQL Server each morning, has an agent summarize the numbers and notable changes, and posts the digest to a Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MicrosoftSqlIcon,
      title: 'Document your SQL Server schema',
      prompt:
        'Build a workflow that introspects a Microsoft SQL Server schema to list its tables, columns, keys, and indexes, then has an agent write plain-English documentation describing what each table holds.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'documentation'],
    },
    {
      icon: MicrosoftSqlIcon,
      title: 'Merge records into SQL Server',
      prompt:
        'Create a workflow that takes incoming records and runs a T-SQL MERGE against Microsoft SQL Server so each row is inserted when new and updated when it already exists, keeping the table free of duplicates.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'sync'],
    },
    {
      icon: MicrosoftSqlIcon,
      title: 'Nightly SQL Server data cleanup',
      prompt:
        'Build a scheduled workflow that deletes rows in Microsoft SQL Server older than a retention cutoff and reports how many rows were removed, so tables stay lean on an interval.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'automation'],
    },
    {
      icon: MicrosoftSqlIcon,
      title: 'SQL Server results to Sim table',
      prompt:
        'Create a scheduled workflow that runs a Microsoft SQL Server query for the latest records and writes each row into a Sim table, so the data is available for downstream blocks without a live database call.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['database', 'sync'],
    },
    {
      icon: MicrosoftSqlIcon,
      title: 'SQL Server threshold breach alert',
      prompt:
        'Build a scheduled workflow that queries a Microsoft SQL Server count or aggregate, compares it to a threshold, and posts a Slack alert only when the value crosses the limit so the team hears about problems early.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MicrosoftSqlIcon,
      title: 'Log form submissions to SQL Server',
      prompt:
        'Create a workflow that takes an incoming payload, validates the fields, and inserts a new row into a Microsoft SQL Server table so every submission is durably recorded.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['database', 'automation'],
    },
  ],
  skills: [
    {
      name: 'query-to-answer',
      description: 'Turn a natural-language question into a T-SQL SELECT and return the rows.',
      content:
        '# Query To Answer\n\nAnswer a question by generating and running a T-SQL SELECT.\n\n## Steps\n1. Introspect the relevant schema first so the agent knows the real table and column names.\n2. Have the agent write a single SELECT, using TOP (n) to bound large result sets.\n3. Run the query and inspect rows and rowCount.\n4. Summarize the rows back to the caller in plain language.\n\n## Output\nReturn the answer text, the underlying rows, and the rowCount.',
    },
    {
      name: 'merge-records',
      description: 'Insert new rows or update existing ones by key so a table stays deduplicated.',
      content:
        "# Merge Records\n\nKeep a table in sync by inserting new rows or updating existing ones on a key.\n\n## Preferred: atomic MERGE with execute\nUse the execute operation to run a single T-SQL `MERGE`, which resolves the match and the write in one statement.\n\n```sql\nMERGE dbo.users AS target\nUSING (SELECT 'u1' AS id, 'Jane' AS name, 'jane@example.com' AS email) AS source\nON target.id = source.id\nWHEN MATCHED THEN UPDATE SET name = source.name, email = source.email\nWHEN NOT MATCHED THEN INSERT (id, name, email) VALUES (source.id, source.name, source.email);\n```\n\nAlways terminate a MERGE statement with a semicolon — SQL Server requires it.\n\n## Fallback: read then write\nIf MERGE is unavailable, query the table for an existing row by key, then run insert when none exists or update with a WHERE condition on the key when one does.\n\n## Steps\n1. Confirm the match key is unique.\n2. Run execute with the MERGE statement for each record.\n3. Inspect rowCount to confirm the write landed.\n\n## Output\nReport how many records were merged and the total rowCount changed.",
    },
    {
      name: 'document-schema',
      description: 'Introspect a schema and produce plain-English documentation of its tables.',
      content:
        '# Document Schema\n\nDescribe a Microsoft SQL Server schema in readable terms.\n\n## Steps\n1. Run introspect on the target schema (default dbo) to get tables, columns, keys, and indexes.\n2. Have an agent describe what each table stores and how they relate via foreign keys.\n3. Note primary keys and indexes that hint at common access patterns.\n4. Assemble the descriptions into a single document.\n\n## Output\nReturn the list of tables with a short description of each and the raw introspection result.',
    },
    {
      name: 'retention-cleanup',
      description: 'Delete rows older than a retention cutoff and report the count removed.',
      content:
        '# Retention Cleanup\n\nRemove stale rows on a schedule.\n\n## Steps\n1. Compute the retention cutoff timestamp for the run.\n2. Optionally query a count of rows older than the cutoff to preview the impact.\n3. Run delete with a WHERE condition comparing the timestamp column to the cutoff.\n4. Capture the rowCount removed for the run.\n\n## Output\nReport how many rows were deleted and the cutoff that was applied.',
    },
  ],
} as const satisfies BlockMeta
