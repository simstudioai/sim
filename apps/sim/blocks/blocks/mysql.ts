import { ClipboardList, Database, Search, Server, Table, Wrench } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { MySQLIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { MySQLResponse } from '@/tools/mysql/types'

export const MySQLBlock: BlockConfig<MySQLResponse> = {
  type: 'mysql',
  name: 'MySQL',
  description: 'Connect to MySQL database',
  longDescription:
    'Integrate MySQL into the workflow. Can query, insert, update, delete, and execute raw SQL.',
  docsLink: 'https://docs.sim.ai/integrations/mysql',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#FFFFFF',
  icon: MySQLIcon,
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
      placeholder: '3306',
      value: () => '3306',
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
      placeholder: 'root',
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
        prompt: `You are an expert MySQL database developer. Write MySQL SQL queries based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query.

### QUERY GUIDELINES
1. **Syntax**: Use MySQL-specific syntax and functions
2. **Performance**: Write efficient queries with proper indexing considerations
3. **Security**: Use parameterized queries when applicable
4. **Readability**: Format queries with proper indentation and spacing
5. **Best Practices**: Follow MySQL naming conventions

### MYSQL FEATURES
- Use MySQL-specific functions (IFNULL, DATE_FORMAT, CONCAT, etc.)
- Leverage MySQL features like GROUP_CONCAT, AUTO_INCREMENT
- Use proper MySQL data types (VARCHAR, DATETIME, DECIMAL, JSON, etc.)
- Include appropriate LIMIT clauses for large result sets

### EXAMPLES

**Simple Select**: "Get all active users"
→ SELECT id, name, email, created_at 
  FROM users 
  WHERE active = 1 
  ORDER BY created_at DESC;

**Complex Join**: "Get users with their order counts and total spent"
→ SELECT 
      u.id,
      u.name,
      u.email,
      COUNT(o.id) as order_count,
      IFNULL(SUM(o.total), 0) as total_spent
  FROM users u
  LEFT JOIN orders o ON u.id = o.user_id
  WHERE u.active = 1
  GROUP BY u.id, u.name, u.email
  HAVING COUNT(o.id) > 0
  ORDER BY total_spent DESC;

**With Subquery**: "Get top 10 products by sales"
→ SELECT 
      p.id,
      p.name,
      (SELECT SUM(oi.quantity * oi.price)
       FROM order_items oi 
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.product_id = p.id 
       AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      ) as total_sales
  FROM products p
  WHERE p.active = 1
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
        prompt: `You are an expert MySQL database developer. Write MySQL SQL queries based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query.

### QUERY GUIDELINES
1. **Syntax**: Use MySQL-specific syntax and functions
2. **Performance**: Write efficient queries with proper indexing considerations
3. **Security**: Use parameterized queries when applicable
4. **Readability**: Format queries with proper indentation and spacing
5. **Best Practices**: Follow MySQL naming conventions

### MYSQL FEATURES
- Use MySQL-specific functions (IFNULL, DATE_FORMAT, CONCAT, etc.)
- Leverage MySQL features like GROUP_CONCAT, AUTO_INCREMENT
- Use proper MySQL data types (VARCHAR, DATETIME, DECIMAL, JSON, etc.)
- Include appropriate LIMIT clauses for large result sets

### EXAMPLES

**Simple Select**: "Get all active users"
→ SELECT id, name, email, created_at 
  FROM users 
  WHERE active = 1 
  ORDER BY created_at DESC;

**Complex Join**: "Get users with their order counts and total spent"
→ SELECT 
      u.id,
      u.name,
      u.email,
      COUNT(o.id) as order_count,
      IFNULL(SUM(o.total), 0) as total_spent
  FROM users u
  LEFT JOIN orders o ON u.id = o.user_id
  WHERE u.active = 1
  GROUP BY u.id, u.name, u.email
  HAVING COUNT(o.id) > 0
  ORDER BY total_spent DESC;

**With Subquery**: "Get top 10 products by sales"
→ SELECT 
      p.id,
      p.name,
      (SELECT SUM(oi.quantity * oi.price)
       FROM order_items oi 
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.product_id = p.id 
       AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      ) as total_sales
  FROM products p
  WHERE p.active = 1
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
  ],
  tools: {
    access: [
      'mysql_query',
      'mysql_insert',
      'mysql_update',
      'mysql_delete',
      'mysql_execute',
      'mysql_introspect',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'mysql_query'
          case 'insert':
            return 'mysql_insert'
          case 'update':
            return 'mysql_update'
          case 'delete':
            return 'mysql_delete'
          case 'execute':
            return 'mysql_execute'
          case 'introspect':
            return 'mysql_introspect'
          default:
            throw new Error(`Invalid MySQL operation: ${params.operation}`)
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
          port: typeof rest.port === 'string' ? Number.parseInt(rest.port, 10) : rest.port || 3306,
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

export const MySQLBlockMeta = {
  tags: ['data-analytics'],
  url: 'https://www.mysql.com',
  templates: [
    {
      icon: Search,
      title: 'Ask your MySQL database in plain English',
      prompt:
        'Build a workflow that takes a plain-English question, has an agent translate it into a MySQL SELECT against the known schema, runs the query, and returns the rows as a readable answer.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'database'],
    },
    {
      icon: ClipboardList,
      title: 'Daily MySQL metrics report to Slack',
      prompt:
        'Create a scheduled workflow that runs a MySQL query for yesterday’s key metrics, has an agent summarize the rows into a short update, and posts the digest to a Slack channel every morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analytics'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Table,
      title: 'Document a MySQL schema',
      prompt:
        'Build a workflow that introspects a MySQL database schema, has an agent write plain-English descriptions of each table and column, and saves the generated data dictionary as a file.',
      modules: ['files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'documentation'],
    },
    {
      icon: Database,
      title: 'Sync records from a Sim table into MySQL',
      prompt:
        'Create a workflow that reads rows from a Sim table and upserts each one into a MySQL table — updating the row when a matching key exists and inserting it otherwise — so the two stay in sync.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'database'],
    },
    {
      icon: Search,
      title: 'Nightly MySQL data-quality audit',
      prompt:
        'Build a scheduled workflow that runs MySQL queries checking for nulls, duplicates, and orphaned foreign keys, has an agent describe any issues found, and alerts the team in Slack when the counts are non-zero.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['data-quality', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Wrench,
      title: 'Scheduled MySQL cleanup job',
      prompt:
        'Create a scheduled workflow that deletes stale or soft-deleted rows from a MySQL table older than a retention window, reports the row count removed, and keeps the table lean over time.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['maintenance', 'database'],
    },
    {
      icon: Database,
      title: 'Capture incoming records into MySQL',
      prompt:
        'Build a workflow that takes an incoming payload, validates the fields with an agent, and inserts a new row into the right MySQL table so submissions are persisted for later querying.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'database'],
    },
    {
      icon: Server,
      title: 'Export a MySQL query result to a file',
      prompt:
        'Create a scheduled workflow that runs a MySQL query for a snapshot of a table, writes the returned rows to a file, and keeps a dated export available for backups and downstream analysis.',
      modules: ['scheduled', 'files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['export', 'backup'],
    },
  ],
  skills: [
    {
      name: 'nl-to-sql-query',
      description: 'Translate a plain-English question into a MySQL SELECT and return the rows.',
      content:
        '# Natural Language To SQL\n\nTurn a question into a MySQL query and answer from the rows.\n\n## Steps\n1. Introspect the schema so the agent knows the tables and columns.\n2. Have the agent write a single MySQL SELECT that answers the question, with a LIMIT for safety.\n3. Run the query operation.\n4. Summarize the returned rows into a readable answer.\n\n## Output\nReturn the generated SQL, the rows, and a short natural-language summary of the result.',
    },
    {
      name: 'scheduled-sql-report',
      description: 'Run a MySQL query on a schedule and post a summarized report.',
      content:
        '# Scheduled SQL Report\n\nProduce a recurring report from MySQL data.\n\n## Steps\n1. Run a query for the reporting window (for example, DATE_SUB(NOW(), INTERVAL 1 DAY)).\n2. Read rowCount and rows to gather the metrics.\n3. Have an agent summarize the numbers into a short update.\n4. Deliver the summary to the target channel or file.\n\n## Output\nReport the key metrics, the row count, and the delivered summary.',
    },
    {
      name: 'document-schema',
      description: 'Introspect a MySQL schema and generate a plain-English data dictionary.',
      content:
        '# Document Schema\n\nGenerate documentation from a live MySQL schema.\n\n## Steps\n1. Run the introspect operation to list tables, columns, and types.\n2. Have an agent describe each table and column in plain English.\n3. Assemble the descriptions into a structured data dictionary.\n4. Save the result as a file for the team.\n\n## Output\nReturn the data dictionary covering every table and column, and confirm the saved file.',
    },
    {
      name: 'upsert-records',
      description: 'Insert new rows or update existing ones in MySQL based on a key match.',
      content:
        "# Upsert Records\n\nKeep a MySQL table in sync with a source of records.\n\n## Preferred: native MySQL upsert\nWhen the target table has a PRIMARY KEY or UNIQUE index on the match key, run a single execute with `INSERT ... ON DUPLICATE KEY UPDATE` — MySQL inserts a new row or updates the existing one in one statement (do NOT use Postgres `ON CONFLICT`, which MySQL does not support):\n\n```sql\nINSERT INTO users (id, name, email)\nVALUES (1, 'Jane', 'jane@example.com')\nON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email);\n```\n\n## Fallback: check-then-write\nIf there is no unique key to rely on:\n1. For each record, run a query to check whether a row with the matching key exists.\n2. If it exists, run update with a WHERE condition on the key.\n3. If it does not, run insert with the record data.\n4. Track how many rows were inserted versus updated.\n\n## Output\nReturn the counts of inserted and updated rows and confirm the table is in sync.",
    },
  ],
} as const satisfies BlockMeta
