import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'

export const OciLoggingBlock: BlockConfig = {
  type: 'oci_logging',
  name: 'OCI Logging',
  description: 'Manage, search, and ingest Oracle Cloud Infrastructure logs',
  longDescription:
    'Use native OCI Logging to manage log groups and logs, run bounded native queries, ingest custom log batches, inspect asynchronous work requests, and retrieve saved searches. Reuses stored OCI API signing-key service accounts. Management writes return work-request acceptance; ingestion returns acceptance without per-entry results. Put Logs, Update, and Delete make one provider attempt per execution; leave whole-block retries disabled to avoid replaying these writes. Logging Analytics, Audit API operations, and Monitoring are separate products.',
  docsLink: 'https://docs.sim.ai/integrations/oci_logging',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  authMode: AuthMode.ApiKey,
  bgColor: '#C74634',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Logging',
    sentences: {
      byOperation: {
        oci_logging_list_log_groups: [
          {
            text: 'List log groups',
            field: 'compartmentId',
            core: true,
          },
        ],
        oci_logging_get_log_group: [
          {
            text: 'Get log group',
            field: ['logGroupSelector', 'logGroupManual'],
            core: true,
          },
        ],
        oci_logging_create_log_group: [
          {
            text: 'Create log group',
            field: 'displayName',
            core: true,
          },
        ],
        oci_logging_update_log_group: [
          {
            text: 'Update log group',
            field: ['logGroupSelector', 'logGroupManual'],
            core: true,
          },
        ],
        oci_logging_delete_log_group: [
          {
            text: 'Delete log group',
            field: ['logGroupSelector', 'logGroupManual'],
            core: true,
          },
        ],
        oci_logging_list_logs: [
          {
            text: 'List logs',
            field: ['logGroupSelector', 'logGroupManual'],
            core: true,
          },
        ],
        oci_logging_get_log: [
          {
            text: 'Get log',
            field: ['logSelector', 'logManual'],
            core: true,
          },
        ],
        oci_logging_create_log: [
          {
            text: 'Create log',
            field: 'displayName',
            core: true,
          },
        ],
        oci_logging_update_log: [
          {
            text: 'Update log',
            field: ['logSelector', 'logManual'],
            core: true,
          },
        ],
        oci_logging_delete_log: [
          {
            text: 'Delete log',
            field: ['logSelector', 'logManual'],
            core: true,
          },
        ],
        oci_logging_search_logs: [
          {
            text: 'Search logs',
            field: 'searchQuery',
            core: true,
          },
        ],
        oci_logging_put_logs: [
          {
            text: 'Put logs',
            field: ['customLogSelector', 'customLogManual'],
            core: true,
          },
        ],
        oci_logging_get_work_request: [
          {
            text: 'Get work request',
            field: 'workRequestId',
            core: true,
          },
        ],
        oci_logging_list_work_request_errors: [
          {
            text: 'List work request errors',
            field: 'workRequestId',
            core: true,
          },
        ],
        oci_logging_list_saved_searches: [
          {
            text: 'List saved searches',
            field: 'compartmentId',
            core: true,
          },
        ],
        oci_logging_get_saved_search: [
          {
            text: 'Get saved search',
            field: 'logSavedSearchId',
            core: true,
          },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      value: () => 'oci_logging_search_logs',
      options: [
        {
          label: 'List Log Groups',
          id: 'oci_logging_list_log_groups',
        },
        {
          label: 'Get Log Group',
          id: 'oci_logging_get_log_group',
        },
        {
          label: 'Create Log Group',
          id: 'oci_logging_create_log_group',
        },
        {
          label: 'Update Log Group',
          id: 'oci_logging_update_log_group',
        },
        {
          label: 'Delete Log Group',
          id: 'oci_logging_delete_log_group',
        },
        {
          label: 'List Logs',
          id: 'oci_logging_list_logs',
        },
        {
          label: 'Get Log',
          id: 'oci_logging_get_log',
        },
        {
          label: 'Create Log',
          id: 'oci_logging_create_log',
        },
        {
          label: 'Update Log',
          id: 'oci_logging_update_log',
        },
        {
          label: 'Delete Log',
          id: 'oci_logging_delete_log',
        },
        {
          label: 'Search Logs',
          id: 'oci_logging_search_logs',
        },
        {
          label: 'Put Logs',
          id: 'oci_logging_put_logs',
        },
        {
          label: 'Get Work Request',
          id: 'oci_logging_get_work_request',
        },
        {
          label: 'List Work Request Errors',
          id: 'oci_logging_list_work_request_errors',
        },
        {
          label: 'List Saved Searches',
          id: 'oci_logging_list_saved_searches',
        },
        {
          label: 'Get Saved Search',
          id: 'oci_logging_get_saved_search',
        },
      ],
    },
    {
      id: 'credentialSelector',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci-logging',
      requiredScopes: getScopesForService('oci-logging'),
      credentialKind: 'service-account',
      canonicalParamId: 'ociCredential',
      mode: 'basic',
      required: true,
      placeholder: 'Select OCI service account',
    },
    {
      id: 'manualCredential',
      title: 'OCI Credential ID',
      type: 'short-input',
      canonicalParamId: 'ociCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Stored OCI service account credential ID',
    },
    {
      id: 'region',
      title: 'Region Override',
      type: 'short-input',
      placeholder: 'Optional; defaults to the credential region',
    },
    {
      id: 'compartmentId',
      title: 'Compartment OCID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_logging_list_log_groups',
          'oci_logging_create_log_group',
          'oci_logging_list_saved_searches',
          'oci_logging_get_log_group',
          'oci_logging_update_log_group',
          'oci_logging_delete_log_group',
          'oci_logging_list_logs',
          'oci_logging_get_log',
          'oci_logging_create_log',
          'oci_logging_update_log',
          'oci_logging_delete_log',
          'oci_logging_put_logs',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_logging_list_log_groups',
          'oci_logging_create_log_group',
          'oci_logging_list_saved_searches',
        ],
      },
      placeholder: 'ocid1.compartment...',
    },
    {
      id: 'logGroupSelector',
      title: 'Log Group',
      type: 'combobox',
      selectorKey: 'oci_logging.logGroups',
      canonicalParamId: 'logGroupId',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'oci_logging_get_log_group',
          'oci_logging_update_log_group',
          'oci_logging_delete_log_group',
          'oci_logging_list_logs',
          'oci_logging_get_log',
          'oci_logging_create_log',
          'oci_logging_update_log',
          'oci_logging_delete_log',
          'oci_logging_put_logs',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_logging_get_log_group',
          'oci_logging_update_log_group',
          'oci_logging_delete_log_group',
          'oci_logging_list_logs',
          'oci_logging_get_log',
          'oci_logging_create_log',
          'oci_logging_update_log',
          'oci_logging_delete_log',
        ],
      },
      dependsOn: {
        all: ['ociCredential', 'compartmentId'],
        any: ['ociCredential', 'region'],
      },
      placeholder: 'Select resource',
    },
    {
      id: 'logGroupManual',
      title: 'Log Group OCID',
      type: 'short-input',
      canonicalParamId: 'logGroupId',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_logging_get_log_group',
          'oci_logging_update_log_group',
          'oci_logging_delete_log_group',
          'oci_logging_list_logs',
          'oci_logging_get_log',
          'oci_logging_create_log',
          'oci_logging_update_log',
          'oci_logging_delete_log',
          'oci_logging_put_logs',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_logging_get_log_group',
          'oci_logging_update_log_group',
          'oci_logging_delete_log_group',
          'oci_logging_list_logs',
          'oci_logging_get_log',
          'oci_logging_create_log',
          'oci_logging_update_log',
          'oci_logging_delete_log',
        ],
      },
      placeholder: 'Enter resource OCID',
    },
    {
      id: 'logSelector',
      title: 'Log',
      type: 'combobox',
      selectorKey: 'oci_logging.logs',
      canonicalParamId: 'logId',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['oci_logging_get_log', 'oci_logging_update_log', 'oci_logging_delete_log'],
      },
      required: true,
      dependsOn: {
        all: ['ociCredential', 'logGroupId'],
        any: ['ociCredential', 'region'],
      },
      placeholder: 'Select resource',
    },
    {
      id: 'logManual',
      title: 'Log OCID',
      type: 'short-input',
      canonicalParamId: 'logId',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_logging_get_log', 'oci_logging_update_log', 'oci_logging_delete_log'],
      },
      required: true,
      placeholder: 'Enter resource OCID',
    },
    {
      id: 'customLogSelector',
      title: 'Custom Log',
      type: 'combobox',
      selectorKey: 'oci_logging.customLogs',
      canonicalParamId: 'customLog',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['oci_logging_put_logs'],
      },
      required: true,
      dependsOn: {
        all: ['ociCredential', 'logGroupId'],
        any: ['ociCredential', 'region'],
      },
      placeholder: 'Select resource',
    },
    {
      id: 'customLogManual',
      title: 'Custom Log OCID',
      type: 'short-input',
      canonicalParamId: 'customLog',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_logging_put_logs'],
      },
      required: true,
      placeholder: 'Enter resource OCID',
    },
    {
      id: 'isCompartmentIdInSubtree',
      title: 'Is Compartment Id In Subtree',
      type: 'dropdown',
      options: [
        {
          label: 'Unspecified',
          id: '',
        },
        {
          label: 'True',
          id: 'true',
        },
        {
          label: 'False',
          id: 'false',
        },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_logging_list_log_groups'],
      },
      required: false,
      placeholder: 'Include descendant compartments; Oracle defaults to false.',
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_logging_list_log_groups',
          'oci_logging_create_log_group',
          'oci_logging_update_log_group',
          'oci_logging_list_logs',
          'oci_logging_create_log',
          'oci_logging_update_log',
        ],
      },
      required: {
        field: 'operation',
        value: ['oci_logging_create_log_group', 'oci_logging_create_log'],
      },
      placeholder: 'Display name, 1–255 characters.',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_logging_list_log_groups',
          'oci_logging_list_logs',
          'oci_logging_search_logs',
          'oci_logging_list_work_request_errors',
          'oci_logging_list_saved_searches',
        ],
      },
      required: false,
      placeholder: 'Maximum items for this page, 1–1000; default 100.',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_logging_list_log_groups',
          'oci_logging_list_logs',
          'oci_logging_search_logs',
          'oci_logging_list_work_request_errors',
          'oci_logging_list_saved_searches',
        ],
      },
      required: false,
      placeholder:
        'Opaque nextPage token from the preceding response. Preserve the same filters and time window.',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        {
          label: 'Unspecified',
          id: '',
        },
        {
          label: 'timeCreated',
          id: 'timeCreated',
        },
        {
          label: 'displayName',
          id: 'displayName',
        },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_logging_list_log_groups',
          'oci_logging_list_logs',
          'oci_logging_list_saved_searches',
        ],
      },
      required: false,
      placeholder: 'Sort by timeCreated or displayName.',
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        {
          label: 'Unspecified',
          id: '',
        },
        {
          label: 'ASC',
          id: 'ASC',
        },
        {
          label: 'DESC',
          id: 'DESC',
        },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_logging_list_log_groups',
          'oci_logging_list_logs',
          'oci_logging_list_saved_searches',
        ],
      },
      required: false,
      placeholder: 'ASC or DESC.',
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_logging_create_log_group', 'oci_logging_update_log_group'],
      },
      required: false,
      placeholder: 'Description, 1–400 characters.',
    },
    {
      id: 'freeformTags',
      title: 'Freeform Tags',
      type: 'code',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'String tag map, for example {"Department":"Finance"}. Return ONLY the JSON object.',
      },
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_logging_create_log_group',
          'oci_logging_update_log_group',
          'oci_logging_create_log',
          'oci_logging_update_log',
        ],
      },
      required: false,
      placeholder: 'String tag map, for example {"Department":"Finance"}.',
    },
    {
      id: 'definedTags',
      title: 'Defined Tags',
      type: 'code',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'String tags grouped by namespace, for example {"Operations":{"CostCenter":"42"}}. Return ONLY the JSON object.',
      },
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_logging_create_log_group',
          'oci_logging_update_log_group',
          'oci_logging_create_log',
          'oci_logging_update_log',
        ],
      },
      required: false,
      placeholder:
        'String tags grouped by namespace, for example {"Operations":{"CostCenter":"42"}}.',
    },
    {
      id: 'retryToken',
      title: 'Retry Token',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_logging_create_log_group', 'oci_logging_create_log'],
      },
      required: false,
      placeholder:
        'Optional stable retry token, 1–64 characters. Oracle retains tokens for up to 24 hours, subject to invalidation. Reuse for the same create request.',
    },
    {
      id: 'ifMatch',
      title: 'If Match',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_logging_update_log_group',
          'oci_logging_delete_log_group',
          'oci_logging_update_log',
          'oci_logging_delete_log',
        ],
      },
      required: false,
      placeholder: 'Optional ETag from Get for optimistic concurrency.',
    },
    {
      id: 'logType',
      title: 'Log Type',
      type: 'dropdown',
      options: [
        {
          label: 'Unspecified',
          id: '',
        },
        {
          label: 'CUSTOM',
          id: 'CUSTOM',
        },
        {
          label: 'SERVICE',
          id: 'SERVICE',
        },
      ],
      condition: {
        field: 'operation',
        value: ['oci_logging_list_logs', 'oci_logging_create_log'],
      },
      required: {
        field: 'operation',
        value: ['oci_logging_create_log'],
      },
      placeholder: 'CUSTOM or SERVICE.',
    },
    {
      id: 'sourceService',
      title: 'Source Service',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_logging_list_logs'],
      },
      required: false,
      placeholder: 'Filter by emitting OCI service.',
    },
    {
      id: 'sourceResource',
      title: 'Source Resource',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_logging_list_logs'],
      },
      required: false,
      placeholder: 'Filter by emitting resource identifier.',
    },
    {
      id: 'lifecycleState',
      title: 'Lifecycle State',
      type: 'dropdown',
      options: [
        {
          label: 'Unspecified',
          id: '',
        },
        {
          label: 'CREATING',
          id: 'CREATING',
        },
        {
          label: 'ACTIVE',
          id: 'ACTIVE',
        },
        {
          label: 'UPDATING',
          id: 'UPDATING',
        },
        {
          label: 'INACTIVE',
          id: 'INACTIVE',
        },
        {
          label: 'DELETING',
          id: 'DELETING',
        },
        {
          label: 'FAILED',
          id: 'FAILED',
        },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_logging_list_logs'],
      },
      required: false,
      placeholder: 'CREATING, ACTIVE, UPDATING, INACTIVE, DELETING, or FAILED.',
    },
    {
      id: 'isEnabled',
      title: 'Is Enabled',
      type: 'dropdown',
      options: [
        {
          label: 'Unspecified',
          id: '',
        },
        {
          label: 'True',
          id: 'true',
        },
        {
          label: 'False',
          id: 'false',
        },
      ],
      condition: {
        field: 'operation',
        value: ['oci_logging_create_log', 'oci_logging_update_log'],
      },
      required: false,
      placeholder: 'Whether the log is enabled. Omit to preserve the existing setting on update.',
    },
    {
      id: 'retentionDuration',
      title: 'Retention Duration',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_logging_create_log', 'oci_logging_update_log'],
      },
      required: false,
      placeholder: 'Retention in days: 30, 60, 90, 120, 150, or 180.',
    },
    {
      id: 'configuration',
      title: 'Configuration',
      type: 'code',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Generate OCI Logging configuration JSON for the requested operation. Create uses source with sourceType OCISERVICE, service, resource, category and optional parameters. Update must use source with optional parameters only; never sourceType, service, resource, category or compartmentId. Optional deprecated archiving contains isEnabled. Return ONLY the JSON object.',
      },
      condition: {
        field: 'operation',
        value: ['oci_logging_create_log', 'oci_logging_update_log'],
      },
      required: false,
      placeholder:
        'Create: {"source":{"sourceType":"OCISERVICE","service":"flowlogs","resource":"<subnet-ocid>","category":"all"}}. Update: {"source":{"parameters":{}}}. Source identity cannot be updated.',
    },
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'long-input',
      rows: 5,
      wandConfig: {
        enabled: true,
        prompt:
          'Write a native OCI Logging query scoped to the supplied compartment, group and log. Return ONLY the query.',
      },
      condition: {
        field: 'operation',
        value: ['oci_logging_search_logs'],
      },
      required: true,
      placeholder:
        'Full native OCI Logging query, for example search "<compartment>/<group>/<log>" | sort by datetime desc. Sent unchanged.',
    },
    {
      id: 'timeStart',
      title: 'Time Start',
      type: 'short-input',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an RFC3339 timestamp with timezone. Return ONLY the timestamp.',
      },
      condition: {
        field: 'operation',
        value: ['oci_logging_search_logs'],
      },
      required: true,
      placeholder: 'Explicit RFC3339 start timestamp, including timezone.',
    },
    {
      id: 'timeEnd',
      title: 'Time End',
      type: 'short-input',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an RFC3339 timestamp with timezone. Return ONLY the timestamp.',
      },
      condition: {
        field: 'operation',
        value: ['oci_logging_search_logs'],
      },
      required: true,
      placeholder: 'Explicit RFC3339 end timestamp after timeStart, at most 14 days later.',
    },
    {
      id: 'isReturnFieldInfo',
      title: 'Is Return Field Info',
      type: 'dropdown',
      options: [
        {
          label: 'Unspecified',
          id: '',
        },
        {
          label: 'True',
          id: 'true',
        },
        {
          label: 'False',
          id: 'false',
        },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_logging_search_logs'],
      },
      required: false,
      placeholder: 'Return projected field names and types.',
    },
    {
      id: 'logEntryBatches',
      title: 'Log Entry Batches',
      type: 'code',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Nonempty batches with source, type, defaultlogentrytime and entries; optional subject. Each entry has data (string), a stable caller-supplied id (1–255 characters), and optional time. Timestamps use RFC3339 with milliseconds. Each serialized entry must be smaller than 1 MB. Oracle may truncate oversized data fields during ingestion; acceptance is not indexing completion. Return ONLY the JSON array.',
      },
      condition: {
        field: 'operation',
        value: ['oci_logging_put_logs'],
      },
      required: true,
      placeholder:
        'Nonempty batches with source, type, defaultlogentrytime and entries; optional subject. Each entry has data (string), a stable caller-supplied id (1–255 characters), and optional time. Timestamps use RFC3339 with milliseconds. Each serialized entry must be smaller than 1 MB. Oracle may truncate oversized data fields during ingestion; acceptance is not indexing completion.',
    },
    {
      id: 'workRequestId',
      title: 'Work Request Id',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_logging_get_work_request', 'oci_logging_list_work_request_errors'],
      },
      required: true,
      placeholder: 'Logging work request OCID returned by a management mutation.',
    },
    {
      id: 'logSavedSearchId',
      title: 'Log Saved Search Id',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_logging_list_saved_searches', 'oci_logging_get_saved_search'],
      },
      required: {
        field: 'operation',
        value: ['oci_logging_get_saved_search'],
      },
      placeholder: 'Logging saved search OCID.',
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_logging_list_saved_searches'],
      },
      required: false,
      placeholder: 'Filter by saved search name.',
    },
  ],
  tools: {
    access: [
      'oci_logging_list_log_groups',
      'oci_logging_get_log_group',
      'oci_logging_create_log_group',
      'oci_logging_update_log_group',
      'oci_logging_delete_log_group',
      'oci_logging_list_logs',
      'oci_logging_get_log',
      'oci_logging_create_log',
      'oci_logging_update_log',
      'oci_logging_delete_log',
      'oci_logging_search_logs',
      'oci_logging_put_logs',
      'oci_logging_get_work_request',
      'oci_logging_list_work_request_errors',
      'oci_logging_list_saved_searches',
      'oci_logging_get_saved_search',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const result: Record<string, unknown> = {}
        result.isCompartmentIdInSubtree = parseOptionalBooleanInput(params.isCompartmentIdInSubtree)
        result.limit = parseOptionalNumberInput(params.limit, 'limit', { integer: true })
        result.freeformTags = parseOptionalJsonInput(params.freeformTags, 'freeformTags')
        result.definedTags = parseOptionalJsonInput(params.definedTags, 'definedTags')
        result.isEnabled = parseOptionalBooleanInput(params.isEnabled)
        result.retentionDuration = parseOptionalNumberInput(
          params.retentionDuration,
          'retentionDuration',
          { integer: true }
        )
        result.configuration = parseOptionalJsonInput(params.configuration, 'configuration')
        result.isReturnFieldInfo = parseOptionalBooleanInput(params.isReturnFieldInfo)
        result.logEntryBatches = parseOptionalJsonInput(params.logEntryBatches, 'logEntryBatches')
        if (params.operation === 'oci_logging_put_logs') result.logId = params.customLog
        for (const key of [
          'region',
          'page',
          'sortBy',
          'sortOrder',
          'logType',
          'lifecycleState',
          'ifMatch',
          'retryToken',
          'displayName',
          'description',
          'sourceService',
          'sourceResource',
          'name',
          'logSavedSearchId',
        ]) {
          if (params[key] === '') result[key] = undefined
        }
        return result
      },
    },
  },
  inputs: {
    operation: {
      type: 'string',
      description: 'OCI Logging operation.',
    },
    ociCredential: {
      type: 'string',
      description: 'Stored OCI API signing-key service account ID.',
    },
    region: {
      type: 'string',
      description: 'Optional OCI region override.',
    },
    customLog: {
      type: 'string',
      description: 'Custom log OCID for ingestion.',
    },
    compartmentId: {
      type: 'string',
      description: 'Compartment OCID.',
    },
    isCompartmentIdInSubtree: {
      type: 'boolean',
      description: 'Include descendant compartments; Oracle defaults to false.',
    },
    displayName: {
      type: 'string',
      description: 'Display name, 1–255 characters.',
    },
    limit: {
      type: 'number',
      description: 'Maximum items for this page, 1–1000; default 100.',
    },
    page: {
      type: 'string',
      description:
        'Opaque nextPage token from the preceding response. Preserve the same filters and time window.',
    },
    sortBy: {
      type: 'string',
      description: 'Sort by timeCreated or displayName.',
    },
    sortOrder: {
      type: 'string',
      description: 'ASC or DESC.',
    },
    logGroupId: {
      type: 'string',
      description: 'Log group OCID.',
    },
    description: {
      type: 'string',
      description: 'Description, 1–400 characters.',
    },
    freeformTags: {
      type: 'json',
      description: 'String tag map, for example {"Department":"Finance"}.',
    },
    definedTags: {
      type: 'json',
      description:
        'String tags grouped by namespace, for example {"Operations":{"CostCenter":"42"}}.',
    },
    retryToken: {
      type: 'string',
      description:
        'Optional stable retry token, 1–64 characters. Oracle retains tokens for up to 24 hours, subject to invalidation. Reuse for the same create request.',
    },
    ifMatch: {
      type: 'string',
      description: 'Optional ETag from Get for optimistic concurrency.',
    },
    logType: {
      type: 'string',
      description: 'CUSTOM or SERVICE.',
    },
    sourceService: {
      type: 'string',
      description: 'Filter by emitting OCI service.',
    },
    sourceResource: {
      type: 'string',
      description: 'Filter by emitting resource identifier.',
    },
    lifecycleState: {
      type: 'string',
      description: 'CREATING, ACTIVE, UPDATING, INACTIVE, DELETING, or FAILED.',
    },
    logId: {
      type: 'string',
      description: 'Log OCID. Put Logs requires a CUSTOM log.',
    },
    isEnabled: {
      type: 'boolean',
      description: 'Whether the log is enabled. Omit to preserve the existing setting on update.',
    },
    retentionDuration: {
      type: 'number',
      description: 'Retention in days: 30, 60, 90, 120, 150, or 180.',
    },
    configuration: {
      type: 'json',
      description:
        'Service log configuration: source with sourceType OCISERVICE, service, resource, category and optional string parameters; optional compartmentId and deprecated archiving.isEnabled.',
    },
    searchQuery: {
      type: 'string',
      description:
        'Full native OCI Logging query, for example search "<compartment>/<group>/<log>" | sort by datetime desc. Sent unchanged.',
    },
    timeStart: {
      type: 'string',
      description: 'Explicit RFC3339 start timestamp, including timezone.',
    },
    timeEnd: {
      type: 'string',
      description: 'Explicit RFC3339 end timestamp after timeStart, at most 14 days later.',
    },
    isReturnFieldInfo: {
      type: 'boolean',
      description: 'Return projected field names and types.',
    },
    logEntryBatches: {
      type: 'json',
      description:
        'Nonempty batches with source, type, defaultlogentrytime and entries; optional subject. Each entry has data (string), a stable caller-supplied id (1–255 characters), and optional time. Timestamps use RFC3339 with milliseconds. Each serialized entry must be smaller than 1 MB. Oracle may truncate oversized data fields during ingestion; acceptance is not indexing completion.',
    },
    workRequestId: {
      type: 'string',
      description: 'Logging work request OCID returned by a management mutation.',
    },
    logSavedSearchId: {
      type: 'string',
      description: 'Logging saved search OCID.',
    },
    name: {
      type: 'string',
      description: 'Filter by saved search name.',
    },
  },
  outputs: {
    logGroups: {
      type: 'json',
      description:
        'Log groups on this page (id, compartmentId, displayName, lifecycleState, tags).',
    },
    logGroup: {
      type: 'json',
      description: 'Log group details, including id, displayName, lifecycleState and tags.',
    },
    logs: {
      type: 'json',
      description:
        'Logs on this page (id, logGroupId, displayName, logType, configuration, retentionDuration).',
    },
    log: {
      type: 'json',
      description: 'Log details with source configuration, retentionDuration and isEnabled.',
    },
    results: {
      type: 'json',
      description: 'Search records, each with dynamic projected data.',
    },
    fields: {
      type: 'json',
      description: 'Projected search schema: fieldName and fieldType.',
    },
    summary: {
      type: 'json',
      description: 'Oracle search resultCount and fieldCount when returned.',
    },
    accepted: {
      type: 'boolean',
      description: 'Request accepted; not completion or per-entry outcomes.',
    },
    workRequestId: {
      type: 'string',
      description: 'Asynchronous work request OCID.',
    },
    workRequest: {
      type: 'json',
      description: 'Work request status, percentComplete, resources and timestamps.',
    },
    errors: {
      type: 'json',
      description: 'Work request error entries with code, message and timestamp.',
    },
    savedSearches: {
      type: 'json',
      description: 'Saved searches on this page (id, name, compartmentId, query when returned).',
    },
    savedSearch: {
      type: 'json',
      description: 'Saved search with id, name, compartmentId and native query.',
    },
    nextPage: {
      type: 'string',
      description: 'Opaque continuation token.',
    },
    etag: {
      type: 'string',
      description: 'Resource version.',
    },
    retryAfter: {
      type: 'number',
      description: 'Seconds to wait before polling.',
    },
    opcRequestId: {
      type: 'string',
      description: 'Oracle request ID.',
    },
  },
}

export const OciLoggingBlockMeta = {
  tags: ['monitoring', 'data-analytics'],
  url: 'https://www.oracle.com/application-development/logging/',
  skills: [
    {
      name: 'triage-oci-logs',
      description: 'Investigate OCI log errors.',
      content:
        '# Investigate OCI log errors\n\n## Steps\nSelect a compartment, group, and log. Write a query scoped to them. Run Search Logs with fixed RFC3339 times no more than 14 days apart. Follow nextPage with unchanged query and timestamps. Summarize returned records and disclose remaining pages.\n\n## Output\nReport the observed results and any remaining continuation or incomplete work.',
    },
    {
      name: 'review-oci-log-retention',
      description: 'Review log retention.',
      content:
        '# Review log retention\n\n## Steps\nList groups and logs, preserving continuation even on empty pages. Get a log and its ETag. Update only intended retention settings using ifMatch. Track workRequestId to SUCCEEDED or FAILED, and inspect errors on failure.\n\n## Output\nReport the observed results and any remaining continuation or incomplete work.',
    },
    {
      name: 'ingest-oci-custom-logs',
      description: 'Send custom log batches.',
      content:
        '# Send custom log batches\n\n## Steps\nChoose a CUSTOM log. Build batches with stable caller-supplied entry IDs, source, type and defaultlogentrytime in RFC3339 with milliseconds. Send Put Logs once. Report acceptance only. Do not blindly replay after network failure or cancellation; indexing completion and per-entry outcomes are unavailable.\n\n## Output\nReport the observed results and any remaining continuation or incomplete work.',
    },
    {
      name: 'run-oci-saved-search',
      description: 'Reuse a stored native query.',
      content:
        '# Reuse a stored native query\n\n## Steps\nList saved searches in a compartment. Get the chosen search and read query. Pass query unchanged to Search Logs with explicit timeStart and timeEnd. Summarize projected records and preserve continuation.\n\n## Output\nReport the observed results and any remaining continuation or incomplete work.',
    },
    {
      name: 'diagnose-oci-work-request',
      description: 'Diagnose Logging management failures.',
      content:
        '# Diagnose Logging management failures\n\n## Steps\nGet Work Request using the ID from a management mutation. Honor retryAfter before polling. Inspect status, progress and resources. On FAILED, list errors and report their code, message and timestamp. Canceling a workflow does not cancel Oracle work.\n\n## Output\nReport the observed results and any remaining continuation or incomplete work.',
    },
    {
      name: 'investigate-oci-flow-logs',
      description: 'Investigate VCN flow records.',
      content:
        '# Investigate VCN flow records\n\n## Steps\nLocate the enabled service log for the subnet. Query its compartment/group/log scope over a fixed window. Filter or aggregate fields actually present in flow records. Summarize observed traffic without inventing absent fields.\n\n## Output\nReport the observed results and any remaining continuation or incomplete work.',
    },
    {
      name: 'trace-oci-data-integration',
      description: 'Trace Data Integration tasks.',
      content:
        '# Trace Data Integration tasks\n\n## Steps\nLocate the enabled Data Integration service log. Search a fixed window covering the task run. Filter by task identifiers actually present in log data. Summarize observed failures and retain the query and continuation.\n\n## Output\nReport the observed results and any remaining continuation or incomplete work.',
    },
  ],
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'OCI error triage',
      prompt:
        'Build a scheduled workflow that searches an OCI log for errors in a fixed window, summarizes evidence, and posts it to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: NetSuiteIcon,
      title: 'OCI retention review',
      prompt:
        'Build a workflow that inventories OCI log retention across groups and reports logs outside a supplied policy.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'OCI custom log ingestion',
      prompt:
        'Create a workflow that sends application events with stable IDs as OCI custom log batches and reports acceptance.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'OCI saved search digest',
      prompt:
        'Build a scheduled workflow that retrieves an OCI saved query, runs it with explicit timestamps, and emails a digest.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: NetSuiteIcon,
      title: 'OCI work request diagnosis',
      prompt:
        'Create a workflow that checks a Logging work request and summarizes its errors if it fails.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'OCI flow log investigation',
      prompt:
        'Build a workflow that searches an enabled OCI VCN flow log for a supplied subnet and window and summarizes traffic.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'OCI task run investigation',
      prompt:
        'Build a workflow that searches enabled OCI Data Integration logs for a task run and summarizes observed errors.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
    },
  ],
} as const satisfies BlockMeta
