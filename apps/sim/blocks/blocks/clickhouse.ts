import { getErrorMessage } from '@sim/utils/errors'
import { ClickHouseIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { ClickHouseResponse } from '@/tools/clickhouse/types'

const CLICKHOUSE_QUERY_PROMPT = `You are an expert ClickHouse database developer. Write ClickHouse SQL queries based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query.

### QUERY GUIDELINES
1. **Syntax**: Use ClickHouse-specific SQL syntax and functions
2. **Performance**: Filter on primary/sorting key columns and use PREWHERE where helpful
3. **Readability**: Format queries with proper indentation and spacing
4. **Best Practices**: Add a LIMIT clause for exploratory queries

### CLICKHOUSE FEATURES
- Use ClickHouse functions (toDateTime, toStartOfInterval, uniqExact, quantile, arrayJoin, etc.)
- Use ClickHouse data types (UInt64, Float64, String, DateTime, LowCardinality, etc.)
- Leverage aggregate combinators (-If, -Array, -State, -Merge) when appropriate

### EXAMPLES

**Simple Select**: "Get the 100 most recent events"
→ SELECT event_time, user_id, event_type
  FROM events
  ORDER BY event_time DESC
  LIMIT 100;

**Aggregation**: "Count unique users per day for the last 7 days"
→ SELECT
      toDate(event_time) AS day,
      uniqExact(user_id) AS unique_users
  FROM events
  WHERE event_time >= now() - INTERVAL 7 DAY
  GROUP BY day
  ORDER BY day;

### REMEMBER
Return ONLY the SQL query - no explanations, no markdown, no extra text.`

const TABLE_REQUIRED_OPERATIONS = [
  'insert',
  'insert_rows',
  'update',
  'delete',
  'describe_table',
  'show_create_table',
  'count_rows',
  'list_partitions',
  'create_table',
  'drop_table',
  'truncate_table',
  'rename_table',
  'optimize_table',
  'drop_partition',
]

export const ClickHouseBlock: BlockConfig<ClickHouseResponse> = {
  type: 'clickhouse',
  name: 'ClickHouse',
  description: 'Connect to a ClickHouse database',
  longDescription:
    'Integrate ClickHouse into the workflow. Query and insert data, manage databases and tables, inspect schemas, monitor mutations and running queries, manage partitions, and execute raw SQL over the ClickHouse HTTP interface.',
  docsLink: 'https://docs.sim.ai/tools/clickhouse',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  tags: ['data-warehouse', 'data-analytics'],
  bgColor: '#f9ff69',
  icon: ClickHouseIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Query (SELECT)', id: 'query' },
        { label: 'Execute Raw SQL', id: 'execute' },
        { label: 'Insert Row', id: 'insert' },
        { label: 'Insert Rows (Bulk)', id: 'insert_rows' },
        { label: 'Update Data', id: 'update' },
        { label: 'Delete Data', id: 'delete' },
        { label: 'List Databases', id: 'list_databases' },
        { label: 'List Tables', id: 'list_tables' },
        { label: 'Describe Table', id: 'describe_table' },
        { label: 'Show Create Table', id: 'show_create_table' },
        { label: 'Count Rows', id: 'count_rows' },
        { label: 'Introspect Schema', id: 'introspect' },
        { label: 'Create Database', id: 'create_database' },
        { label: 'Drop Database', id: 'drop_database' },
        { label: 'Create Table', id: 'create_table' },
        { label: 'Drop Table', id: 'drop_table' },
        { label: 'Truncate Table', id: 'truncate_table' },
        { label: 'Rename Table', id: 'rename_table' },
        { label: 'Optimize Table', id: 'optimize_table' },
        { label: 'List Partitions', id: 'list_partitions' },
        { label: 'Drop Partition', id: 'drop_partition' },
        { label: 'List Mutations', id: 'list_mutations' },
        { label: 'List Running Queries', id: 'list_running_queries' },
        { label: 'Kill Query', id: 'kill_query' },
        { label: 'Table Stats', id: 'table_stats' },
        { label: 'List Clusters', id: 'list_clusters' },
      ],
      value: () => 'query',
    },
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      placeholder: 'your-instance.clickhouse.cloud',
      required: true,
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      placeholder: '8443',
      value: () => '8443',
      required: true,
    },
    {
      id: 'database',
      title: 'Database Name',
      type: 'short-input',
      placeholder: 'default',
      value: () => 'default',
      required: true,
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'default',
      value: () => 'default',
      required: true,
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      password: true,
      placeholder: 'Your ClickHouse password',
    },
    {
      id: 'secure',
      title: 'Use HTTPS',
      type: 'switch',
      value: () => 'true',
    },
    {
      id: 'table',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'events',
      condition: { field: 'operation', value: TABLE_REQUIRED_OPERATIONS },
      required: { field: 'operation', value: TABLE_REQUIRED_OPERATIONS },
    },
    {
      id: 'table',
      title: 'Table Name (Optional)',
      type: 'short-input',
      placeholder: 'Leave blank for all tables',
      condition: { field: 'operation', value: ['list_mutations', 'table_stats'] },
    },
    {
      id: 'query',
      title: 'SQL Query',
      type: 'code',
      placeholder: 'SELECT * FROM events ORDER BY event_time DESC LIMIT 100',
      condition: { field: 'operation', value: 'query' },
      required: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: CLICKHOUSE_QUERY_PROMPT,
        placeholder: 'Describe the ClickHouse query you need...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'query',
      title: 'SQL Statement',
      type: 'code',
      placeholder: 'CREATE TABLE events (id UInt64, name String) ENGINE = MergeTree ORDER BY id',
      condition: { field: 'operation', value: 'execute' },
      required: { field: 'operation', value: 'execute' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: CLICKHOUSE_QUERY_PROMPT,
        placeholder: 'Describe the ClickHouse statement you need...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'data',
      title: 'Data (JSON)',
      type: 'code',
      placeholder: '{\n  "id": 1,\n  "name": "Example",\n  "created_at": "2024-01-01 00:00:00"\n}',
      condition: { field: 'operation', value: 'insert' },
      required: { field: 'operation', value: 'insert' },
    },
    {
      id: 'rows',
      title: 'Rows (JSON Array)',
      type: 'code',
      placeholder: '[\n  { "id": 1, "name": "A" },\n  { "id": 2, "name": "B" }\n]',
      condition: { field: 'operation', value: 'insert_rows' },
      required: { field: 'operation', value: 'insert_rows' },
    },
    {
      id: 'data',
      title: 'Update Data (JSON)',
      type: 'code',
      placeholder: '{\n  "name": "Updated name",\n  "status": "active"\n}',
      condition: { field: 'operation', value: 'update' },
      required: { field: 'operation', value: 'update' },
    },
    {
      id: 'where',
      title: 'WHERE Condition',
      type: 'short-input',
      placeholder: 'id = 1',
      condition: { field: 'operation', value: 'update' },
      required: { field: 'operation', value: 'update' },
    },
    {
      id: 'where',
      title: 'WHERE Condition',
      type: 'short-input',
      placeholder: 'id = 1',
      condition: { field: 'operation', value: 'delete' },
      required: { field: 'operation', value: 'delete' },
    },
    {
      id: 'where',
      title: 'WHERE Condition (Optional)',
      type: 'short-input',
      placeholder: "status = 'active'",
      condition: { field: 'operation', value: 'count_rows' },
    },
    {
      id: 'name',
      title: 'Database Name',
      type: 'short-input',
      placeholder: 'analytics',
      condition: { field: 'operation', value: ['create_database', 'drop_database'] },
      required: { field: 'operation', value: ['create_database', 'drop_database'] },
    },
    {
      id: 'columns',
      title: 'Columns (JSON Array)',
      type: 'code',
      placeholder:
        '[\n  { "name": "id", "type": "UInt64" },\n  { "name": "ts", "type": "DateTime" }\n]',
      condition: { field: 'operation', value: 'create_table' },
      required: { field: 'operation', value: 'create_table' },
    },
    {
      id: 'engine',
      title: 'Engine',
      type: 'short-input',
      placeholder: 'MergeTree',
      value: () => 'MergeTree',
      condition: { field: 'operation', value: 'create_table' },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'id or (id, ts)',
      condition: { field: 'operation', value: 'create_table' },
      required: { field: 'operation', value: 'create_table' },
    },
    {
      id: 'partitionBy',
      title: 'Partition By (Optional)',
      type: 'short-input',
      placeholder: 'toYYYYMM(ts)',
      condition: { field: 'operation', value: 'create_table' },
    },
    {
      id: 'newTable',
      title: 'New Table Name',
      type: 'short-input',
      placeholder: 'events_archive',
      condition: { field: 'operation', value: 'rename_table' },
      required: { field: 'operation', value: 'rename_table' },
    },
    {
      id: 'final',
      title: 'Force Final Merge',
      type: 'switch',
      condition: { field: 'operation', value: 'optimize_table' },
    },
    {
      id: 'partition',
      title: 'Partition',
      type: 'short-input',
      placeholder: "202401 or '2024-01'",
      condition: { field: 'operation', value: 'drop_partition' },
      required: { field: 'operation', value: 'drop_partition' },
    },
    {
      id: 'queryId',
      title: 'Query ID',
      type: 'short-input',
      placeholder: 'The query_id to kill',
      condition: { field: 'operation', value: 'kill_query' },
      required: { field: 'operation', value: 'kill_query' },
    },
    {
      id: 'onlyRunning',
      title: 'Only Running Mutations',
      type: 'switch',
      condition: { field: 'operation', value: 'list_mutations' },
    },
  ],
  tools: {
    access: [
      'clickhouse_query',
      'clickhouse_execute',
      'clickhouse_insert',
      'clickhouse_insert_rows',
      'clickhouse_update',
      'clickhouse_delete',
      'clickhouse_list_databases',
      'clickhouse_list_tables',
      'clickhouse_describe_table',
      'clickhouse_show_create_table',
      'clickhouse_count_rows',
      'clickhouse_introspect',
      'clickhouse_create_database',
      'clickhouse_drop_database',
      'clickhouse_create_table',
      'clickhouse_drop_table',
      'clickhouse_truncate_table',
      'clickhouse_rename_table',
      'clickhouse_optimize_table',
      'clickhouse_list_partitions',
      'clickhouse_drop_partition',
      'clickhouse_list_mutations',
      'clickhouse_list_running_queries',
      'clickhouse_kill_query',
      'clickhouse_table_stats',
      'clickhouse_list_clusters',
    ],
    config: {
      tool: (params) => {
        if (!params.operation) {
          throw new Error('Operation is required')
        }
        return `clickhouse_${params.operation}`
      },
      params: (params) => {
        const { operation, data, columns, rows, secure, ...rest } = params

        const parseJsonField = (value: unknown, label: string): unknown => {
          if (value && typeof value === 'string' && value.trim()) {
            try {
              return JSON.parse(value)
            } catch (parseError) {
              const errorMsg = getErrorMessage(parseError, 'Unknown JSON error')
              throw new Error(`Invalid JSON in ${label}: ${errorMsg}. Please check your syntax.`)
            }
          }
          if (value && typeof value === 'object') {
            return value
          }
          return undefined
        }

        const parsedData = parseJsonField(data, 'data')
        const parsedColumns = parseJsonField(columns, 'columns')
        const parsedRows = parseJsonField(rows, 'rows')

        const isSecure = secure !== false && secure !== 'false'

        const result: Record<string, unknown> = {
          host: rest.host,
          port: typeof rest.port === 'string' ? Number.parseInt(rest.port, 10) : rest.port || 8443,
          database: rest.database || 'default',
          username: rest.username || 'default',
          password: rest.password ?? '',
          secure: isSecure,
        }

        if (rest.table) result.table = rest.table
        if (rest.query) result.query = rest.query
        if (rest.where) result.where = rest.where
        if (rest.name) result.name = rest.name
        if (rest.newTable) result.newTable = rest.newTable
        if (rest.partition) result.partition = rest.partition
        if (rest.queryId) result.queryId = rest.queryId
        if (rest.engine) result.engine = rest.engine
        if (rest.orderBy) result.orderBy = rest.orderBy
        if (rest.partitionBy) result.partitionBy = rest.partitionBy
        if (rest.final !== undefined) {
          result.final = rest.final === true || rest.final === 'true'
        }
        if (rest.onlyRunning !== undefined) {
          result.onlyRunning = rest.onlyRunning === true || rest.onlyRunning === 'true'
        }
        if (parsedData !== undefined) result.data = parsedData
        if (parsedColumns !== undefined) result.columns = parsedColumns
        if (parsedRows !== undefined) result.rows = parsedRows

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Database operation to perform' },
    host: { type: 'string', description: 'ClickHouse host' },
    port: { type: 'string', description: 'ClickHouse HTTP port' },
    database: { type: 'string', description: 'Database name' },
    username: { type: 'string', description: 'ClickHouse username' },
    password: { type: 'string', description: 'ClickHouse password' },
    secure: { type: 'boolean', description: 'Use a secure HTTPS connection' },
    table: { type: 'string', description: 'Table name' },
    query: { type: 'string', description: 'SQL statement to execute' },
    data: { type: 'json', description: 'Data for insert/update operations' },
    rows: { type: 'json', description: 'Array of row objects for bulk insert' },
    columns: { type: 'json', description: 'Column definitions for create table' },
    where: { type: 'string', description: 'WHERE clause for update/delete/count' },
    name: { type: 'string', description: 'Database name for create/drop database' },
    newTable: { type: 'string', description: 'Target table name for rename' },
    partition: { type: 'string', description: 'Partition expression for drop partition' },
    queryId: { type: 'string', description: 'Query ID for kill query' },
    engine: { type: 'string', description: 'Table engine for create table' },
    orderBy: { type: 'string', description: 'ORDER BY expression for create table' },
    partitionBy: { type: 'string', description: 'PARTITION BY expression for create table' },
    final: { type: 'boolean', description: 'Force a final merge for optimize table' },
    onlyRunning: { type: 'boolean', description: 'Filter to running mutations only' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    rows: {
      type: 'array',
      description: 'Array of rows returned from the operation',
    },
    rowCount: {
      type: 'number',
      description: 'Number of rows returned or affected by the operation',
    },
    count: {
      type: 'number',
      description: 'Row count (count rows operation)',
    },
    ddl: {
      type: 'string',
      description: 'CREATE TABLE statement (show create table operation)',
    },
    tables: {
      type: 'array',
      description: 'Array of table schemas with columns and engines (introspect operation)',
    },
  },
}
