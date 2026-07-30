import { Bug, ClipboardList, Clock, Database, File, Search, Server } from '@sim/emcn/icons'
import { LogfireIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { LogfireResponse } from '@/tools/logfire/types'

const toBoolean = (value: unknown): boolean | undefined => {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

const toNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const LOGFIRE_QUERY_PROMPT = `You are an expert Pydantic Logfire analyst. Write read-only SQL SELECT queries against Logfire observability data based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the SQL query. Do not include any explanations, markdown formatting, comments, or additional text. Just the raw SQL query.

### QUERY GUIDELINES
1. **Syntax**: Logfire runs Apache DataFusion with PostgreSQL-compatible syntax
2. **Tables**: \`records\` holds one row per span or log and is what you almost always want; \`metrics\` holds pre-aggregated numeric data
3. **Time window**: Do NOT add a start_timestamp filter — the block sends the time window separately as min_timestamp/max_timestamp
4. **Readability**: Format queries with proper indentation and spacing

### RECORDS COLUMNS
- Identity: span_name, message, kind (span, log, span_event), tags, attributes (JSON)
- Severity: level — stored as an OpenTelemetry severity number but comparable to names, so \`level >= 'error'\` works. Project \`level_name(level)\` for a readable severity
- Span tree: trace_id, span_id, parent_span_id
- Timing: start_timestamp, end_timestamp, duration (seconds, null for logs)
- Exceptions: is_exception, exception_type, exception_message, exception_stacktrace
- Resource: service_name, service_version, deployment_environment, otel_scope_name
- HTTP: http_route, http_method, url_path, url_full, http_response_status_code

### LOGFIRE FEATURES
- Extract JSON from attributes with the \`->>\` operator, e.g. \`attributes->>'user_id'\`
- Use \`level_num('warn')\` to convert a name to its number, \`level_name(level)\` for the reverse
- Errors that are exceptions: \`WHERE is_exception AND level >= 'error'\`

### EXAMPLES

**Recent errors**: "Show me the latest errors per service"
→ SELECT start_timestamp, service_name, level_name(level) AS level, message, exception_type
  FROM records
  WHERE level >= 'error'
  ORDER BY start_timestamp DESC;

**Latency aggregation**: "What are my slowest operations by p95?"
→ SELECT
      span_name,
      count(*) AS calls,
      approx_percentile_cont(duration, 0.95) AS p95_seconds
  FROM records
  WHERE duration IS NOT NULL
  GROUP BY span_name
  ORDER BY p95_seconds DESC;

**Exception breakdown**: "Group exceptions by type for the checkout service"
→ SELECT exception_type, count(*) AS occurrences
  FROM records
  WHERE is_exception AND service_name = 'checkout-api'
  GROUP BY exception_type
  ORDER BY occurrences DESC;

### REMEMBER
Return ONLY the SQL query - no explanations, no markdown, no extra text.`

export const LogfireBlock: BlockConfig<LogfireResponse> = {
  type: 'logfire',
  name: 'Logfire',
  description: 'Query traces, logs, and metrics in Pydantic Logfire',
  longDescription:
    'Integrate Pydantic Logfire into workflows. Run SQL over your observability data, search spans and logs with structured filters, pull an entire trace by ID, and confirm which project a read token targets.',
  docsLink: 'https://docs.sim.ai/integrations/logfire',
  category: 'tools',
  authMode: AuthMode.ApiKey,
  integrationType: IntegrationType.Observability,
  bgColor: '#E520E9',
  iconColor: '#E520E9',
  icon: LogfireIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search Records', id: 'logfire_search_records' },
        { label: 'Run SQL Query', id: 'logfire_query' },
        { label: 'Get Trace', id: 'logfire_get_trace' },
        { label: 'Get Token Info', id: 'logfire_get_token_info' },
      ],
      value: () => 'logfire_search_records',
    },
    {
      id: 'apiKey',
      title: 'Read Token',
      type: 'short-input',
      placeholder: 'pylf_v1_us_...',
      password: true,
      required: true,
    },
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      placeholder: 'https://logfire-us.pydantic.dev',
      description:
        'Base URL of your Logfire instance. Leave blank for Logfire Cloud — the region is read from your token. Set this for a self-hosted deployment.',
    },
    {
      id: 'region',
      title: 'Region',
      type: 'dropdown',
      options: [
        { label: 'Auto (from token)', id: 'auto' },
        { label: 'US', id: 'us' },
        { label: 'EU', id: 'eu' },
      ],
      value: () => 'auto',
      description: 'Cloud region. Ignored when Host is set.',
      mode: 'advanced',
    },
    {
      id: 'sql',
      title: 'SQL Query',
      type: 'code',
      placeholder: "SELECT message, level_name(level) AS level FROM records WHERE level >= 'error'",
      condition: { field: 'operation', value: 'logfire_query' },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: LOGFIRE_QUERY_PROMPT,
        placeholder: 'Describe the Logfire data you want to query...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'query',
      title: 'Message Contains',
      type: 'short-input',
      placeholder: 'timeout',
      condition: { field: 'operation', value: 'logfire_search_records' },
    },
    {
      id: 'service',
      title: 'Service Name',
      type: 'short-input',
      placeholder: 'checkout-api',
      condition: { field: 'operation', value: 'logfire_search_records' },
    },
    {
      id: 'minLevel',
      title: 'Minimum Level',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Trace', id: 'trace' },
        { label: 'Debug', id: 'debug' },
        { label: 'Info', id: 'info' },
        { label: 'Notice', id: 'notice' },
        { label: 'Warn', id: 'warn' },
        { label: 'Error', id: 'error' },
        { label: 'Fatal', id: 'fatal' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'logfire_search_records' },
    },
    {
      id: 'exceptionsOnly',
      title: 'Exceptions Only',
      type: 'switch',
      description: 'Only return records that recorded an exception',
      condition: { field: 'operation', value: 'logfire_search_records' },
    },
    {
      id: 'spanName',
      title: 'Span Name',
      type: 'short-input',
      placeholder: 'GET /orders/{id}',
      condition: { field: 'operation', value: 'logfire_search_records' },
      mode: 'advanced',
    },
    {
      id: 'traceId',
      title: 'Trace ID',
      type: 'short-input',
      placeholder: '0123456789abcdef0123456789abcdef',
      condition: { field: 'operation', value: 'logfire_get_trace' },
      required: true,
    },
    {
      id: 'environment',
      title: 'Deployment Environment',
      type: 'short-input',
      placeholder: 'production',
      condition: { field: 'operation', value: ['logfire_query', 'logfire_search_records'] },
      mode: 'advanced',
    },
    {
      id: 'minTimestamp',
      title: 'Start Time',
      type: 'short-input',
      placeholder: '2026-07-29T00:00:00Z',
      condition: {
        field: 'operation',
        value: ['logfire_query', 'logfire_search_records', 'logfire_get_trace'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 UTC timestamp for the start of the requested time window. Return ONLY the timestamp string.',
        placeholder: 'Describe the start of the time window...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'maxTimestamp',
      title: 'End Time',
      type: 'short-input',
      placeholder: '2026-07-30T00:00:00Z',
      condition: {
        field: 'operation',
        value: ['logfire_query', 'logfire_search_records', 'logfire_get_trace'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 UTC timestamp for the end of the requested time window. Return ONLY the timestamp string.',
        placeholder: 'Describe the end of the time window...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: ['logfire_query', 'logfire_search_records', 'logfire_get_trace'],
      },
      mode: 'advanced',
    },
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'Europe/Paris',
      condition: { field: 'operation', value: 'logfire_query' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description into an IANA timezone identifier.

Examples:
- "New York" or "Eastern" -> America/New_York
- "London" -> Europe/London
- "Paris" -> Europe/Paris
- "Tokyo" -> Asia/Tokyo
- "UTC" or "GMT" -> UTC

Return ONLY the IANA timezone string - no explanations or quotes.`,
        placeholder: 'Describe the timezone (e.g., "New York", "Pacific time")...',
        generationType: 'timezone',
      },
    },
  ],
  tools: {
    access: [
      'logfire_query',
      'logfire_search_records',
      'logfire_get_trace',
      'logfire_get_token_info',
    ],
    config: {
      tool: (params) => String(params.operation || 'logfire_search_records'),
      params: (params) => {
        const baseParams = {
          apiKey: params.apiKey,
          region: params.region || 'auto',
          host: params.host,
        }

        const window = {
          minTimestamp: params.minTimestamp,
          maxTimestamp: params.maxTimestamp,
          limit: toNumber(params.limit),
        }

        switch (params.operation) {
          case 'logfire_query':
            return {
              ...baseParams,
              ...window,
              sql: params.sql,
              timezone: params.timezone,
              environment: params.environment,
            }

          case 'logfire_get_trace':
            return {
              ...baseParams,
              ...window,
              traceId: params.traceId,
            }

          case 'logfire_get_token_info':
            return baseParams

          default:
            return {
              ...baseParams,
              ...window,
              query: params.query,
              service: params.service,
              spanName: params.spanName,
              minLevel: params.minLevel || undefined,
              exceptionsOnly: toBoolean(params.exceptionsOnly),
              environment: params.environment,
            }
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Logfire read token' },
    region: { type: 'string', description: 'Logfire data region: auto, us, or eu' },
    host: { type: 'string', description: 'Base URL of a self-hosted Logfire instance' },
    sql: { type: 'string', description: 'SQL SELECT query to run' },
    query: { type: 'string', description: 'Text to match within the record message' },
    service: { type: 'string', description: 'Service name to filter on' },
    spanName: { type: 'string', description: 'Span name to filter on' },
    minLevel: { type: 'string', description: 'Minimum severity level to include' },
    exceptionsOnly: { type: 'boolean', description: 'Only return records with an exception' },
    traceId: { type: 'string', description: 'Trace identifier to fetch' },
    environment: { type: 'string', description: 'Deployment environment to filter on' },
    minTimestamp: { type: 'string', description: 'ISO 8601 start of the query time window' },
    maxTimestamp: { type: 'string', description: 'ISO 8601 end of the query time window' },
    limit: { type: 'number', description: 'Maximum rows to return' },
    timezone: { type: 'string', description: 'IANA timezone used to evaluate the query' },
  },
  outputs: {
    rows: {
      type: 'json',
      description:
        'Result rows. Raw SQL returns the query projection; Search Records and Get Trace return records (startTimestamp, endTimestamp, duration, level, message, spanName, kind, serviceName, deploymentEnvironment, traceId, spanId, parentSpanId, isException, exceptionType, exceptionMessage).',
    },
    rowCount: { type: 'number', description: 'Number of rows returned' },
    columns: { type: 'json', description: 'Column metadata (name, datatype, nullable)' },
    sql: { type: 'string', description: 'SQL query that was executed against Logfire' },
    organizationName: { type: 'string', description: 'Organization the read token belongs to' },
    projectName: { type: 'string', description: 'Project the read token belongs to' },
  },
}

export const LogfireBlockMeta = {
  tags: ['monitoring', 'error-tracking', 'incident-management'],
  url: 'https://pydantic.dev/logfire',
  templates: [
    {
      icon: LogfireIcon,
      title: 'Logfire error digest',
      prompt:
        'Create a scheduled workflow that runs every morning, searches Logfire for records at error level or above from the last 24 hours, groups them by service and exception type, and posts a ranked digest to Slack with the worst offenders first.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Search,
      title: 'Logfire trace investigator',
      prompt:
        'Build a workflow that takes a Logfire trace ID, fetches every span in the trace, walks the parent-child tree to find the slowest span and the first exception, and writes a plain-English root-cause summary back as a Linear comment.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'incident-management'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: Clock,
      title: 'Logfire latency watchdog',
      prompt:
        'Create a workflow that runs every 15 minutes, uses SQL against the Logfire records table to compute p95 duration per span_name over the window, compares it against the prior window stored in a table, and pages on-call through PagerDuty when latency regresses more than 50 percent.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'incident-management'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: ClipboardList,
      title: 'Logfire LLM cost tracker',
      prompt:
        'Build a scheduled daily workflow that queries Logfire for spans emitted by LLM instrumentation, extracts token counts from the attributes JSON, aggregates spend per model and per service into a table, and emails finance when a service trends over budget.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'finance', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: Bug,
      title: 'Logfire release regression check',
      prompt:
        'Create a workflow that fires after each deploy, waits for a soak period, then searches Logfire for new exception types in the production environment that were not present before the release, and comments the diff on the GitHub pull request that shipped it.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd', 'monitoring'],
      alsoIntegrations: ['github'],
    },
    {
      icon: Server,
      title: 'Logfire customer issue triage',
      prompt:
        'Build a workflow triggered by a support ticket that pulls the customer request ID from the ticket, searches Logfire for records matching that ID, fetches the full trace when one is found, and replies in Zendesk with whether the failure was user error or a backend fault.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['customer-support', 'monitoring', 'ticketing'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: File,
      title: 'Logfire weekly reliability review',
      prompt:
        'Create a scheduled weekly workflow that runs SQL against Logfire for error rate, throughput, and duration percentiles per service, writes a narrative reliability review file for the SRE team, and highlights every service whose error budget burn accelerated week over week.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'reporting'],
    },
    {
      icon: Database,
      title: 'Logfire agent run auditor',
      prompt:
        'Build a workflow that searches Logfire for spans from your AI agent service where an exception was recorded, fetches each full trace to capture the prompt and tool calls that led to the failure, and logs a structured failure catalog to a table for prompt tuning.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'agentic'],
    },
  ],
  skills: [
    {
      name: 'investigate-logfire-errors',
      description:
        'Find the dominant error patterns in Logfire for a service and time window, then explain them.',
      content:
        '# Investigate Logfire Errors\n\nFind and explain what is failing in a service.\n\n## Steps\n1. Run Search Records with the service name, a minimum level of error, and the requested time window.\n2. Group the results by exceptionType and message to find the dominant failure patterns.\n3. Pick the most frequent or most severe pattern and run Get Trace on one of its traceId values to see the full request path.\n4. Read the surrounding spans to identify where in the call chain the failure originates.\n\n## Output\nThe top error patterns with counts, the service and span where each originates, and a one-line likely cause per pattern. Include one representative trace ID for each.',
    },
    {
      name: 'analyze-logfire-latency',
      description: 'Use SQL against the Logfire records table to find the slowest operations.',
      content:
        "# Analyze Logfire Latency\n\nFind what is slow and quantify it.\n\n## Steps\n1. Run a SQL Query aggregating duration over the records table, for example: SELECT span_name, count(*) AS n, avg(duration) AS avg_s, approx_percentile_cont(duration, 0.95) AS p95_s FROM records WHERE duration IS NOT NULL GROUP BY span_name ORDER BY p95_s DESC.\n2. Narrow to a service with a WHERE service_name = '...' clause when one was named.\n3. Take the worst span_name and run Search Records for its slowest instances, then Get Trace on one to see where the time goes.\n\n## Output\nA table of the slowest operations by p95 with call counts, and for the worst one a breakdown of which child span consumes the time.",
    },
    {
      name: 'reconstruct-logfire-trace',
      description: 'Walk a single Logfire trace end to end and explain what happened.',
      content:
        '# Reconstruct Logfire Trace\n\nTurn a trace ID into a readable story of one request.\n\n## Steps\n1. Run Get Trace with the trace ID. Spans come back earliest first.\n2. Build the tree using spanId and parentSpanId to see which operations nested inside which.\n3. Note each span duration to find where time was spent, and flag any span where isException is true.\n4. If the trace is truncated, raise the limit and refetch.\n\n## Output\nAn ordered walkthrough of the request: the entry point, each significant nested operation with its duration, and where it failed or ended. Call out the single slowest span and the first exception.',
    },
  ],
} as const satisfies BlockMeta
