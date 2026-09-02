import { getErrorMessage } from '@sim/utils/errors'
import { OracleDatabaseIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'

const ORACLE_SQL_WAND_PROMPT = `You are an expert Oracle Database developer. Write Oracle SQL for the selected operation based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY one SQL statement. Do not include explanations, markdown, comments, hints, a trailing semicolon, or a forward slash.

### ORACLE SQL GUIDELINES
1. For Query, return one read-only SELECT or ordinary SELECT CTE.
2. For Execute, use only SELECT, INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER, DROP, or EXPLAIN PLAN.
3. Use Oracle syntax such as FETCH FIRST n ROWS ONLY, SYSDATE, SYSTIMESTAMP, NVL, and quoted identifiers only when needed.
4. Use named IN binds such as :customer_id for data values. Do not bind table or column names.
5. Do not generate PL/SQL, transaction-control statements, OUT binds, RETURNING INTO, database links, comments, hints, or stacked statements.
6. Keep SELECT results bounded and deterministic with ORDER BY where ordering matters.

### EXAMPLES
"Get the 25 newest active customers"
SELECT customer_id, name, email, created_at
FROM customers
WHERE status = :status
ORDER BY created_at DESC
FETCH FIRST 25 ROWS ONLY

"Upsert a customer by ID"
MERGE INTO customers target
USING (SELECT :customer_id AS customer_id, :name AS name FROM dual) source
ON (target.customer_id = source.customer_id)
WHEN MATCHED THEN UPDATE SET target.name = source.name
WHEN NOT MATCHED THEN INSERT (customer_id, name) VALUES (source.customer_id, source.name)

Return ONLY the Oracle SQL statement - no explanations, no extra text.`

const DATA_OPERATIONS = ['insert', 'update']
const TABLE_OPERATIONS = ['insert', 'update', 'delete']
const WHERE_OPERATIONS = ['update', 'delete']
const SQL_OPERATIONS = ['query', 'execute']
const SCHEMA_OPERATIONS = ['insert', 'update', 'delete', 'introspect']
const MAX_ORACLE_JSON_INPUT_BYTES = 1024 * 1024

function parseJsonObject(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined

  let parsed: unknown = value
  if (typeof value === 'string') {
    if (
      value.length > MAX_ORACLE_JSON_INPUT_BYTES ||
      new TextEncoder().encode(value).byteLength > MAX_ORACLE_JSON_INPUT_BYTES
    ) {
      throw new Error(`${label} must be at most 1 MiB`)
    }
    try {
      parsed = JSON.parse(value)
    } catch (error) {
      throw new Error(`${label} must be valid JSON: ${getErrorMessage(error)}`)
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }

  return parsed as Record<string, unknown>
}

function parseNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback
  return typeof value === 'number' ? value : Number(value)
}

export const OracleDatabaseBlock: BlockConfig = {
  type: 'oracledb',
  name: 'Oracle Database',
  description: 'Connect directly to an Oracle Database',
  longDescription:
    'Query, modify, and inspect Oracle Database over Oracle Net using TCP or verified TCPS, with optional in-memory PEM wallet authentication.',
  docsLink: 'https://docs.sim.ai/integrations/oracledb',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#FFFFFF',
  icon: OracleDatabaseIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Database',
    sentences: {
      byOperation: {
        query: [{ text: 'Query rows with', field: 'query', core: true }],
        insert: [
          { text: 'Insert', field: 'data', core: true },
          { text: 'into', field: 'table', core: true },
        ],
        update: [
          { text: 'Update rows in', field: 'table', core: true },
          { text: ', where', field: 'where', core: true },
          { text: ', setting', field: 'data' },
        ],
        delete: [
          { text: 'Delete rows from', field: 'table', core: true },
          { text: ', where', field: 'where', core: true },
        ],
        execute: [{ text: 'Execute', field: 'query', core: true }],
        introspect: ['Inspect accessible database schemas', { text: ', under', field: 'schema' }],
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
        { label: 'Execute SQL', id: 'execute' },
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
      placeholder: '1521',
      value: () => '1521',
      required: true,
    },
    {
      id: 'protocol',
      title: 'Protocol',
      type: 'dropdown',
      options: [
        { label: 'TCP', id: 'tcp' },
        { label: 'TCPS', id: 'tcps' },
      ],
      value: () => 'tcp',
      required: true,
    },
    {
      id: 'connectionType',
      title: 'Connection Identifier',
      type: 'dropdown',
      options: [
        { label: 'Service Name', id: 'serviceName' },
        { label: 'SID', id: 'sid' },
      ],
      value: () => 'serviceName',
      required: true,
    },
    {
      id: 'serviceName',
      title: 'Service Name',
      type: 'short-input',
      placeholder: 'FREEPDB1',
      condition: { field: 'connectionType', value: 'serviceName' },
      required: { field: 'connectionType', value: 'serviceName' },
    },
    {
      id: 'sid',
      title: 'SID',
      type: 'short-input',
      placeholder: 'ORCL',
      condition: { field: 'connectionType', value: 'sid' },
      required: { field: 'connectionType', value: 'sid' },
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'app_user',
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
      id: 'connectionTimeout',
      title: 'Connection Timeout (ms)',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '15000',
      value: () => '15000',
    },
    {
      id: 'walletContent',
      title: 'PEM Wallet Content',
      type: 'code',
      password: true,
      mode: 'advanced',
      placeholder: '-----BEGIN PRIVATE KEY-----\n...',
      condition: { field: 'protocol', value: 'tcps' },
    },
    {
      id: 'walletPassword',
      title: 'Wallet Password',
      type: 'short-input',
      password: true,
      mode: 'advanced',
      placeholder: 'Password for encrypted ewallet.pem',
      condition: { field: 'protocol', value: 'tcps' },
    },
    {
      id: 'query',
      title: 'SQL Statement',
      canvasNoun: 'a SQL statement',
      type: 'code',
      placeholder: 'SELECT customer_id, name FROM customers FETCH FIRST 100 ROWS ONLY',
      condition: { field: 'operation', value: SQL_OPERATIONS },
      required: { field: 'operation', value: SQL_OPERATIONS },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: ORACLE_SQL_WAND_PROMPT,
        placeholder: 'Describe the Oracle SQL statement you need...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'binds',
      title: 'Named Binds (JSON)',
      type: 'code',
      mode: 'advanced',
      placeholder: '{\n  "customer_id": 42,\n  "status": "ACTIVE"\n}',
      condition: { field: 'operation', value: SQL_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of named Oracle IN bind values. Keys must omit the colon prefix and values must be strings, finite numbers, or null. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'APP_SCHEMA',
      condition: { field: 'operation', value: SCHEMA_OPERATIONS },
    },
    {
      id: 'table',
      title: 'Table Name',
      canvasNoun: 'a table',
      type: 'short-input',
      placeholder: 'CUSTOMERS',
      condition: { field: 'operation', value: TABLE_OPERATIONS },
      required: { field: 'operation', value: TABLE_OPERATIONS },
    },
    {
      id: 'data',
      title: 'Data (JSON)',
      canvasNoun: 'a data object',
      type: 'code',
      placeholder: '{\n  "CUSTOMER_ID": 42,\n  "NAME": "Ada"\n}',
      condition: { field: 'operation', value: DATA_OPERATIONS },
      required: { field: 'operation', value: DATA_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate one JSON object whose keys are Oracle column names and whose values should be inserted or updated. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'where',
      title: 'WHERE Condition',
      canvasNoun: 'a WHERE condition',
      type: 'short-input',
      placeholder: 'CUSTOMER_ID = 42',
      condition: { field: 'operation', value: WHERE_OPERATIONS },
      required: { field: 'operation', value: WHERE_OPERATIONS },
    },
  ],
  tools: {
    access: [
      'oracledb_query',
      'oracledb_insert',
      'oracledb_update',
      'oracledb_delete',
      'oracledb_execute',
      'oracledb_introspect',
    ],
    config: {
      tool: (params) => `oracledb_${params.operation}`,
      params: (params) => {
        const protocol = params.protocol || 'tcp'
        const connectionType = params.connectionType || 'serviceName'

        return {
          host: params.host,
          port: parseNumber(params.port, 1521),
          protocol,
          connectionType,
          serviceName: connectionType === 'serviceName' ? params.serviceName : undefined,
          sid: connectionType === 'sid' ? params.sid : undefined,
          username: params.username,
          password: params.password,
          connectionTimeout: parseNumber(params.connectionTimeout, 15000),
          walletContent: protocol === 'tcps' ? params.walletContent || undefined : undefined,
          walletPassword: protocol === 'tcps' ? params.walletPassword || undefined : undefined,
          query: params.query,
          binds: parseJsonObject(params.binds, 'Named binds'),
          schema: params.schema || undefined,
          table: params.table,
          data: parseJsonObject(params.data, 'Data'),
          where: params.where,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Oracle Database operation to perform' },
    host: { type: 'string', description: 'Oracle Database host' },
    port: { type: 'string', description: 'Oracle Net listener port' },
    protocol: { type: 'string', description: 'Oracle Net protocol: tcp or tcps' },
    connectionType: {
      type: 'string',
      description: 'Oracle connection identifier type: serviceName or sid',
    },
    serviceName: { type: 'string', description: 'Oracle service name' },
    sid: { type: 'string', description: 'Oracle system identifier' },
    username: { type: 'string', description: 'Oracle Database username' },
    password: { type: 'string', description: 'Oracle Database password' },
    connectionTimeout: { type: 'string', description: 'Connection timeout in milliseconds' },
    walletContent: { type: 'string', description: 'In-memory ewallet.pem content for TCPS' },
    walletPassword: { type: 'string', description: 'Password for an encrypted PEM wallet' },
    query: { type: 'string', description: 'Oracle SQL statement' },
    binds: { type: 'json', description: 'Named string, number, or null IN bind values' },
    schema: { type: 'string', description: 'Optional owning Oracle schema' },
    table: { type: 'string', description: 'Oracle table name' },
    data: { type: 'json', description: 'Data for an insert or update operation' },
    where: { type: 'string', description: 'WHERE expression for an update or delete' },
  },
  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    rows: {
      type: 'array',
      description: 'Normalized rows returned by query or execute operations',
      condition: { field: 'operation', value: ['query', 'insert', 'update', 'delete', 'execute'] },
    },
    rowCount: {
      type: 'number',
      description: 'Number of rows returned or affected',
      condition: { field: 'operation', value: ['query', 'insert', 'update', 'delete', 'execute'] },
    },
    truncated: {
      type: 'boolean',
      description: 'True when the row or byte ceiling truncated the result',
      condition: { field: 'operation', value: ['query', 'insert', 'update', 'delete', 'execute'] },
    },
    truncationReason: {
      type: 'string',
      description: 'The response ceiling that was reached',
      condition: { field: 'operation', value: ['query', 'insert', 'update', 'delete', 'execute'] },
    },
    tables: {
      type: 'array',
      description: 'Accessible tables with schema, columns, primaryKey, foreignKeys, and indexes',
      condition: { field: 'operation', value: 'introspect' },
    },
    schemas: {
      type: 'array',
      description:
        'Table-owning schemas visible through ALL_TABLES, plus the selected or current schema',
      condition: { field: 'operation', value: 'introspect' },
    },
  },
}

export const OracleDatabaseBlockMeta = {
  tags: ['data-analytics'],
  url: 'https://www.oracle.com/database/',
  templates: [
    {
      icon: OracleDatabaseIcon,
      title: 'Ask Oracle in English',
      prompt:
        'Build a workflow that accepts a natural-language question, introspects the relevant Oracle schema, has an agent produce a bounded SELECT with named binds, runs it, and returns a readable answer with the supporting rows.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'reporting'],
    },
    {
      icon: OracleDatabaseIcon,
      title: 'Oracle KPI digest',
      prompt:
        'Create a scheduled workflow that queries key business metrics from Oracle Database each morning, has an agent summarize changes and anomalies, and posts the digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OracleDatabaseIcon,
      title: 'Document Oracle schema',
      prompt:
        'Build a workflow that introspects an accessible Oracle schema, then has an agent turn its tables, columns, keys, and indexes into plain-English database documentation.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'documentation'],
    },
    {
      icon: OracleDatabaseIcon,
      title: 'Merge Oracle records',
      prompt:
        'Create a workflow that validates incoming records and executes an Oracle MERGE so matching rows are updated and new rows are inserted without a read-before-write race.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'sync'],
    },
    {
      icon: OracleDatabaseIcon,
      title: 'Clean stale Oracle data',
      prompt:
        'Build a scheduled workflow that previews rows older than a retention cutoff, deletes only the matching Oracle records, and reports the affected row count.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['database', 'automation'],
    },
    {
      icon: OracleDatabaseIcon,
      title: 'Sync Oracle to Sim',
      prompt:
        'Create a scheduled workflow that queries the latest Oracle records and writes each normalized row into a Sim table for downstream workflows and analysis.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['database', 'sync'],
    },
    {
      icon: OracleDatabaseIcon,
      title: 'Alert on Oracle thresholds',
      prompt:
        'Build a scheduled workflow that runs an Oracle aggregate query, compares the result with a threshold, and sends a Slack alert only when the limit is crossed.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OracleDatabaseIcon,
      title: 'Log webhooks in Oracle',
      prompt:
        'Create a workflow triggered by an incoming webhook that validates and reshapes the payload, then inserts one bound row into an Oracle audit or event table.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['database', 'automation'],
    },
  ],
  skills: [
    {
      name: 'query-to-answer',
      description: 'Answer a natural-language question with a bounded Oracle SELECT and its rows.',
      content:
        '# Query To Answer\n\nUse Oracle schema metadata and a read-only query to answer a factual question.\n\n## Steps\n1. Run introspect for the relevant schema.\n2. Generate one SELECT using real table and column names. Add deterministic ordering and `FETCH FIRST n ROWS ONLY`.\n3. Put user-supplied values in named binds instead of concatenating them into SQL.\n4. Run query and summarize `rows`, `rowCount`, and any truncation warning.\n\n## Output\nReturn the plain-language answer, supporting rows, row count, and truncation status.\n\n## Reference\n[Oracle SELECT](https://docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/SELECT.html)',
    },
    {
      name: 'merge-records',
      description: 'Insert or update records atomically by key with an Oracle MERGE statement.',
      content:
        '# Merge Records\n\nKeep an Oracle table synchronized without a read-before-write race.\n\n## Steps\n1. Introspect the target table and confirm the match key is unique.\n2. Build one `MERGE INTO` statement whose `ON` clause uses the key.\n3. Use named binds for source values and run the statement with execute.\n4. Check `rowCount` and report failures without retrying blindly.\n\n## Output\nReturn the number of rows affected and the match key used.\n\n## Reference\n[Oracle MERGE](https://docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/MERGE.html)',
    },
    {
      name: 'document-schema',
      description: 'Turn accessible Oracle dictionary metadata into readable schema documentation.',
      content:
        '# Document Schema\n\nDocument the objects visible to the connected Oracle account.\n\n## Steps\n1. Run introspect for the target schema, or omit it for `CURRENT_SCHEMA`.\n2. Explain each table from its columns and data types.\n3. Describe relationships from primary and foreign keys.\n4. Note indexes that reveal common lookup patterns.\n5. Clearly label the result as privilege-scoped and potentially partial.\n\n## Output\nReturn one section per table plus the raw introspection result.\n\n## Reference\n[Oracle ALL_TABLES](https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/ALL_TABLES.html)',
    },
    {
      name: 'retention-cleanup',
      description: 'Preview and delete Oracle rows older than an explicit retention cutoff.',
      content:
        '# Retention Cleanup\n\nRemove stale records with an auditable cutoff.\n\n## Steps\n1. Compute and record the cutoff timestamp.\n2. Run a bounded SELECT count using the same condition to preview impact.\n3. Stop if the preview is unexpectedly large.\n4. Run delete with a non-empty WHERE expression scoped to the cutoff.\n5. Record `rowCount` and the cutoff.\n\n## Output\nReturn preview count, deleted row count, cutoff, and status.',
    },
    {
      name: 'monitor-thresholds',
      description: 'Monitor an Oracle metric and alert only when an explicit threshold is crossed.',
      content:
        '# Monitor Thresholds\n\nTurn a bounded Oracle aggregate into a repeatable health check.\n\n## Steps\n1. Define the metric, threshold, schedule, and alert destination.\n2. Run one deterministic aggregate SELECT with named binds for any variable filters.\n3. Treat truncation or query failure as an unknown state, not a healthy result.\n4. Compare the returned metric with the threshold and alert only on a crossing or state change.\n5. Include the measured value, threshold, and query time in the alert.\n\n## Output\nReturn the current value, threshold, state, and whether an alert was sent.\n\n## Reference\n[Oracle aggregate functions](https://docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/Aggregate-Functions.html)',
    },
    {
      name: 'inspect-execution-plan',
      description: 'Generate and read an Oracle execution plan before changing a costly query.',
      content:
        "# Inspect Execution Plan\n\nUse Oracle's plan tooling to diagnose a query without running its full workload.\n\n## Steps\n1. Run `EXPLAIN PLAN FOR` with execute for the target SQL.\n2. Run query with `SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY())`.\n3. Identify full scans, join order, estimated rows, bytes, and cost.\n4. Compare the plan with introspected keys and indexes.\n5. Recommend a SQL or index change, but do not apply DDL without explicit approval.\n\n## Output\nReturn the plan lines, the likely bottleneck, and a concise recommendation.\n\n## Reference\n[Displaying execution plans](https://docs.oracle.com/en/database/oracle/oracle-database/26/tgsql/generating-and-displaying-execution-plans.html)",
    },
    {
      name: 'audit-schema-design',
      description: 'Audit visible Oracle keys and indexes for structural gaps and risky tables.',
      content:
        '# Audit Schema Design\n\nReview the schema structure visible to the integration account.\n\n## Steps\n1. Run introspect for the target schema.\n2. Flag tables with no primary key.\n3. Use foreign-key metadata to nominate tables for index review. Treat coverage as provisional only when a foreign-key column leads a reported non-primary-key index or the primary key; composite constraints, function-based indexes, and omitted primary-key indexes require manual confirmation.\n4. Identify duplicate reported indexes with the same ordered columns.\n5. Separate confirmed metadata from review candidates; visibility is limited by account privileges.\n\n## Output\nReturn confirmed missing keys, foreign-key index review candidates, duplicate reported indexes, and healthy tables.\n\n## Reference\n[Oracle ALL_INDEXES](https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/ALL_INDEXES.html)',
    },
  ],
} as const satisfies BlockMeta
