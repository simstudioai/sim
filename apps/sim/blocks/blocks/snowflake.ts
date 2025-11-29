import { SnowflakeIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { SnowflakeResponse } from '@/tools/snowflake/types'

export const SnowflakeBlock: BlockConfig<SnowflakeResponse> = {
  type: 'snowflake',
  name: 'Snowflake',
  description: 'Execute queries on Snowflake data warehouse',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Snowflake into your workflow. Execute SQL queries, insert, update, and delete rows, list databases, schemas, and tables, and describe table structures in your Snowflake data warehouse.',
  docsLink: 'https://docs.sim.ai/tools/snowflake',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: SnowflakeIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Execute Query', id: 'execute_query' },
        { label: 'Insert Rows', id: 'insert_rows' },
        { label: 'Update Rows', id: 'update_rows' },
        { label: 'Delete Rows', id: 'delete_rows' },
        { label: 'List Databases', id: 'list_databases' },
        { label: 'List Schemas', id: 'list_schemas' },
        { label: 'List Tables', id: 'list_tables' },
        { label: 'List Views', id: 'list_views' },
        { label: 'List Warehouses', id: 'list_warehouses' },
        { label: 'List File Formats', id: 'list_file_formats' },
        { label: 'List Stages', id: 'list_stages' },
        { label: 'Describe Table', id: 'describe_table' },
      ],
      value: () => 'execute_query',
    },
    {
      id: 'credential',
      title: 'Snowflake Account',
      type: 'oauth-input',
      provider: 'snowflake',
      serviceId: 'snowflake',
      requiredScopes: [],
      placeholder: 'Select Snowflake account',
      required: true,
    },
    {
      id: 'accountUrl',
      title: 'Account URL',
      type: 'short-input',
      placeholder: 'your-account.snowflakecomputing.com',
      required: true,
    },
    {
      id: 'warehouse',
      title: 'Warehouse',
      type: 'short-input',
      placeholder: 'Warehouse name',
    },
    {
      id: 'role',
      title: 'Role',
      type: 'short-input',
      placeholder: 'Role name',
    },
    {
      id: 'query',
      title: 'SQL Query',
      type: 'long-input',
      required: true,
      placeholder: 'Enter SQL query (e.g., SELECT * FROM database.schema.table LIMIT 10)',
      condition: {
        field: 'operation',
        value: 'execute_query',
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert Snowflake SQL developer. Generate Snowflake SQL queries based on the user's natural language request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query that can be executed directly in Snowflake.

### SNOWFLAKE SQL GUIDELINES
1. **Syntax**: Use standard Snowflake SQL syntax and functions
2. **Fully Qualified Names**: Use database.schema.table format when possible
3. **Case Sensitivity**: Identifiers are case-insensitive unless quoted
4. **Performance**: Consider using LIMIT clauses for large datasets
5. **Data Types**: Use appropriate Snowflake data types (VARIANT for JSON, TIMESTAMP_NTZ, etc.)

### COMMON SNOWFLAKE SQL PATTERNS

**Basic SELECT**:
SELECT * FROM database.schema.table LIMIT 100;

**Filtered Query**:
SELECT column1, column2 
FROM database.schema.table 
WHERE status = 'active' 
  AND created_at > DATEADD(day, -7, CURRENT_DATE())
LIMIT 100;

**Aggregate Functions**:
SELECT 
  category,
  COUNT(*) as total_count,
  AVG(amount) as avg_amount,
  SUM(amount) as total_amount
FROM database.schema.sales
GROUP BY category
ORDER BY total_amount DESC;

**JOIN Operations**:
SELECT 
  u.user_id,
  u.name,
  o.order_id,
  o.total
FROM database.schema.users u
INNER JOIN database.schema.orders o 
  ON u.user_id = o.user_id
WHERE o.created_at > CURRENT_DATE() - 30;

**Window Functions**:
SELECT 
  user_id,
  order_date,
  amount,
  ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY order_date DESC) as row_num
FROM database.schema.orders;

**JSON/VARIANT Queries**:
SELECT 
  id,
  json_data:field::STRING as field_value,
  json_data:nested.value::NUMBER as nested_value
FROM database.schema.json_table
WHERE json_data:status::STRING = 'active';

**FLATTEN for Arrays**:
SELECT 
  id,
  f.value::STRING as array_item
FROM database.schema.table,
LATERAL FLATTEN(input => array_column) f;

**CTE (Common Table Expression)**:
WITH active_users AS (
  SELECT user_id, name
  FROM database.schema.users
  WHERE status = 'active'
)
SELECT 
  au.name,
  COUNT(o.order_id) as order_count
FROM active_users au
LEFT JOIN database.schema.orders o ON au.user_id = o.user_id
GROUP BY au.name;

**Date/Time Functions**:
SELECT 
  DATE_TRUNC('month', order_date) as month,
  COUNT(*) as orders
FROM database.schema.orders
WHERE order_date >= DATEADD(year, -1, CURRENT_DATE())
GROUP BY month
ORDER BY month DESC;

**INSERT Statement**:
INSERT INTO database.schema.table (column1, column2, column3)
VALUES ('value1', 123, CURRENT_TIMESTAMP());

**UPDATE Statement**:
UPDATE database.schema.table
SET status = 'processed', updated_at = CURRENT_TIMESTAMP()
WHERE id = 123;

**DELETE Statement**:
DELETE FROM database.schema.table
WHERE created_at < DATEADD(year, -2, CURRENT_DATE());

**MERGE Statement (Upsert)**:
MERGE INTO database.schema.target t
USING database.schema.source s
ON t.id = s.id
WHEN MATCHED THEN
  UPDATE SET t.value = s.value, t.updated_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN
  INSERT (id, value, created_at) VALUES (s.id, s.value, CURRENT_TIMESTAMP());

### SNOWFLAKE SPECIFIC FEATURES

**SAMPLE Clause** (for testing with large tables):
SELECT * FROM database.schema.large_table SAMPLE (1000 ROWS);

**QUALIFY Clause** (filter window functions):
SELECT 
  user_id,
  order_date,
  amount
FROM database.schema.orders
QUALIFY ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY order_date DESC) = 1;

**Time Travel**:
SELECT * FROM database.schema.table AT (TIMESTAMP => '2024-01-01 00:00:00'::TIMESTAMP);

### BEST PRACTICES
1. Always use LIMIT when exploring data
2. Use WHERE clauses to filter data efficiently
3. Index commonly queried columns
4. Use appropriate date functions (DATEADD, DATE_TRUNC, DATEDIFF)
5. For JSON data, use proper casting (::STRING, ::NUMBER, etc.)
6. Use CTEs for complex queries to improve readability

### REMEMBER
Return ONLY the SQL query - no explanations, no markdown code blocks, no extra text. The query should be ready to execute.`,
        placeholder:
          'Describe the SQL query you need (e.g., "Get all orders from the last 7 days with customer names")...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'database',
      title: 'Database',
      type: 'short-input',
      placeholder: 'Database name',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'list_schemas',
          'list_tables',
          'list_views',
          'list_file_formats',
          'list_stages',
          'describe_table',
          'insert_rows',
          'update_rows',
          'delete_rows',
        ],
      },
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'short-input',
      placeholder: 'Schema name',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'list_tables',
          'list_views',
          'list_file_formats',
          'list_stages',
          'describe_table',
          'insert_rows',
          'update_rows',
          'delete_rows',
        ],
      },
    },
    {
      id: 'table',
      title: 'Table',
      type: 'short-input',
      placeholder: 'Table name',
      required: true,
      condition: {
        field: 'operation',
        value: ['describe_table', 'insert_rows', 'update_rows', 'delete_rows'],
      },
    },
    {
      id: 'columns',
      title: 'Columns',
      type: 'long-input',
      placeholder: '["column1", "column2", "column3"]',
      required: true,
      condition: {
        field: 'operation',
        value: 'insert_rows',
      },
    },
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      placeholder: '[["value1", "value2", "value3"], ["value4", "value5", "value6"]]',
      required: true,
      condition: {
        field: 'operation',
        value: 'insert_rows',
      },
    },
    {
      id: 'updates',
      title: 'Updates',
      type: 'long-input',
      placeholder: '{"column1": "new_value", "column2": 123, "updated_at": "2024-01-01"}',
      required: true,
      condition: {
        field: 'operation',
        value: 'update_rows',
      },
    },
    {
      id: 'whereClause',
      title: 'WHERE Clause',
      type: 'long-input',
      placeholder: 'id = 123 (leave empty to update/delete ALL rows)',
      required: false,
      condition: {
        field: 'operation',
        value: ['update_rows', 'delete_rows'],
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'short-input',
      placeholder: '60',
      condition: {
        field: 'operation',
        value: 'execute_query',
      },
    },
  ],
  tools: {
    access: [
      'snowflake_execute_query',
      'snowflake_insert_rows',
      'snowflake_update_rows',
      'snowflake_delete_rows',
      'snowflake_list_databases',
      'snowflake_list_schemas',
      'snowflake_list_tables',
      'snowflake_list_views',
      'snowflake_list_warehouses',
      'snowflake_list_file_formats',
      'snowflake_list_stages',
      'snowflake_describe_table',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'execute_query':
            return 'snowflake_execute_query'
          case 'insert_rows':
            return 'snowflake_insert_rows'
          case 'update_rows':
            return 'snowflake_update_rows'
          case 'delete_rows':
            return 'snowflake_delete_rows'
          case 'list_databases':
            return 'snowflake_list_databases'
          case 'list_schemas':
            return 'snowflake_list_schemas'
          case 'list_tables':
            return 'snowflake_list_tables'
          case 'list_views':
            return 'snowflake_list_views'
          case 'list_warehouses':
            return 'snowflake_list_warehouses'
          case 'list_file_formats':
            return 'snowflake_list_file_formats'
          case 'list_stages':
            return 'snowflake_list_stages'
          case 'describe_table':
            return 'snowflake_describe_table'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, operation, ...rest } = params

        // Build base params
        const baseParams: Record<string, any> = {
          credential,
          accountUrl: params.accountUrl,
        }

        // Add optional warehouse and role if provided
        if (params.warehouse) {
          baseParams.warehouse = params.warehouse
        }

        if (params.role) {
          baseParams.role = params.role
        }

        // Operation-specific params
        switch (operation) {
          case 'execute_query': {
            if (!params.query) {
              throw new Error('Query is required for execute_query operation')
            }
            baseParams.query = params.query
            if (params.database) baseParams.database = params.database
            if (params.schema) baseParams.schema = params.schema
            if (params.timeout) baseParams.timeout = Number.parseInt(params.timeout)
            break
          }

          case 'list_databases': {
            // No additional params needed
            break
          }

          case 'list_schemas': {
            if (!params.database) {
              throw new Error('Database is required for list_schemas operation')
            }
            baseParams.database = params.database
            break
          }

          case 'list_tables': {
            if (!params.database || !params.schema) {
              throw new Error('Database and Schema are required for list_tables operation')
            }
            baseParams.database = params.database
            baseParams.schema = params.schema
            break
          }

          case 'list_views': {
            if (!params.database || !params.schema) {
              throw new Error('Database and Schema are required for list_views operation')
            }
            baseParams.database = params.database
            baseParams.schema = params.schema
            break
          }

          case 'list_warehouses': {
            // No additional params needed
            break
          }

          case 'list_file_formats': {
            if (!params.database || !params.schema) {
              throw new Error('Database and Schema are required for list_file_formats operation')
            }
            baseParams.database = params.database
            baseParams.schema = params.schema
            break
          }

          case 'list_stages': {
            if (!params.database || !params.schema) {
              throw new Error('Database and Schema are required for list_stages operation')
            }
            baseParams.database = params.database
            baseParams.schema = params.schema
            break
          }

          case 'describe_table': {
            if (!params.database || !params.schema || !params.table) {
              throw new Error(
                'Database, Schema, and Table are required for describe_table operation'
              )
            }
            baseParams.database = params.database
            baseParams.schema = params.schema
            baseParams.table = params.table
            break
          }

          case 'insert_rows': {
            if (!params.database || !params.schema || !params.table) {
              throw new Error('Database, Schema, and Table are required for insert_rows operation')
            }
            if (!params.columns || !params.values) {
              throw new Error('Columns and Values are required for insert_rows operation')
            }

            // Parse columns and values if they are strings
            let columns = params.columns
            let values = params.values

            if (typeof columns === 'string') {
              try {
                columns = JSON.parse(columns)
              } catch (e) {
                throw new Error('Columns must be a valid JSON array')
              }
            }

            if (typeof values === 'string') {
              try {
                values = JSON.parse(values)
              } catch (e) {
                throw new Error('Values must be a valid JSON array of arrays')
              }
            }

            baseParams.database = params.database
            baseParams.schema = params.schema
            baseParams.table = params.table
            baseParams.columns = columns
            baseParams.values = values
            if (params.timeout) baseParams.timeout = Number.parseInt(params.timeout)
            break
          }

          case 'update_rows': {
            if (!params.database || !params.schema || !params.table) {
              throw new Error('Database, Schema, and Table are required for update_rows operation')
            }
            if (!params.updates) {
              throw new Error('Updates object is required for update_rows operation')
            }

            // Parse updates if it's a string
            let updates = params.updates
            if (typeof updates === 'string') {
              try {
                updates = JSON.parse(updates)
              } catch (e) {
                throw new Error('Updates must be a valid JSON object')
              }
            }

            baseParams.database = params.database
            baseParams.schema = params.schema
            baseParams.table = params.table
            baseParams.updates = updates
            if (params.whereClause) baseParams.whereClause = params.whereClause
            if (params.timeout) baseParams.timeout = Number.parseInt(params.timeout)
            break
          }

          case 'delete_rows': {
            if (!params.database || !params.schema || !params.table) {
              throw new Error('Database, Schema, and Table are required for delete_rows operation')
            }

            baseParams.database = params.database
            baseParams.schema = params.schema
            baseParams.table = params.table
            if (params.whereClause) baseParams.whereClause = params.whereClause
            if (params.timeout) baseParams.timeout = Number.parseInt(params.timeout)
            break
          }

          default:
            throw new Error(`Unknown operation: ${operation}`)
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Snowflake OAuth credential' },
    accountUrl: {
      type: 'string',
      description: 'Snowflake account URL (e.g., xy12345.us-east-1.snowflakecomputing.com)',
    },
    warehouse: { type: 'string', description: 'Warehouse name' },
    role: { type: 'string', description: 'Role name' },
    query: { type: 'string', description: 'SQL query to execute' },
    database: { type: 'string', description: 'Database name' },
    schema: { type: 'string', description: 'Schema name' },
    table: { type: 'string', description: 'Table name' },
    columns: { type: 'json', description: 'Array of column names for insert operation' },
    values: { type: 'json', description: 'Array of arrays containing values for insert operation' },
    updates: {
      type: 'json',
      description: 'Object containing column-value pairs for update operation',
    },
    whereClause: { type: 'string', description: 'WHERE clause for update/delete operations' },
    timeout: { type: 'string', description: 'Query timeout in seconds' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'json',
      description:
        'Operation results containing query data, databases, schemas, tables, or column definitions based on the selected operation',
    },
  },
}
