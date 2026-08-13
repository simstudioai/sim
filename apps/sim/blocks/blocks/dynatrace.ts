import { DynatraceIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { DynatraceResponse } from '@/tools/dynatrace/types'

/** Operations that accept the shared `from` timeframe parameter. */
const FROM_OPERATIONS = [
  'dynatrace_list_problems',
  'dynatrace_query_metrics',
  'dynatrace_list_entities',
  'dynatrace_get_entity',
  'dynatrace_list_events',
  'dynatrace_search_logs',
  'dynatrace_list_slos',
  'dynatrace_get_slo',
  'dynatrace_list_security_problems',
  'dynatrace_get_security_problem',
  'dynatrace_get_audit_logs',
  'dynatrace_list_attacks',
  'dynatrace_list_tags',
  'dynatrace_add_tags',
  'dynatrace_delete_tag',
]

/** Operations that accept the shared `to` timeframe parameter. */
const TO_OPERATIONS = FROM_OPERATIONS.filter((op) => op !== 'dynatrace_get_security_problem')

/** Operations that accept the shared `pageSize` / `nextPageKey` pagination parameters. */
const PAGINATED_OPERATIONS = [
  'dynatrace_list_problems',
  'dynatrace_list_problem_comments',
  'dynatrace_list_metrics',
  'dynatrace_list_entities',
  'dynatrace_list_entity_types',
  'dynatrace_list_events',
  'dynatrace_list_slos',
  'dynatrace_list_security_problems',
  'dynatrace_get_audit_logs',
  'dynatrace_list_attacks',
  'dynatrace_list_settings_objects',
]

/** Operations that accept the shared `entitySelector` parameter. */
const ENTITY_SELECTOR_OPERATIONS = [
  'dynatrace_list_problems',
  'dynatrace_query_metrics',
  'dynatrace_list_entities',
  'dynatrace_list_events',
  'dynatrace_ingest_event',
  'dynatrace_list_tags',
  'dynatrace_add_tags',
  'dynatrace_delete_tag',
]

/**
 * Operations whose tool declares `entitySelector` as required. The tag endpoints
 * cannot run without one, so the block must not let them through empty.
 */
const ENTITY_SELECTOR_REQUIRED_OPERATIONS = [
  'dynatrace_list_entities',
  'dynatrace_list_tags',
  'dynatrace_add_tags',
  'dynatrace_delete_tag',
]

/** Operations that take a problem ID. */
const PROBLEM_ID_OPERATIONS = [
  'dynatrace_get_problem',
  'dynatrace_close_problem',
  'dynatrace_list_problem_comments',
  'dynatrace_add_problem_comment',
  'dynatrace_get_problem_comment',
  'dynatrace_update_problem_comment',
  'dynatrace_delete_problem_comment',
]

/** Operations that take a single security problem ID. */
const SECURITY_PROBLEM_ID_OPERATIONS = [
  'dynatrace_get_security_problem',
  'dynatrace_mute_security_problem',
  'dynatrace_unmute_security_problem',
  'dynatrace_list_remediation_items',
]

/** Operations that write a mute state and therefore take a reason and comment. */
const MUTE_OPERATIONS = [
  'dynatrace_mute_security_problem',
  'dynatrace_unmute_security_problem',
  'dynatrace_mute_security_problems',
  'dynatrace_unmute_security_problems',
]

/**
 * Operations that mute. Unmuting is deliberately excluded: Dynatrace accepts
 * exactly one unmute reason (`AFFECTED`), so the block sends it itself rather
 * than offering a choice that would only ever be wrong.
 */
const MUTE_ONLY_OPERATIONS = ['dynatrace_mute_security_problem', 'dynatrace_mute_security_problems']

/** The only `reason` the Dynatrace unmute endpoints accept. */
const UNMUTE_REASON = 'AFFECTED'

/** Operations that take the full SLO definition. */
const SLO_WRITE_OPERATIONS = ['dynatrace_create_slo', 'dynatrace_update_slo']

/** Operations that take a settings object ID. */
const SETTINGS_OBJECT_ID_OPERATIONS = [
  'dynatrace_get_settings_object',
  'dynatrace_update_settings_object',
  'dynatrace_delete_settings_object',
]

export const DynatraceBlock: BlockConfig<DynatraceResponse> = {
  type: 'dynatrace',
  name: 'Dynatrace',
  description: 'Manage Dynatrace problems, metrics, entities, logs, SLOs, settings, and security',
  longDescription:
    'Integrate Dynatrace into workflows. Investigate and close Davis problems, query metrics and monitored entities, search and ingest logs, push deployment events, manage SLOs and their burn rates, triage and mute Application Security vulnerabilities, review runtime attacks, tag entities, manage settings objects such as maintenance windows and alerting profiles, run synthetic monitors on demand, and read the audit log.',
  docsLink: 'https://docs.sim.ai/integrations/dynatrace',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#FFFFFF',
  icon: DynatraceIcon,
  authMode: AuthMode.ApiKey,

  canvasPresentation: {
    defaultTitle: 'Dynatrace',
    sentences: {
      byOperation: {
        dynatrace_list_problems: [
          { text: 'List problems in', field: 'environmentUrl', core: true },
          { text: 'matching', field: 'problemSelector' },
        ],
        dynatrace_get_problem: [{ text: 'Get problem', field: 'problemId', core: true }],
        dynatrace_close_problem: [
          { text: 'Close problem', field: 'problemId', core: true },
          { text: 'with', field: 'message' },
        ],
        dynatrace_list_problem_comments: [
          { text: 'List comments on problem', field: 'problemId', core: true },
        ],
        dynatrace_add_problem_comment: [
          { text: 'Comment', field: 'message', core: true },
          { text: 'on problem', field: 'problemId', core: true },
        ],
        dynatrace_get_problem_comment: [
          { text: 'Get comment', field: 'commentId', core: true },
          { text: 'on problem', field: 'problemId', core: true },
        ],
        dynatrace_update_problem_comment: [
          { text: 'Update comment', field: 'commentId', core: true },
          { text: 'to', field: 'message', core: true },
        ],
        dynatrace_delete_problem_comment: [
          { text: 'Delete comment', field: 'commentId', core: true },
          { text: 'on problem', field: 'problemId', core: true },
        ],
        dynatrace_query_metrics: [
          { text: 'Query metrics', field: 'metricSelector', core: true },
          { text: 'for', field: 'entitySelector' },
        ],
        dynatrace_list_metrics: [
          { text: 'List metrics in', field: 'environmentUrl', core: true },
          { text: 'matching', field: 'text' },
        ],
        dynatrace_get_metric: [
          { text: 'Get the descriptor for metric', field: 'metricKey', core: true },
        ],
        dynatrace_ingest_metrics: [{ text: 'Ingest metrics', field: 'metricPayload', core: true }],
        dynatrace_list_entities: [
          { text: 'List entities matching', field: 'entitySelector', core: true },
        ],
        dynatrace_get_entity: [{ text: 'Get entity', field: 'entityId', core: true }],
        dynatrace_list_entity_types: [
          { text: 'List entity types in', field: 'environmentUrl', core: true },
        ],
        dynatrace_list_events: [
          { text: 'List events in', field: 'environmentUrl', core: true },
          { text: 'matching', field: 'eventSelector' },
        ],
        dynatrace_get_event: [{ text: 'Get event', field: 'eventId', core: true }],
        dynatrace_ingest_event: [
          { text: 'Ingest', field: 'eventType', core: true },
          { text: 'event', field: 'title', core: true },
        ],
        dynatrace_search_logs: [
          { text: 'Search logs in', field: 'environmentUrl', core: true },
          { text: 'for', field: 'logQuery' },
        ],
        dynatrace_ingest_logs: [{ text: 'Ingest logs', field: 'logs', core: true }],
        dynatrace_list_slos: [
          { text: 'List SLOs in', field: 'environmentUrl', core: true },
          { text: 'matching', field: 'sloSelector' },
        ],
        dynatrace_get_slo: [{ text: 'Get SLO', field: 'sloId', core: true }],
        dynatrace_create_slo: [
          { text: 'Create SLO', field: 'sloName', core: true },
          { text: 'targeting', field: 'sloTarget', core: true },
        ],
        dynatrace_update_slo: [
          { text: 'Update SLO', field: 'sloId', core: true },
          { text: 'to target', field: 'sloTarget' },
        ],
        dynatrace_delete_slo: [{ text: 'Delete SLO', field: 'sloId', core: true }],
        dynatrace_list_security_problems: [
          { text: 'List security problems in', field: 'environmentUrl', core: true },
          { text: 'matching', field: 'securityProblemSelector' },
        ],
        dynatrace_get_security_problem: [
          { text: 'Get security problem', field: 'securityProblemId', core: true },
        ],
        dynatrace_mute_security_problem: [
          { text: 'Mute security problem', field: 'securityProblemId', core: true },
          { text: 'as', field: 'muteReason', core: true },
        ],
        /* Unmuting takes no reason — Dynatrace accepts exactly one, so the field
           is scoped to the mute operations and naming it here paints nothing. */
        dynatrace_unmute_security_problem: [
          { text: 'Unmute security problem', field: 'securityProblemId', core: true },
        ],
        dynatrace_mute_security_problems: [
          { text: 'Mute security problems', field: 'securityProblemIds', core: true },
          { text: 'as', field: 'muteReason', core: true },
        ],
        /* Unmuting takes no reason — Dynatrace accepts exactly one, so the field
           is scoped to the mute operations and naming it here paints nothing. */
        dynatrace_unmute_security_problems: [
          { text: 'Unmute security problems', field: 'securityProblemIds', core: true },
        ],
        dynatrace_list_remediation_items: [
          { text: 'List remediation items for security problem', field: 'securityProblemId' },
          { text: 'matching', field: 'remediationItemSelector', core: true },
        ],
        dynatrace_list_attacks: [
          { text: 'List attacks in', field: 'environmentUrl', core: true },
          { text: 'matching', field: 'attackSelector' },
        ],
        dynatrace_get_attack: [{ text: 'Get attack', field: 'attackId', core: true }],
        dynatrace_list_tags: [{ text: 'List tags on', field: 'entitySelector', core: true }],
        dynatrace_add_tags: [
          { text: 'Add tags', field: 'tags', core: true },
          { text: 'to', field: 'entitySelector', core: true },
        ],
        dynatrace_delete_tag: [
          { text: 'Delete tag', field: 'tagKey', core: true },
          { text: 'from', field: 'entitySelector', core: true },
        ],
        dynatrace_list_settings_schemas: [
          { text: 'List settings schemas in', field: 'environmentUrl', core: true },
        ],
        dynatrace_list_settings_objects: [
          { text: 'List settings objects for schemas', field: 'schemaIds', core: true },
          { text: 'in scopes', field: 'scopes' },
        ],
        dynatrace_get_settings_object: [
          { text: 'Get settings object', field: 'objectId', core: true },
        ],
        dynatrace_create_settings_object: [
          { text: 'Create', field: 'schemaId', core: true },
          { text: 'settings object in', field: 'scope', core: true },
        ],
        dynatrace_update_settings_object: [
          { text: 'Update settings object', field: 'objectId', core: true },
          { text: 'to', field: 'settingsValue' },
        ],
        dynatrace_delete_settings_object: [
          { text: 'Delete settings object', field: 'objectId', core: true },
        ],
        dynatrace_list_synthetic_monitors: [
          { text: 'List synthetic monitors in', field: 'environmentUrl', core: true },
        ],
        dynatrace_execute_synthetic_monitors: [
          { text: 'Execute synthetic monitors', field: 'monitors', core: true },
        ],
        dynatrace_get_synthetic_batch: [
          { text: 'Get synthetic batch', field: 'batchId', core: true },
        ],
        dynatrace_get_audit_logs: [
          { text: 'Get audit logs from', field: 'environmentUrl', core: true },
          { text: 'matching', field: 'auditFilter' },
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
        { label: 'List Problems', id: 'dynatrace_list_problems' },
        { label: 'Get Problem', id: 'dynatrace_get_problem' },
        { label: 'Close Problem', id: 'dynatrace_close_problem' },
        { label: 'List Problem Comments', id: 'dynatrace_list_problem_comments' },
        { label: 'Add Problem Comment', id: 'dynatrace_add_problem_comment' },
        { label: 'Query Metrics', id: 'dynatrace_query_metrics' },
        { label: 'List Metrics', id: 'dynatrace_list_metrics' },
        { label: 'Get Metric Descriptor', id: 'dynatrace_get_metric' },
        { label: 'Ingest Metrics', id: 'dynatrace_ingest_metrics' },
        { label: 'List Entities', id: 'dynatrace_list_entities' },
        { label: 'Get Entity', id: 'dynatrace_get_entity' },
        { label: 'List Entity Types', id: 'dynatrace_list_entity_types' },
        { label: 'List Events', id: 'dynatrace_list_events' },
        { label: 'Get Event', id: 'dynatrace_get_event' },
        { label: 'Ingest Event', id: 'dynatrace_ingest_event' },
        { label: 'Search Logs', id: 'dynatrace_search_logs' },
        { label: 'Ingest Logs', id: 'dynatrace_ingest_logs' },
        { label: 'List SLOs', id: 'dynatrace_list_slos' },
        { label: 'Get SLO', id: 'dynatrace_get_slo' },
        { label: 'List Security Problems', id: 'dynatrace_list_security_problems' },
        { label: 'Get Security Problem', id: 'dynatrace_get_security_problem' },
        { label: 'Mute Security Problem', id: 'dynatrace_mute_security_problem' },
        { label: 'Unmute Security Problem', id: 'dynatrace_unmute_security_problem' },
        { label: 'Mute Security Problems (Bulk)', id: 'dynatrace_mute_security_problems' },
        { label: 'Unmute Security Problems (Bulk)', id: 'dynatrace_unmute_security_problems' },
        { label: 'List Remediation Items', id: 'dynatrace_list_remediation_items' },
        { label: 'List Attacks', id: 'dynatrace_list_attacks' },
        { label: 'Get Attack', id: 'dynatrace_get_attack' },
        { label: 'List Tags', id: 'dynatrace_list_tags' },
        { label: 'Add Tags', id: 'dynatrace_add_tags' },
        { label: 'Delete Tag', id: 'dynatrace_delete_tag' },
        { label: 'List Settings Schemas', id: 'dynatrace_list_settings_schemas' },
        { label: 'List Settings Objects', id: 'dynatrace_list_settings_objects' },
        { label: 'Get Settings Object', id: 'dynatrace_get_settings_object' },
        { label: 'Create Settings Object', id: 'dynatrace_create_settings_object' },
        { label: 'Update Settings Object', id: 'dynatrace_update_settings_object' },
        { label: 'Delete Settings Object', id: 'dynatrace_delete_settings_object' },
        { label: 'List Synthetic Monitors', id: 'dynatrace_list_synthetic_monitors' },
        { label: 'Execute Synthetic Monitors', id: 'dynatrace_execute_synthetic_monitors' },
        { label: 'Get Synthetic Batch', id: 'dynatrace_get_synthetic_batch' },
        { label: 'Get Problem Comment', id: 'dynatrace_get_problem_comment' },
        { label: 'Update Problem Comment', id: 'dynatrace_update_problem_comment' },
        { label: 'Delete Problem Comment', id: 'dynatrace_delete_problem_comment' },
        { label: 'Create SLO', id: 'dynatrace_create_slo' },
        { label: 'Update SLO', id: 'dynatrace_update_slo' },
        { label: 'Delete SLO', id: 'dynatrace_delete_slo' },
        { label: 'Get Audit Logs', id: 'dynatrace_get_audit_logs' },
      ],
      value: () => 'dynatrace_list_problems',
    },

    {
      id: 'environmentUrl',
      title: 'Environment URL',
      type: 'short-input',
      placeholder: 'https://abc12345.live.dynatrace.com',
      required: true,
    },
    {
      id: 'apiToken',
      title: 'Access Token',
      type: 'short-input',
      placeholder: 'dt0c01...',
      password: true,
      required: true,
    },

    {
      id: 'problemId',
      title: 'Problem ID',
      type: 'short-input',
      placeholder: '-1234567890123456789_1700000000000V2',
      required: true,
      condition: { field: 'operation', value: PROBLEM_ID_OPERATIONS },
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Enter the comment ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'dynatrace_get_problem_comment',
          'dynatrace_update_problem_comment',
          'dynatrace_delete_problem_comment',
        ],
      },
    },
    {
      id: 'problemSelector',
      title: 'Problem Selector',
      type: 'short-input',
      placeholder: 'status("open"),severityLevel("AVAILABILITY")',
      condition: { field: 'operation', value: 'dynatrace_list_problems' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Dynatrace problem selector from the user's description.

Criteria are comma-separated and each takes quoted values in parentheses. Common criteria:
- status("open") or status("closed")
- severityLevel("AVAILABILITY"|"CUSTOM_ALERT"|"ERROR"|"INFO"|"MONITORING_UNAVAILABLE"|"PERFORMANCE"|"RESOURCE_CONTENTION")
- impactLevel("APPLICATION"|"ENVIRONMENT"|"INFRASTRUCTURE"|"SERVICES")
- managementZones("Production")
- problemFilterNames("Critical alerts")
- text("checkout")

Examples:
- "open availability problems" -> status("open"),severityLevel("AVAILABILITY")
- "closed service performance problems" -> status("closed"),severityLevel("PERFORMANCE"),impactLevel("SERVICES")

Return ONLY the selector string - no explanations, no surrounding quotes.`,
        placeholder: 'Describe the problems you want to find...',
      },
    },
    {
      id: 'problemSort',
      title: 'Sort',
      type: 'dropdown',
      options: [
        { label: 'Newest first', id: '-startTime' },
        { label: 'Oldest first', id: '+startTime' },
        { label: 'Relevance', id: '-relevance' },
        { label: 'Status', id: 'status' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_problems' },
    },
    {
      id: 'problemFields',
      title: 'Additional Fields',
      type: 'short-input',
      placeholder: 'evidenceDetails,impactAnalysis,recentComments',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['dynatrace_list_problems', 'dynatrace_get_problem'],
      },
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Resolved by rolling back release 4.12.1',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'dynatrace_close_problem',
          'dynatrace_add_problem_comment',
          'dynatrace_update_problem_comment',
        ],
      },
    },
    {
      id: 'commentContext',
      title: 'Comment Context',
      type: 'short-input',
      placeholder: 'Sim workflow',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['dynatrace_add_problem_comment', 'dynatrace_update_problem_comment'],
      },
    },

    {
      id: 'metricSelector',
      title: 'Metric Selector',
      type: 'short-input',
      placeholder: 'builtin:host.cpu.usage:avg',
      required: { field: 'operation', value: 'dynatrace_query_metrics' },
      condition: {
        field: 'operation',
        value: ['dynatrace_query_metrics', 'dynatrace_list_metrics'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Dynatrace metric selector from the user's description.

A metric selector is a metric key, optionally followed by transformation operators separated by colons.
Common builtin metric keys: builtin:host.cpu.usage, builtin:host.mem.usage, builtin:host.disk.usedPct,
builtin:service.response.time, builtin:service.errors.total.rate, builtin:apps.web.actionCount.load.
Common transformations: :avg, :max, :min, :sum, :count, :percentile(90), :names, :splitBy("dt.entity.host"), :sort(value(avg,descending)), :limit(10)

Examples:
- "average CPU usage per host" -> builtin:host.cpu.usage:splitBy("dt.entity.host"):avg:names
- "top 10 slowest services" -> builtin:service.response.time:splitBy("dt.entity.service"):avg:sort(value(avg,descending)):limit(10):names

Return ONLY the selector string - no explanations, no surrounding quotes.`,
        placeholder: 'Describe the metric you want...',
      },
    },
    {
      id: 'resolution',
      title: 'Resolution',
      type: 'short-input',
      placeholder: '10m, 120, or Inf',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_query_metrics' },
    },
    {
      id: 'mzSelector',
      title: 'Management Zone Selector',
      type: 'short-input',
      placeholder: 'mzName("Production")',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_query_metrics' },
    },
    {
      id: 'metricKey',
      title: 'Metric Key',
      type: 'short-input',
      placeholder: 'builtin:host.cpu.usage',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_get_metric' },
    },
    {
      id: 'text',
      title: 'Search Text',
      type: 'short-input',
      placeholder: 'cpu',
      condition: { field: 'operation', value: 'dynatrace_list_metrics' },
    },
    {
      id: 'metadataSelector',
      title: 'Metadata Selector',
      type: 'short-input',
      placeholder: 'unit("Percent"),tags("dashboard")',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_metrics' },
    },
    {
      id: 'metricFields',
      title: 'Additional Fields',
      type: 'short-input',
      placeholder: '+aggregationTypes,-description',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_metrics' },
    },
    {
      id: 'writtenSince',
      title: 'Written Since',
      type: 'short-input',
      placeholder: 'now-7d',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_metrics' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Dynatrace timeframe value: UTC milliseconds, an ISO 8601 timestamp, or a relative expression such as now-7d. Return ONLY the value.',
        generationType: 'timestamp',
        placeholder: 'Describe the point in time...',
      },
    },
    {
      id: 'writtenSinceMode',
      title: 'Written Since Mode',
      type: 'dropdown',
      options: [
        { label: 'Include metrics written since', id: 'INCLUDE' },
        { label: 'Exclude metrics written since', id: 'EXCLUDE' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_metrics' },
    },
    {
      id: 'metricPayload',
      title: 'Metric Lines',
      type: 'long-input',
      placeholder: 'cpu.temperature,dt.entity.host=HOST-06F288EE2A930951,cpu=1 55',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_ingest_metrics' },
    },

    {
      id: 'entitySelector',
      title: 'Entity Selector',
      type: 'short-input',
      placeholder: 'type("HOST"),tag("env:prod")',
      required: { field: 'operation', value: ENTITY_SELECTOR_REQUIRED_OPERATIONS },
      condition: { field: 'operation', value: ENTITY_SELECTOR_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Dynatrace entity selector from the user's description.

Criteria are comma-separated and each takes quoted values in parentheses. Common criteria:
- type("HOST"|"SERVICE"|"APPLICATION"|"PROCESS_GROUP"|"PROCESS_GROUP_INSTANCE"|"KUBERNETES_CLUSTER"|"CLOUD_APPLICATION")
- entityId("HOST-06F288EE2A930951")
- entityName.equals("checkout-service") or entityName.contains("checkout")
- tag("env:prod") or tag("[AWS]Environment:production")
- mzName("Production")
- healthState("UNHEALTHY")

Examples:
- "production hosts" -> type("HOST"),tag("env:prod")
- "unhealthy services named checkout" -> type("SERVICE"),entityName.contains("checkout"),healthState("UNHEALTHY")

Return ONLY the selector string - no explanations, no surrounding quotes.`,
        placeholder: 'Describe the entities you want...',
      },
    },
    {
      id: 'entityId',
      title: 'Entity ID',
      type: 'short-input',
      placeholder: 'HOST-06F288EE2A930951',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_get_entity' },
    },
    {
      id: 'entityFields',
      title: 'Additional Fields',
      type: 'short-input',
      placeholder: '+lastSeenTms,+properties.BITNESS,+tags',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['dynatrace_list_entities', 'dynatrace_get_entity'],
      },
    },
    {
      id: 'entitySort',
      title: 'Sort',
      type: 'dropdown',
      options: [
        { label: 'Name ascending', id: '+displayName' },
        { label: 'Name descending', id: '-displayName' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_entities' },
    },

    {
      id: 'eventSelector',
      title: 'Event Selector',
      type: 'short-input',
      placeholder: 'eventType("CUSTOM_DEPLOYMENT"),status("OPEN")',
      condition: { field: 'operation', value: 'dynatrace_list_events' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Dynatrace event selector from the user's description.

Criteria are comma-separated and each takes quoted values in parentheses. Common criteria:
- eventType("CUSTOM_DEPLOYMENT"|"CUSTOM_ANNOTATION"|"CUSTOM_INFO"|"CUSTOM_ALERT"|"ERROR_EVENT"|"AVAILABILITY_EVENT"|"PERFORMANCE_EVENT"|"RESOURCE_CONTENTION_EVENT"|"MARKED_FOR_TERMINATION")
- status("OPEN"|"CLOSED")
- correlationId("build-42")
- eventId("...")
- managementZoneIds(...)

Examples:
- "open deployment events" -> eventType("CUSTOM_DEPLOYMENT"),status("OPEN")
- "closed error events" -> eventType("ERROR_EVENT"),status("CLOSED")

Return ONLY the selector string - no explanations, no surrounding quotes.`,
        placeholder: 'Describe the events you want...',
      },
    },
    {
      id: 'eventId',
      title: 'Event ID',
      type: 'short-input',
      placeholder: 'Enter the event ID',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_get_event' },
    },
    {
      id: 'eventType',
      title: 'Event Type',
      type: 'dropdown',
      options: [
        { label: 'Custom Deployment', id: 'CUSTOM_DEPLOYMENT' },
        { label: 'Custom Annotation', id: 'CUSTOM_ANNOTATION' },
        { label: 'Custom Info', id: 'CUSTOM_INFO' },
        { label: 'Custom Alert', id: 'CUSTOM_ALERT' },
        { label: 'Custom Configuration', id: 'CUSTOM_CONFIGURATION' },
        { label: 'Availability Event', id: 'AVAILABILITY_EVENT' },
        { label: 'Error Event', id: 'ERROR_EVENT' },
        { label: 'Performance Event', id: 'PERFORMANCE_EVENT' },
        { label: 'Resource Contention Event', id: 'RESOURCE_CONTENTION_EVENT' },
        { label: 'Marked For Termination', id: 'MARKED_FOR_TERMINATION' },
        { label: 'Warning', id: 'WARNING' },
      ],
      required: true,
      condition: { field: 'operation', value: 'dynatrace_ingest_event' },
      value: () => 'CUSTOM_DEPLOYMENT',
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Deployed checkout-service 4.12.2',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_ingest_event' },
    },
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'UTC milliseconds',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_ingest_event' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Unix timestamp in UTC milliseconds for the moment described. Return ONLY the number.',
        generationType: 'timestamp',
        placeholder: 'Describe the start time...',
      },
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      placeholder: 'UTC milliseconds',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_ingest_event' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Unix timestamp in UTC milliseconds for the moment described. Return ONLY the number.',
        generationType: 'timestamp',
        placeholder: 'Describe the end time...',
      },
    },
    {
      id: 'eventTimeout',
      title: 'Timeout (minutes)',
      type: 'short-input',
      placeholder: '15',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_ingest_event' },
    },
    {
      id: 'eventProperties',
      title: 'Properties',
      type: 'long-input',
      placeholder: '{ "version": "4.12.2", "ci.pipeline": "deploy-prod" }',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_ingest_event' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a flat JSON object of Dynatrace event properties. Keys and values must be strings, max 100 entries. Return ONLY the JSON object.',
        generationType: 'json-object',
        placeholder: 'Describe the event properties...',
      },
    },

    {
      id: 'logQuery',
      title: 'Log Query',
      type: 'long-input',
      placeholder: 'status="ERROR" AND dt.entity.host="HOST-06F288EE2A930951"',
      condition: { field: 'operation', value: 'dynatrace_search_logs' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Dynatrace log search query from the user's description.

The query language matches log attributes with operators AND, OR, NOT, =, !=, and wildcards with *.
Common attributes: status ("ERROR", "WARN", "INFO"), content, loglevel, dt.entity.host, dt.entity.process_group,
k8s.namespace.name, k8s.pod.name, host.name, service.name, log.source.

Examples:
- "errors from the checkout service" -> status="ERROR" AND service.name="checkout"
- "timeouts in the payments namespace" -> k8s.namespace.name="payments" AND content="*timeout*"

Return ONLY the query string - no explanations, no surrounding quotes.`,
        placeholder: 'Describe the logs you want to find...',
      },
    },
    {
      id: 'logSort',
      title: 'Sort',
      type: 'dropdown',
      options: [
        { label: 'Newest first', id: '-timestamp' },
        { label: 'Oldest first', id: '+timestamp' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_search_logs' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '1000',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_search_logs' },
    },
    {
      id: 'nextSliceKey',
      title: 'Next Slice Key',
      type: 'short-input',
      placeholder: 'Cursor from a previous search',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_search_logs' },
    },
    {
      id: 'logs',
      title: 'Log Events',
      type: 'long-input',
      placeholder: '[{ "content": "Deploy finished", "severity": "info", "service": "checkout" }]',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_ingest_logs' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Dynatrace log events. Each object may use content, timestamp, and severity; any other key becomes a custom attribute. Return ONLY the JSON array.',
        generationType: 'json-object',
        placeholder: 'Describe the log events to send...',
      },
    },

    {
      id: 'sloSelector',
      title: 'SLO Selector',
      type: 'short-input',
      placeholder: 'healthState("WARNING")',
      condition: { field: 'operation', value: 'dynatrace_list_slos' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Dynatrace SLO selector from the user's description.

Criteria are comma-separated and each takes quoted values in parentheses. Common criteria:
- healthState("SUCCESS"|"WARNING"|"FAILURE")
- text("checkout")
- problems("true"|"false")
- managementZones("Production")
- id("...")
- name("...")

Examples:
- "failing SLOs" -> healthState("FAILURE")
- "checkout SLOs with open problems" -> text("checkout"),problems("true")

Return ONLY the selector string - no explanations, no surrounding quotes.`,
        placeholder: 'Describe the SLOs you want...',
      },
    },
    {
      id: 'sloId',
      title: 'SLO ID',
      type: 'short-input',
      placeholder: 'Enter the SLO ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['dynatrace_get_slo', 'dynatrace_update_slo', 'dynatrace_delete_slo'],
      },
    },
    {
      id: 'timeFrame',
      title: 'Evaluation Timeframe',
      type: 'dropdown',
      options: [
        { label: "The SLO's own timeframe (CURRENT)", id: 'CURRENT' },
        { label: 'The From/To range (GTF)', id: 'GTF' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['dynatrace_list_slos', 'dynatrace_get_slo'],
      },
    },
    {
      id: 'sloSort',
      title: 'Sort',
      type: 'dropdown',
      options: [
        { label: 'Name ascending', id: 'name' },
        { label: 'Name descending', id: '-name' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_slos' },
    },
    {
      id: 'enabledSlos',
      title: 'Enabled State',
      type: 'dropdown',
      options: [
        { label: 'Enabled only', id: 'true' },
        { label: 'Disabled only', id: 'false' },
        { label: 'All', id: 'all' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_slos' },
    },
    {
      id: 'evaluate',
      title: 'Evaluate SLOs',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_slos' },
    },
    {
      id: 'showGlobalSlos',
      title: 'Include Global SLOs',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_slos' },
    },

    {
      id: 'securityProblemSelector',
      title: 'Security Problem Selector',
      type: 'short-input',
      placeholder: 'status("OPEN"),riskLevel("CRITICAL")',
      condition: { field: 'operation', value: 'dynatrace_list_security_problems' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Dynatrace security problem selector from the user's description.

Criteria are comma-separated and each takes quoted values in parentheses. Common criteria:
- status("OPEN"|"RESOLVED")
- riskLevel("CRITICAL"|"HIGH"|"MEDIUM"|"LOW"|"NONE")
- technology("JAVA"|"DOTNET"|"GO"|"NODE_JS"|"PHP"|"PYTHON"|"KUBERNETES")
- vulnerabilityType("CODE_LEVEL"|"RUNTIME"|"THIRD_PARTY")
- cveId("CVE-2021-44228")
- muted("true"|"false")
- externalVulnerabilityId("...")

Examples:
- "open critical Java vulnerabilities" -> status("OPEN"),riskLevel("CRITICAL"),technology("JAVA")
- "unresolved Log4Shell" -> status("OPEN"),cveId("CVE-2021-44228")

Return ONLY the selector string - no explanations, no surrounding quotes.`,
        placeholder: 'Describe the vulnerabilities you want...',
      },
    },
    {
      id: 'securityProblemId',
      title: 'Security Problem ID',
      type: 'short-input',
      placeholder: 'Enter the security problem ID',
      required: true,
      condition: { field: 'operation', value: SECURITY_PROBLEM_ID_OPERATIONS },
    },
    {
      id: 'securityFields',
      title: 'Additional Fields',
      type: 'short-input',
      placeholder: '+riskAssessment,+managementZones,+globalCounts',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['dynatrace_list_security_problems', 'dynatrace_get_security_problem'],
      },
    },
    {
      id: 'securitySort',
      title: 'Sort',
      type: 'short-input',
      placeholder: '-riskAssessment.riskScore',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_security_problems' },
    },
    {
      id: 'managementZoneFilter',
      title: 'Management Zone Filter',
      type: 'short-input',
      placeholder: 'names("Production")',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_get_security_problem' },
    },

    {
      id: 'auditFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'eventType("UPDATE"),user("someone@example.com")',
      condition: { field: 'operation', value: 'dynatrace_get_audit_logs' },
    },
    {
      id: 'auditSort',
      title: 'Sort',
      type: 'dropdown',
      options: [
        { label: 'Newest first', id: '-timestamp' },
        { label: 'Oldest first', id: 'timestamp' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_get_audit_logs' },
    },

    {
      id: 'securityProblemIds',
      title: 'Security Problem IDs',
      type: 'long-input',
      placeholder: 'S-1234, S-5678',
      required: true,
      condition: {
        field: 'operation',
        value: ['dynatrace_mute_security_problems', 'dynatrace_unmute_security_problems'],
      },
    },
    {
      id: 'muteReason',
      title: 'Reason',
      type: 'dropdown',
      options: [
        { label: 'False positive', id: 'FALSE_POSITIVE' },
        { label: 'Configuration not affected', id: 'CONFIGURATION_NOT_AFFECTED' },
        { label: 'Vulnerable code not in use', id: 'VULNERABLE_CODE_NOT_IN_USE' },
        { label: 'Ignore', id: 'IGNORE' },
        { label: 'Other', id: 'OTHER' },
      ],
      required: true,
      condition: { field: 'operation', value: MUTE_ONLY_OPERATIONS },
      value: () => 'FALSE_POSITIVE',
    },
    {
      id: 'muteComment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Not reachable from the public network',
      condition: { field: 'operation', value: MUTE_OPERATIONS },
    },
    {
      id: 'remediationItemSelector',
      title: 'Remediation Item Selector',
      type: 'short-input',
      placeholder: 'vulnerabilityState("VULNERABLE"),muted("false")',
      condition: { field: 'operation', value: 'dynatrace_list_remediation_items' },
    },

    {
      id: 'attackSelector',
      title: 'Attack Selector',
      type: 'short-input',
      placeholder: 'state("EXPLOITED"),attackType("SQL_INJECTION")',
      condition: { field: 'operation', value: 'dynatrace_list_attacks' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Dynatrace attack selector from the user's description.

Criteria are comma-separated and each takes quoted values in parentheses. Common criteria:
- state("EXPLOITED"|"BLOCKED"|"ALLOWLISTED")
- attackType("SQL_INJECTION"|"COMMAND_INJECTION"|"JNDI_INJECTION"|"SSRF")
- technology("JAVA"|"DOTNET"|"GO"|"NODE_JS")
- sourceIps("1.2.3.4")
- managementZones("Production")

Examples:
- "successful SQL injections" -> state("EXPLOITED"),attackType("SQL_INJECTION")
- "blocked attacks on Java services" -> state("BLOCKED"),technology("JAVA")

Return ONLY the selector string - no explanations, no surrounding quotes.`,
        placeholder: 'Describe the attacks you want...',
      },
    },
    {
      id: 'attackId',
      title: 'Attack ID',
      type: 'short-input',
      placeholder: 'Enter the attack ID',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_get_attack' },
    },
    {
      id: 'attackFields',
      title: 'Additional Fields',
      type: 'short-input',
      placeholder: '+attackTarget,+request,+attacker',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['dynatrace_list_attacks', 'dynatrace_get_attack'],
      },
    },
    {
      id: 'attackSort',
      title: 'Sort',
      type: 'short-input',
      placeholder: '-timestamp',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_attacks' },
    },

    {
      id: 'tags',
      title: 'Tags',
      type: 'long-input',
      placeholder: '[{ "key": "owner", "value": "platform" }]',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_add_tags' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Dynatrace tags. Each entry is an object with a required "key" and an optional "value". Return ONLY the JSON array.',
        generationType: 'json-object',
        placeholder: 'Describe the tags to add...',
      },
    },
    {
      id: 'tagKey',
      title: 'Tag Key',
      type: 'short-input',
      placeholder: 'owner',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_delete_tag' },
    },
    {
      id: 'tagValue',
      title: 'Tag Value',
      type: 'short-input',
      placeholder: 'platform',
      condition: { field: 'operation', value: 'dynatrace_delete_tag' },
    },
    {
      id: 'deleteAllWithKey',
      title: 'Delete Every Value Of This Key',
      type: 'switch',
      condition: { field: 'operation', value: 'dynatrace_delete_tag' },
    },

    {
      id: 'schemaFields',
      title: 'Additional Fields',
      type: 'short-input',
      placeholder: 'schemaId,displayName,latestSchemaVersion',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_settings_schemas' },
    },
    {
      id: 'schemaIds',
      title: 'Schema IDs',
      type: 'short-input',
      placeholder: 'builtin:alerting.profile',
      condition: { field: 'operation', value: 'dynatrace_list_settings_objects' },
    },
    {
      id: 'scopes',
      title: 'Scopes',
      type: 'short-input',
      placeholder: 'environment',
      condition: { field: 'operation', value: 'dynatrace_list_settings_objects' },
    },
    {
      id: 'externalIds',
      title: 'External IDs',
      type: 'short-input',
      placeholder: 'Comma-separated external IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_settings_objects' },
    },
    {
      id: 'settingsFields',
      title: 'Additional Fields',
      type: 'short-input',
      placeholder: 'objectId,value,schemaId,scope,updateToken',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_settings_objects' },
    },
    {
      id: 'settingsFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'modifiedBy("someone@example.com")',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_settings_objects' },
    },
    {
      id: 'settingsSort',
      title: 'Sort',
      type: 'short-input',
      placeholder: '-modified',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_settings_objects' },
    },
    {
      id: 'objectId',
      title: 'Settings Object ID',
      type: 'short-input',
      placeholder: 'Enter the settings object ID',
      required: true,
      condition: { field: 'operation', value: SETTINGS_OBJECT_ID_OPERATIONS },
    },
    {
      id: 'schemaId',
      title: 'Schema ID',
      type: 'short-input',
      placeholder: 'builtin:alerting.maintenance-window',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_create_settings_object' },
    },
    {
      id: 'scope',
      title: 'Scope',
      type: 'short-input',
      placeholder: 'environment',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_create_settings_object' },
    },
    {
      id: 'settingsValue',
      title: 'Value',
      type: 'long-input',
      placeholder: '{ "enabled": true, "generalProperties": { "name": "Deploy window" } }',
      required: true,
      condition: {
        field: 'operation',
        value: ['dynatrace_create_settings_object', 'dynatrace_update_settings_object'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate the JSON value of a Dynatrace settings object. The shape is defined by its schema, so mirror the structure of an existing object of the same schema. Return ONLY the JSON object.',
        generationType: 'json-object',
        placeholder: 'Describe the configuration...',
      },
    },
    {
      id: 'schemaVersion',
      title: 'Schema Version',
      type: 'short-input',
      placeholder: 'Defaults to the latest',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['dynatrace_create_settings_object', 'dynatrace_update_settings_object'],
      },
    },
    {
      id: 'settingsExternalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'Correlate with a system outside Dynatrace',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_create_settings_object' },
    },
    {
      id: 'updateToken',
      title: 'Update Token',
      type: 'short-input',
      placeholder: 'From Get Settings Object — guards against a concurrent change',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['dynatrace_update_settings_object', 'dynatrace_delete_settings_object'],
      },
    },
    {
      id: 'validateOnly',
      title: 'Validate Only',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['dynatrace_create_settings_object', 'dynatrace_update_settings_object'],
      },
    },

    {
      id: 'monitorType',
      title: 'Monitor Type',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Browser', id: 'BROWSER' },
        { label: 'HTTP', id: 'HTTP' },
      ],
      condition: { field: 'operation', value: 'dynatrace_list_synthetic_monitors' },
    },
    {
      // A tri-state filter, not a boolean: leaving it unset must send no
      // `enabled` param at all. A switch would serialize its off position as
      // `enabled=false` and silently return only the disabled monitors.
      id: 'monitorEnabled',
      title: 'Enabled State',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Enabled only', id: 'true' },
        { label: 'Disabled only', id: 'false' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_synthetic_monitors' },
    },
    {
      id: 'monitorLocation',
      title: 'Location',
      type: 'short-input',
      placeholder: 'Synthetic location ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_synthetic_monitors' },
    },
    {
      id: 'monitorTag',
      title: 'Tag',
      type: 'short-input',
      placeholder: 'tag1, tag2 (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_synthetic_monitors' },
    },
    {
      id: 'monitorManagementZone',
      title: 'Management Zone ID',
      type: 'short-input',
      placeholder: 'Numeric management zone ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_list_synthetic_monitors' },
    },
    {
      id: 'monitors',
      title: 'Monitors',
      type: 'long-input',
      placeholder: '[{ "monitorId": "SYNTHETIC_TEST-123" }]',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_execute_synthetic_monitors' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Dynatrace synthetic monitors to execute. Each entry has a required "monitorId" and optional "locations" (array) and "executionCount" (max 10). Return ONLY the JSON array.',
        generationType: 'json-object',
        placeholder: 'Describe the monitors to run...',
      },
    },
    {
      id: 'processingMode',
      title: 'Processing Mode',
      type: 'dropdown',
      options: [
        { label: 'Standard', id: 'STANDARD' },
        { label: 'Disable problem detection', id: 'DISABLE_PROBLEM_DETECTION' },
        { label: 'Execution details only', id: 'EXECUTIONS_DETAILS_ONLY' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_execute_synthetic_monitors' },
    },
    {
      id: 'failOnPerformanceIssue',
      title: 'Fail On Performance Issue',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_execute_synthetic_monitors' },
    },
    {
      id: 'stopOnProblem',
      title: 'Stop On Problem',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_execute_synthetic_monitors' },
    },
    {
      id: 'takeScreenshotsOnSuccess',
      title: 'Screenshot Successful Runs',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_execute_synthetic_monitors' },
    },
    {
      id: 'batchMetadata',
      title: 'Metadata',
      type: 'long-input',
      placeholder: '{ "release": "4.12.2" }',
      mode: 'advanced',
      condition: { field: 'operation', value: 'dynatrace_execute_synthetic_monitors' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a flat JSON object of key-value metadata for a Dynatrace synthetic batch. Max 64 pairs. Return ONLY the JSON object.',
        generationType: 'json-object',
        placeholder: 'Describe the metadata...',
      },
    },
    {
      id: 'batchId',
      title: 'Batch ID',
      type: 'short-input',
      placeholder: 'Batch ID from Execute Synthetic Monitors',
      required: true,
      condition: { field: 'operation', value: 'dynatrace_get_synthetic_batch' },
    },

    {
      id: 'sloName',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Checkout availability',
      required: true,
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
    },
    {
      id: 'sloTarget',
      title: 'Target (%)',
      type: 'short-input',
      placeholder: '99.5',
      required: true,
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
    },
    {
      id: 'sloWarning',
      title: 'Warning (%)',
      type: 'short-input',
      placeholder: '99.8',
      required: true,
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
    },
    {
      id: 'sloTimeframe',
      title: 'Timeframe',
      type: 'short-input',
      placeholder: '-1w',
      required: true,
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
    },
    {
      id: 'sloEvaluationType',
      title: 'Evaluation Type',
      type: 'dropdown',
      options: [{ label: 'Aggregate', id: 'AGGREGATE' }],
      required: true,
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
      value: () => 'AGGREGATE',
    },
    {
      id: 'sloDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'What this SLO measures',
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
    },
    {
      id: 'sloMetricExpression',
      title: 'Metric Expression',
      type: 'long-input',
      placeholder:
        '(100)*(builtin:service.errors.total.successCount:splitBy())/(builtin:service.requestCount.total:splitBy())',
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
    },
    {
      id: 'sloFilter',
      title: 'Entity Filter',
      type: 'short-input',
      placeholder: 'type("SERVICE"),tag("env:prod")',
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
    },
    {
      id: 'sloEnabled',
      title: 'Enabled',
      type: 'switch',
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
    },
    {
      id: 'sloMetricName',
      title: 'Metric Name',
      type: 'short-input',
      placeholder: 'Display name for the SLO metric',
      mode: 'advanced',
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
    },
    {
      id: 'burnRateVisualizationEnabled',
      title: 'Show Burn Rate',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
    },
    {
      id: 'fastBurnThreshold',
      title: 'Fast Burn Threshold',
      type: 'short-input',
      placeholder: '10',
      mode: 'advanced',
      condition: { field: 'operation', value: SLO_WRITE_OPERATIONS },
    },

    {
      id: 'from',
      title: 'From',
      type: 'short-input',
      placeholder: 'now-2h',
      mode: 'advanced',
      condition: { field: 'operation', value: FROM_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Dynatrace timeframe start: UTC milliseconds, an ISO 8601 timestamp, or a relative expression such as now-2h or now-1d/d. Return ONLY the value.',
        generationType: 'timestamp',
        placeholder: 'Describe the start of the timeframe...',
      },
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      placeholder: 'now',
      mode: 'advanced',
      condition: { field: 'operation', value: TO_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Dynatrace timeframe end: UTC milliseconds, an ISO 8601 timestamp, or a relative expression such as now or now-5m. Return ONLY the value.',
        generationType: 'timestamp',
        placeholder: 'Describe the end of the timeframe...',
      },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Entries per page',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
    },
    {
      id: 'nextPageKey',
      title: 'Next Page Key',
      type: 'short-input',
      placeholder: 'Cursor from a previous response',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
    },
  ],

  tools: {
    access: [
      'dynatrace_list_problems',
      'dynatrace_get_problem',
      'dynatrace_close_problem',
      'dynatrace_list_problem_comments',
      'dynatrace_add_problem_comment',
      'dynatrace_query_metrics',
      'dynatrace_list_metrics',
      'dynatrace_get_metric',
      'dynatrace_ingest_metrics',
      'dynatrace_list_entities',
      'dynatrace_get_entity',
      'dynatrace_list_entity_types',
      'dynatrace_list_events',
      'dynatrace_get_event',
      'dynatrace_ingest_event',
      'dynatrace_search_logs',
      'dynatrace_ingest_logs',
      'dynatrace_list_slos',
      'dynatrace_get_slo',
      'dynatrace_list_security_problems',
      'dynatrace_get_security_problem',
      'dynatrace_get_audit_logs',
      'dynatrace_mute_security_problem',
      'dynatrace_unmute_security_problem',
      'dynatrace_mute_security_problems',
      'dynatrace_unmute_security_problems',
      'dynatrace_list_remediation_items',
      'dynatrace_list_attacks',
      'dynatrace_get_attack',
      'dynatrace_list_tags',
      'dynatrace_add_tags',
      'dynatrace_delete_tag',
      'dynatrace_list_settings_schemas',
      'dynatrace_list_settings_objects',
      'dynatrace_get_settings_object',
      'dynatrace_create_settings_object',
      'dynatrace_update_settings_object',
      'dynatrace_delete_settings_object',
      'dynatrace_list_synthetic_monitors',
      'dynatrace_execute_synthetic_monitors',
      'dynatrace_get_synthetic_batch',
      'dynatrace_get_problem_comment',
      'dynatrace_update_problem_comment',
      'dynatrace_delete_problem_comment',
      'dynatrace_create_slo',
      'dynatrace_update_slo',
      'dynatrace_delete_slo',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const baseParams: Record<string, unknown> = {
          environmentUrl: params.environmentUrl,
          apiToken: params.apiToken,
        }

        const toNumber = (value: unknown) =>
          value === undefined || value === null || value === '' ? undefined : Number(value)

        /**
         * Reads a tri-state filter whose "any" position must send no parameter
         * at all. The dropdown yields `''`, `'true'`, or `'false'`, but a real
         * boolean arrives when the field is wired from an upstream block.
         */
        const toOptionalBoolean = (value: unknown) => {
          if (typeof value === 'boolean') return value
          if (value === 'true') return true
          if (value === 'false') return false
          return undefined
        }

        const pagination = {
          pageSize: toNumber(params.pageSize),
          nextPageKey: params.nextPageKey || undefined,
        }

        // Create and update SLO take the identical definition.
        const sloWriteParams = {
          name: params.sloName,
          target: toNumber(params.sloTarget),
          warning: toNumber(params.sloWarning),
          timeframe: params.sloTimeframe,
          evaluationType: params.sloEvaluationType || 'AGGREGATE',
          description: params.sloDescription || undefined,
          enabled: params.sloEnabled,
          filter: params.sloFilter || undefined,
          metricExpression: params.sloMetricExpression || undefined,
          metricName: params.sloMetricName || undefined,
          burnRateVisualizationEnabled: params.burnRateVisualizationEnabled,
          fastBurnThreshold: toNumber(params.fastBurnThreshold),
        }

        switch (params.operation) {
          case 'dynatrace_list_problems':
            return {
              ...baseParams,
              ...pagination,
              from: params.from || undefined,
              to: params.to || undefined,
              problemSelector: params.problemSelector || undefined,
              entitySelector: params.entitySelector || undefined,
              sort: params.problemSort || undefined,
              fields: params.problemFields || undefined,
            }

          case 'dynatrace_get_problem':
            return {
              ...baseParams,
              problemId: params.problemId,
              fields: params.problemFields || undefined,
            }

          case 'dynatrace_close_problem':
            return { ...baseParams, problemId: params.problemId, message: params.message }

          case 'dynatrace_list_problem_comments':
            return { ...baseParams, ...pagination, problemId: params.problemId }

          case 'dynatrace_add_problem_comment':
            return {
              ...baseParams,
              problemId: params.problemId,
              message: params.message,
              context: params.commentContext || undefined,
            }

          case 'dynatrace_query_metrics':
            return {
              ...baseParams,
              metricSelector: params.metricSelector,
              from: params.from || undefined,
              to: params.to || undefined,
              resolution: params.resolution || undefined,
              entitySelector: params.entitySelector || undefined,
              mzSelector: params.mzSelector || undefined,
            }

          case 'dynatrace_list_metrics':
            return {
              ...baseParams,
              ...pagination,
              metricSelector: params.metricSelector || undefined,
              text: params.text || undefined,
              fields: params.metricFields || undefined,
              writtenSince: params.writtenSince || undefined,
              writtenSinceMode: params.writtenSinceMode || undefined,
              metadataSelector: params.metadataSelector || undefined,
            }

          case 'dynatrace_get_metric':
            return { ...baseParams, metricKey: params.metricKey }

          case 'dynatrace_ingest_metrics':
            return { ...baseParams, payload: params.metricPayload }

          case 'dynatrace_list_entities':
            return {
              ...baseParams,
              ...pagination,
              entitySelector: params.entitySelector,
              from: params.from || undefined,
              to: params.to || undefined,
              fields: params.entityFields || undefined,
              sort: params.entitySort || undefined,
            }

          case 'dynatrace_get_entity':
            return {
              ...baseParams,
              entityId: params.entityId,
              from: params.from || undefined,
              to: params.to || undefined,
              fields: params.entityFields || undefined,
            }

          case 'dynatrace_list_entity_types':
            return { ...baseParams, ...pagination }

          case 'dynatrace_list_events':
            return {
              ...baseParams,
              ...pagination,
              from: params.from || undefined,
              to: params.to || undefined,
              eventSelector: params.eventSelector || undefined,
              entitySelector: params.entitySelector || undefined,
            }

          case 'dynatrace_get_event':
            return { ...baseParams, eventId: params.eventId }

          case 'dynatrace_ingest_event':
            return {
              ...baseParams,
              eventType: params.eventType,
              title: params.title,
              entitySelector: params.entitySelector || undefined,
              startTime: toNumber(params.startTime),
              endTime: toNumber(params.endTime),
              eventTimeout: toNumber(params.eventTimeout),
              properties: params.eventProperties || undefined,
            }

          case 'dynatrace_search_logs':
            return {
              ...baseParams,
              query: params.logQuery || undefined,
              from: params.from || undefined,
              to: params.to || undefined,
              sort: params.logSort || undefined,
              limit: toNumber(params.limit),
              nextSliceKey: params.nextSliceKey || undefined,
            }

          case 'dynatrace_ingest_logs':
            return { ...baseParams, logs: params.logs }

          case 'dynatrace_list_slos':
            return {
              ...baseParams,
              ...pagination,
              sloSelector: params.sloSelector || undefined,
              from: params.from || undefined,
              to: params.to || undefined,
              timeFrame: params.timeFrame || undefined,
              sort: params.sloSort || undefined,
              enabledSlos: params.enabledSlos || undefined,
              evaluate: params.evaluate,
              showGlobalSlos: params.showGlobalSlos,
            }

          case 'dynatrace_get_slo':
            return {
              ...baseParams,
              sloId: params.sloId,
              from: params.from || undefined,
              to: params.to || undefined,
              timeFrame: params.timeFrame || undefined,
            }

          case 'dynatrace_list_security_problems':
            return {
              ...baseParams,
              ...pagination,
              securityProblemSelector: params.securityProblemSelector || undefined,
              from: params.from || undefined,
              to: params.to || undefined,
              fields: params.securityFields || undefined,
              sort: params.securitySort || undefined,
            }

          case 'dynatrace_get_security_problem':
            return {
              ...baseParams,
              securityProblemId: params.securityProblemId,
              fields: params.securityFields || undefined,
              managementZoneFilter: params.managementZoneFilter || undefined,
              from: params.from || undefined,
            }

          case 'dynatrace_get_audit_logs':
            return {
              ...baseParams,
              ...pagination,
              filter: params.auditFilter || undefined,
              from: params.from || undefined,
              to: params.to || undefined,
              sort: params.auditSort || undefined,
            }

          case 'dynatrace_mute_security_problem':
            return {
              ...baseParams,
              securityProblemId: params.securityProblemId,
              reason: params.muteReason,
              comment: params.muteComment || undefined,
            }

          case 'dynatrace_unmute_security_problem':
            return {
              ...baseParams,
              securityProblemId: params.securityProblemId,
              reason: UNMUTE_REASON,
              comment: params.muteComment || undefined,
            }

          case 'dynatrace_mute_security_problems':
            return {
              ...baseParams,
              securityProblemIds: params.securityProblemIds,
              reason: params.muteReason,
              comment: params.muteComment || undefined,
            }

          case 'dynatrace_unmute_security_problems':
            return {
              ...baseParams,
              securityProblemIds: params.securityProblemIds,
              reason: UNMUTE_REASON,
              comment: params.muteComment || undefined,
            }

          case 'dynatrace_list_remediation_items':
            return {
              ...baseParams,
              securityProblemId: params.securityProblemId,
              remediationItemSelector: params.remediationItemSelector || undefined,
            }

          case 'dynatrace_list_attacks':
            return {
              ...baseParams,
              ...pagination,
              attackSelector: params.attackSelector || undefined,
              from: params.from || undefined,
              to: params.to || undefined,
              fields: params.attackFields || undefined,
              sort: params.attackSort || undefined,
            }

          case 'dynatrace_get_attack':
            return {
              ...baseParams,
              attackId: params.attackId,
              fields: params.attackFields || undefined,
            }

          case 'dynatrace_list_tags':
            return {
              ...baseParams,
              entitySelector: params.entitySelector,
              from: params.from || undefined,
              to: params.to || undefined,
            }

          case 'dynatrace_add_tags':
            return {
              ...baseParams,
              entitySelector: params.entitySelector,
              tags: params.tags,
              from: params.from || undefined,
              to: params.to || undefined,
            }

          case 'dynatrace_delete_tag':
            return {
              ...baseParams,
              entitySelector: params.entitySelector,
              key: params.tagKey,
              value: params.tagValue || undefined,
              deleteAllWithKey: params.deleteAllWithKey,
              from: params.from || undefined,
              to: params.to || undefined,
            }

          case 'dynatrace_list_settings_schemas':
            return { ...baseParams, fields: params.schemaFields || undefined }

          case 'dynatrace_list_settings_objects':
            return {
              ...baseParams,
              ...pagination,
              schemaIds: params.schemaIds || undefined,
              scopes: params.scopes || undefined,
              externalIds: params.externalIds || undefined,
              fields: params.settingsFields || undefined,
              filter: params.settingsFilter || undefined,
              sort: params.settingsSort || undefined,
            }

          case 'dynatrace_get_settings_object':
            return { ...baseParams, objectId: params.objectId }

          case 'dynatrace_create_settings_object':
            return {
              ...baseParams,
              schemaId: params.schemaId,
              scope: params.scope,
              value: params.settingsValue,
              schemaVersion: params.schemaVersion || undefined,
              externalId: params.settingsExternalId || undefined,
              validateOnly: params.validateOnly,
            }

          case 'dynatrace_update_settings_object':
            return {
              ...baseParams,
              objectId: params.objectId,
              value: params.settingsValue,
              schemaVersion: params.schemaVersion || undefined,
              updateToken: params.updateToken || undefined,
              validateOnly: params.validateOnly,
            }

          case 'dynatrace_delete_settings_object':
            return {
              ...baseParams,
              objectId: params.objectId,
              updateToken: params.updateToken || undefined,
            }

          case 'dynatrace_list_synthetic_monitors':
            return {
              ...baseParams,
              type: params.monitorType || undefined,
              // "Any" must send no filter — enabled=false would return only the
              // disabled monitors, the opposite of what was asked for.
              enabled: toOptionalBoolean(params.monitorEnabled),
              location: params.monitorLocation || undefined,
              tag: params.monitorTag || undefined,
              managementZone: toNumber(params.monitorManagementZone),
            }

          case 'dynatrace_execute_synthetic_monitors':
            return {
              ...baseParams,
              monitors: params.monitors,
              processingMode: params.processingMode || undefined,
              failOnPerformanceIssue: params.failOnPerformanceIssue,
              stopOnProblem: params.stopOnProblem,
              takeScreenshotsOnSuccess: params.takeScreenshotsOnSuccess,
              metadata: params.batchMetadata || undefined,
            }

          case 'dynatrace_get_synthetic_batch':
            return { ...baseParams, batchId: params.batchId }

          case 'dynatrace_get_problem_comment':
          case 'dynatrace_delete_problem_comment':
            return {
              ...baseParams,
              problemId: params.problemId,
              commentId: params.commentId,
            }

          case 'dynatrace_update_problem_comment':
            return {
              ...baseParams,
              problemId: params.problemId,
              commentId: params.commentId,
              message: params.message,
              context: params.commentContext || undefined,
            }

          case 'dynatrace_create_slo':
            return { ...baseParams, ...sloWriteParams }

          case 'dynatrace_update_slo':
            return { ...baseParams, ...sloWriteParams, sloId: params.sloId }

          case 'dynatrace_delete_slo':
            return { ...baseParams, sloId: params.sloId }

          default:
            return baseParams
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    environmentUrl: { type: 'string', description: 'Dynatrace environment URL' },
    apiToken: { type: 'string', description: 'Dynatrace access token' },
    problemId: { type: 'string', description: 'Problem ID' },
    problemSelector: { type: 'string', description: 'Problem selector' },
    problemSort: { type: 'string', description: 'Sort order for problems' },
    problemFields: { type: 'string', description: 'Additional problem properties to include' },
    message: { type: 'string', description: 'Comment or closing message' },
    commentContext: { type: 'string', description: 'Context of the comment' },
    metricSelector: { type: 'string', description: 'Metric selector' },
    resolution: { type: 'string', description: 'Metric resolution' },
    mzSelector: { type: 'string', description: 'Management zone selector' },
    metricKey: { type: 'string', description: 'Metric key' },
    text: { type: 'string', description: 'Free-text metric search' },
    metadataSelector: { type: 'string', description: 'Metric metadata selector' },
    metricFields: { type: 'string', description: 'Additional metric properties to include' },
    writtenSince: { type: 'string', description: 'Only metrics written since this point' },
    writtenSinceMode: { type: 'string', description: 'INCLUDE or EXCLUDE for Written Since' },
    metricPayload: { type: 'string', description: 'Metric line protocol payload' },
    entitySelector: { type: 'string', description: 'Entity selector' },
    entityId: { type: 'string', description: 'Entity ID' },
    entityFields: { type: 'string', description: 'Additional entity properties to include' },
    entitySort: { type: 'string', description: 'Sort order for entities' },
    eventSelector: { type: 'string', description: 'Event selector' },
    eventId: { type: 'string', description: 'Event ID' },
    eventType: { type: 'string', description: 'Type of the event to ingest' },
    title: { type: 'string', description: 'Title of the event to ingest' },
    startTime: { type: 'number', description: 'Event start in UTC milliseconds' },
    endTime: { type: 'number', description: 'Event end in UTC milliseconds' },
    eventTimeout: { type: 'number', description: 'Event timeout in minutes' },
    eventProperties: { type: 'json', description: 'Event properties as a key-value object' },
    logQuery: { type: 'string', description: 'Log search query' },
    logSort: { type: 'string', description: 'Sort order for log records' },
    limit: { type: 'number', description: 'Number of log records to return' },
    nextSliceKey: { type: 'string', description: 'Cursor for the next log slice' },
    logs: { type: 'json', description: 'Log events to ingest' },
    sloSelector: { type: 'string', description: 'SLO selector' },
    sloId: { type: 'string', description: 'SLO ID' },
    timeFrame: { type: 'string', description: 'SLO evaluation timeframe: CURRENT or GTF' },
    sloSort: { type: 'string', description: 'Sort order for SLOs' },
    enabledSlos: { type: 'string', description: 'Filter SLOs by enabled state' },
    evaluate: { type: 'boolean', description: 'Evaluate each SLO' },
    showGlobalSlos: { type: 'boolean', description: 'Include SLOs without a management zone' },
    securityProblemSelector: { type: 'string', description: 'Security problem selector' },
    securityProblemId: { type: 'string', description: 'Security problem ID' },
    securityFields: {
      type: 'string',
      description: 'Additional security problem properties to include',
    },
    securitySort: { type: 'string', description: 'Sort order for security problems' },
    managementZoneFilter: { type: 'string', description: 'Management zone filter' },
    auditFilter: { type: 'string', description: 'Audit log filter' },
    auditSort: { type: 'string', description: 'Sort order for audit log entries' },
    from: { type: 'string', description: 'Start of the timeframe' },
    to: { type: 'string', description: 'End of the timeframe' },
    pageSize: { type: 'number', description: 'Entries per page' },
    nextPageKey: { type: 'string', description: 'Cursor for the next page' },
    commentId: { type: 'string', description: 'Comment ID' },
    securityProblemIds: { type: 'string', description: 'Security problem IDs for a bulk action' },
    muteReason: { type: 'string', description: 'Reason recorded for a mute or unmute' },
    muteComment: { type: 'string', description: 'Comment recorded for a mute or unmute' },
    remediationItemSelector: { type: 'string', description: 'Remediation item selector' },
    attackSelector: { type: 'string', description: 'Attack selector' },
    attackId: { type: 'string', description: 'Attack ID' },
    attackFields: { type: 'string', description: 'Additional attack properties to include' },
    attackSort: { type: 'string', description: 'Sort order for attacks' },
    tags: { type: 'json', description: 'Tags to add' },
    tagKey: { type: 'string', description: 'Key of the tag to delete' },
    tagValue: { type: 'string', description: 'Value of the tag to delete' },
    deleteAllWithKey: { type: 'boolean', description: 'Delete every tag carrying the key' },
    schemaFields: { type: 'string', description: 'Additional schema properties to include' },
    schemaIds: { type: 'string', description: 'Settings schema IDs to filter by' },
    scopes: { type: 'string', description: 'Settings scopes to filter by' },
    externalIds: { type: 'string', description: 'Settings external IDs to filter by' },
    settingsFields: { type: 'string', description: 'Additional settings properties to include' },
    settingsFilter: { type: 'string', description: 'Settings object filter expression' },
    settingsSort: { type: 'string', description: 'Sort order for settings objects' },
    objectId: { type: 'string', description: 'Settings object ID' },
    schemaId: { type: 'string', description: 'Schema of the settings object to create' },
    scope: { type: 'string', description: 'Scope the settings object applies to' },
    settingsValue: { type: 'json', description: 'Settings object value' },
    schemaVersion: { type: 'string', description: 'Settings schema version' },
    settingsExternalId: { type: 'string', description: 'External ID for the settings object' },
    updateToken: { type: 'string', description: 'Optimistic-concurrency token' },
    validateOnly: { type: 'boolean', description: 'Validate without saving' },
    monitorType: { type: 'string', description: 'Synthetic monitor type filter' },
    monitorEnabled: {
      type: 'string',
      description: 'Synthetic enabled filter: empty for any, "true", or "false"',
    },
    monitorLocation: { type: 'string', description: 'Synthetic location filter' },
    monitorTag: { type: 'string', description: 'Synthetic monitor tag filter' },
    monitorManagementZone: { type: 'number', description: 'Synthetic management zone ID' },
    monitors: { type: 'json', description: 'Synthetic monitors to execute' },
    processingMode: { type: 'string', description: 'Synthetic batch processing mode' },
    failOnPerformanceIssue: {
      type: 'boolean',
      description: 'Treat a performance breach as a failure',
    },
    stopOnProblem: { type: 'boolean', description: 'Stop the batch on the first problem' },
    takeScreenshotsOnSuccess: { type: 'boolean', description: 'Screenshot successful runs' },
    batchMetadata: { type: 'json', description: 'Metadata attached to the synthetic batch' },
    batchId: { type: 'string', description: 'Synthetic batch ID' },
    sloName: { type: 'string', description: 'Name of the SLO' },
    sloTarget: { type: 'number', description: 'SLO target percentage' },
    sloWarning: { type: 'number', description: 'SLO warning percentage' },
    sloTimeframe: { type: 'string', description: 'SLO evaluation timeframe' },
    sloEvaluationType: { type: 'string', description: 'SLO evaluation type' },
    sloDescription: { type: 'string', description: 'SLO description' },
    sloMetricExpression: { type: 'string', description: 'Metric expression the SLO evaluates' },
    sloFilter: { type: 'string', description: 'Entity filter scoping the SLO' },
    sloEnabled: { type: 'boolean', description: 'Whether the SLO is evaluated' },
    sloMetricName: { type: 'string', description: 'Display name for the SLO metric' },
    burnRateVisualizationEnabled: { type: 'boolean', description: 'Show the burn rate' },
    fastBurnThreshold: { type: 'number', description: 'Fast-burn threshold' },
  },

  outputs: {
    problems: { type: 'json', description: 'List of problems' },
    problem: { type: 'json', description: 'A single problem' },
    comments: { type: 'json', description: 'Comments on a problem' },
    comment: { type: 'json', description: 'The closing comment recorded on a problem' },
    closeTimestamp: { type: 'number', description: 'When problem closing was triggered' },
    closing: { type: 'boolean', description: 'Whether the problem is being closed' },
    result: { type: 'json', description: 'Metric query result, one entry per metric' },
    resolution: { type: 'string', description: 'Resolution Dynatrace used for the query' },
    metrics: { type: 'json', description: 'List of metric descriptors' },
    metric: { type: 'json', description: 'A single metric descriptor' },
    linesOk: { type: 'number', description: 'Accepted metric data points' },
    linesInvalid: { type: 'number', description: 'Rejected metric data points' },
    ingestError: { type: 'json', description: 'Details of invalid metric lines' },
    entities: { type: 'json', description: 'List of monitored entities' },
    entity: { type: 'json', description: 'A single monitored entity' },
    types: { type: 'json', description: 'List of entity types' },
    events: { type: 'json', description: 'List of events' },
    event: { type: 'json', description: 'A single event' },
    reportCount: { type: 'number', description: 'Number of events reported' },
    eventIngestResults: { type: 'json', description: 'Per-event ingestion results' },
    results: {
      type: 'json',
      description: 'Matching log records, or the per-object result of a settings write',
    },
    sliceSize: { type: 'number', description: 'Number of log records in the slice' },
    nextSliceKey: { type: 'string', description: 'Cursor for the next log slice' },
    accepted: { type: 'boolean', description: 'Whether every log event was accepted' },
    statusCode: { type: 'number', description: 'HTTP status of the log ingestion' },
    details: { type: 'json', description: 'Partial-success details of the log ingestion' },
    slos: { type: 'json', description: 'List of service-level objectives' },
    slo: { type: 'json', description: 'A single service-level objective' },
    securityProblems: { type: 'json', description: 'List of security problems' },
    securityProblem: { type: 'json', description: 'A single security problem' },
    auditLogs: { type: 'json', description: 'List of audit log entries' },
    problemId: { type: 'string', description: 'ID of the affected problem' },
    message: { type: 'string', description: 'Comment text that was recorded' },
    context: { type: 'string', description: 'Context of the recorded comment' },
    totalCount: { type: 'number', description: 'Total number of matching entries' },
    pageSize: { type: 'number', description: 'Number of entries in the page' },
    nextPageKey: { type: 'string', description: 'Cursor for the next page' },
    warnings: { type: 'json', description: 'Warnings returned alongside the result' },
    alreadyInState: { type: 'boolean', description: 'The problem was already in the target state' },
    summary: { type: 'json', description: 'Per-problem outcome of a bulk mute or unmute' },
    changedCount: { type: 'number', description: 'How many problems changed state' },
    remediationItems: { type: 'json', description: 'Remediation items of a vulnerability' },
    attacks: { type: 'json', description: 'List of attacks' },
    attack: { type: 'json', description: 'A single attack' },
    tags: { type: 'json', description: 'Custom tags on the matched entities' },
    appliedTags: { type: 'json', description: 'Tags that were applied' },
    matchedEntitiesCount: { type: 'number', description: 'How many entities the selector matched' },
    schemas: { type: 'json', description: 'Available settings schemas' },
    items: { type: 'json', description: 'Matching settings objects' },
    object: { type: 'json', description: 'A single settings object' },
    objectId: { type: 'string', description: 'ID of the affected settings object' },
    code: { type: 'number', description: 'Status Dynatrace reported for a settings write' },
    monitors: { type: 'json', description: 'Synthetic monitors' },
    batchId: { type: 'string', description: 'Synthetic batch ID' },
    batchStatus: { type: 'string', description: 'Status of the synthetic batch' },
    executedCount: { type: 'number', description: 'Synthetic executions completed' },
    failedCount: { type: 'number', description: 'Synthetic executions that failed' },
    failedToExecuteCount: { type: 'number', description: 'Synthetic executions that never ran' },
    triggeredCount: { type: 'number', description: 'Synthetic executions triggered' },
    triggeringProblemsCount: {
      type: 'number',
      description: 'Synthetic executions that could not be triggered',
    },
    triggered: { type: 'json', description: 'Triggered synthetic executions' },
    triggeringProblemsDetails: {
      type: 'json',
      description: 'Why synthetic executions failed to start',
    },
    failedExecutions: { type: 'json', description: 'Failed synthetic executions' },
    failedToExecute: { type: 'json', description: 'Synthetic executions that never started' },
    triggeringProblems: { type: 'json', description: 'Synthetic triggering problems' },
    metadata: { type: 'json', description: 'Metadata attached to the synthetic batch' },
    userId: { type: 'string', description: 'Who triggered the synthetic batch' },
    commentId: { type: 'string', description: 'ID of the affected comment' },
    sloId: { type: 'string', description: 'ID of the affected SLO' },
    name: { type: 'string', description: 'Name of the affected resource' },
    deleted: { type: 'boolean', description: 'Whether the delete succeeded' },
    securityProblemId: { type: 'string', description: 'ID of the affected security problem' },
    reason: { type: 'string', description: 'Reason recorded for a mute or unmute' },
  },
}

export const DynatraceBlockMeta = {
  tags: ['monitoring', 'incident-management', 'error-tracking'],
  url: 'https://www.dynatrace.com',
  templates: [
    {
      icon: DynatraceIcon,
      title: 'Dynatrace problem triage',
      prompt:
        'Build a scheduled workflow that polls Dynatrace every five minutes for open problems, pulls the root cause entity and recent logs for each one, summarizes the likely cause with an agent, and posts the enriched problem to Slack and PagerDuty.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack', 'pagerduty'],
    },
    {
      icon: DynatraceIcon,
      title: 'Dynatrace deploy marker',
      prompt:
        'Create a workflow that runs when a GitHub release is published and ingests a CUSTOM_DEPLOYMENT event into Dynatrace with the version, commit, and service entity selector, so metric changes can be correlated with the deploy.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd'],
      alsoIntegrations: ['github'],
    },
    {
      icon: DynatraceIcon,
      title: 'Dynatrace SLO burn-rate watch',
      prompt:
        'Build a scheduled hourly workflow that reads Dynatrace SLOs, flags any with a fast error-budget burn rate, and opens a Linear issue with the SLO name, remaining budget, and time to exhaustion.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: DynatraceIcon,
      title: 'Dynatrace vulnerability digest',
      prompt:
        'Create a scheduled daily workflow that lists open critical and high Dynatrace security problems, groups them by affected service and CVE, writes them to a Sim table, and posts a remediation digest to the security channel in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DynatraceIcon,
      title: 'Dynatrace capacity report',
      prompt:
        'Build a scheduled weekly workflow that queries Dynatrace host CPU, memory, and disk metrics per management zone, ranks the most saturated hosts, and writes a capacity planning report to a Sim table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'analysis'],
    },
    {
      icon: DynatraceIcon,
      title: 'Dynatrace log error triage',
      prompt:
        'Create a scheduled workflow that searches Dynatrace logs for new error patterns in the last fifteen minutes, clusters them by message shape with an agent, and posts only the previously unseen clusters to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DynatraceIcon,
      title: 'Dynatrace auto-close on recovery',
      prompt:
        'Build a scheduled workflow that checks Dynatrace problems whose entities have returned to a healthy metric baseline, closes them with an explanatory comment, and records what was closed in a Sim table for review.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'monitoring'],
    },
    {
      icon: DynatraceIcon,
      title: 'Dynatrace config audit',
      prompt:
        'Create a scheduled weekly workflow that reads the Dynatrace audit log for configuration changes, highlights changes made outside business hours or by service accounts, and emails a compliance summary to the platform team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'triage-open-problems',
      description:
        'Pull open Dynatrace problems, attach root cause and impact context, and rank them for on-call.',
      content:
        '# Triage Open Problems\n\nBuild a prioritized picture of what is currently broken.\n\n## Steps\n1. List problems with a selector of `status("open")` over the relevant timeframe.\n2. For each problem, get its details with the `evidenceDetails` and `impactAnalysis` fields so the root cause entity and estimated affected users are included.\n3. Get the root cause entity to read its type, tags, and management zones.\n4. Rank by impact level, severity level, and estimated affected users.\n\n## Output\nReturn a ranked list: display ID, title, severity, impact, root cause entity, affected entity count, and how long the problem has been open.',
    },
    {
      name: 'correlate-deploy-with-metrics',
      description: 'Mark a deploy in Dynatrace and compare service metrics before and after it.',
      content:
        '# Correlate Deploy With Metrics\n\nMake a release visible in Dynatrace and prove whether it moved the numbers.\n\n## Steps\n1. Ingest a `CUSTOM_DEPLOYMENT` event with the version and pipeline as properties, scoped to the service with an entity selector.\n2. Query the service response time and error rate metrics for the window before the deploy.\n3. Query the same metrics for the window after the deploy.\n4. Compare the two and state whether the release regressed either metric.\n\n## Output\nReturn the deploy event correlation ID plus a before/after table of each metric, with the percentage change and a regression verdict.',
    },
    {
      name: 'review-slo-health',
      description: 'Report SLO attainment, remaining error budget, and burn rate.',
      content:
        '# Review SLO Health\n\nProduce an SLO scorecard for a service review or weekly report.\n\n## Steps\n1. List SLOs with evaluation enabled so the calculated values are populated.\n2. Filter to the ones that are failing or warning, and to any with a FAST burn rate.\n3. For each flagged SLO, get its details to read the estimated time to consume the error budget.\n4. Group results by management zone or service.\n\n## Output\nReturn each SLO with its target, current attainment, remaining error budget, burn rate type, and time to exhaustion. Flag the ones that will breach before the period ends.',
    },
    {
      name: 'investigate-entity',
      description:
        'Assemble the full picture of one host or service: properties, metrics, events, and logs.',
      content:
        '# Investigate Entity\n\nGather everything Dynatrace knows about a single entity.\n\n## Steps\n1. Get the entity by ID, or list entities with a selector to find it by name or tag.\n2. Query its key metrics over the incident window using an entity selector scoped to its ID.\n3. List events for the same entity and window to find deploys, restarts, or configuration changes.\n4. Search logs filtered to the entity to pull the errors around the same time.\n\n## Output\nReturn the entity properties and tags, a metric summary over the window, the timeline of events, and the top recurring log errors.',
    },
    {
      name: 'audit-vulnerabilities',
      description:
        'Inventory open Dynatrace vulnerabilities by risk, exposure, and affected service.',
      content:
        '# Audit Vulnerabilities\n\nTurn Application Security findings into a remediation queue, then act on it.\n\n## Steps\n1. List security problems with `status("OPEN")` and request the `riskAssessment` and `globalCounts` fields.\n2. Sort by risk score and separate the publicly exposed ones with reachable data assets — those are the ones to fix first.\n3. Get the details of each high-priority finding to read its description, remediation guidance, and vulnerable components.\n4. List the remediation items of a third-party finding to see which components to upgrade and which entities each covers.\n5. Mute the findings that do not apply, with a reason — FALSE_POSITIVE, CONFIGURATION_NOT_AFFECTED, or VULNERABLE_CODE_NOT_IN_USE — so the queue reflects real work. Use the bulk mute when triaging many at once.\n\n## Output\nReturn a remediation queue: CVE, risk level and score, exposure, affected services, vulnerable component version, and the recommended fix. List separately what was muted and why.',
    },
    {
      name: 'open-maintenance-window',
      description:
        'Create a Dynatrace maintenance window as a settings object so a deploy does not raise problems.',
      content:
        '# Open Maintenance Window\n\nSuppress alerting for a planned change, then clean up after it.\n\n## Steps\n1. List settings schemas and find the maintenance window schema (`builtin:alerting.maintenance-window`).\n2. List existing settings objects for that schema to copy the shape of a working window — the `value` is schema-defined, so mirroring a real one beats guessing.\n3. Create a settings object with the window scope, the suppression type, and the schedule covering the change.\n4. Run the deploy, then delete the settings object — or let the schedule close it.\n\n## Output\nReturn the created object ID and the window it covers, so a later step can delete it. Note whether the window suppresses alerting entirely or only problem creation.',
    },
    {
      name: 'gate-deploy-on-synthetic',
      description:
        'Run Dynatrace synthetic monitors on demand after a deploy and decide from the batch result.',
      content:
        '# Gate Deploy On Synthetic\n\nProve a release works before letting it stand.\n\n## Steps\n1. List synthetic monitors and pick the smoke tests covering the deployed service — the list returns the monitor IDs the execution needs.\n2. Ingest a `CUSTOM_DEPLOYMENT` event so the release is visible on the timeline.\n3. Execute the monitors on demand, attaching the release version as batch metadata.\n4. Poll the batch until its status leaves RUNNING, then read the failed executions.\n5. Roll back or alert when the batch reports failures.\n\n## Output\nReturn the batch ID, its final status, the executed and failed counts, and the failure message of each failed execution. State plainly whether the deploy passed.',
    },
    {
      name: 'tag-entities-from-workflow',
      description: 'Apply or remove Dynatrace entity tags so selectors and zones stay accurate.',
      content:
        '# Tag Entities From Workflow\n\nKeep entity tags in step with what the workflow just learned.\n\n## Steps\n1. List entities with a selector describing the set to change, and confirm it matches what you expect before writing.\n2. Read the current tags on those entities so the change is additive rather than a surprise.\n3. Add the tags, each with a key and an optional value. The response reports how many entities matched.\n4. Delete tags that no longer apply, either one key-value pair or every value of a key.\n\n## Output\nReturn the applied or removed tags and the matched entity count. Flag the case where the selector matched zero entities — that usually means the selector is wrong, not that the work is done.',
    },
  ],
} as const satisfies BlockMeta
