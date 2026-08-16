import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'
import type { NetSuiteResponse } from '@/tools/netsuite/types'

const RECORD_TYPE_OPERATIONS = [
  'netsuite_list_records',
  'netsuite_get_record',
  'netsuite_create_record',
  'netsuite_update_record',
  'netsuite_upsert_record',
  'netsuite_delete_record',
  'netsuite_get_subresource',
  'netsuite_get_record_form',
  'netsuite_get_select_options',
  'netsuite_attach_record',
  'netsuite_detach_record',
  'netsuite_execute_action',
  'netsuite_transform_record',
  'netsuite_batch_get_records',
  'netsuite_batch_create_records',
  'netsuite_batch_update_records',
  'netsuite_batch_upsert_records',
  'netsuite_batch_delete_records',
  'netsuite_get_record_metadata',
]

const RECORD_ID_OPERATIONS = [
  'netsuite_get_record',
  'netsuite_update_record',
  'netsuite_delete_record',
  'netsuite_get_subresource',
  'netsuite_get_record_form',
  'netsuite_get_select_options',
  'netsuite_attach_record',
  'netsuite_detach_record',
  'netsuite_execute_action',
  'netsuite_transform_record',
]

const REQUIRED_RECORD_ID_OPERATIONS = RECORD_ID_OPERATIONS.filter(
  (operation) =>
    operation !== 'netsuite_get_record_form' && operation !== 'netsuite_get_select_options'
)

const BODY_OPERATIONS = [
  'netsuite_create_record',
  'netsuite_update_record',
  'netsuite_upsert_record',
  'netsuite_get_record_form',
  'netsuite_get_select_options',
  'netsuite_execute_action',
  'netsuite_transform_record',
]

const REQUIRED_BODY_OPERATIONS = [
  'netsuite_create_record',
  'netsuite_update_record',
  'netsuite_upsert_record',
]

const PAGING_OPERATIONS = [
  'netsuite_list_records',
  'netsuite_get_select_options',
  'netsuite_execute_suiteql',
  'netsuite_list_datasets',
  'netsuite_execute_dataset',
]

const RECORD_QUERY_OPERATIONS = [
  'netsuite_get_record',
  'netsuite_get_record_form',
  'netsuite_batch_get_records',
]

const BATCH_OPERATIONS = [
  'netsuite_batch_get_records',
  'netsuite_batch_create_records',
  'netsuite_batch_update_records',
  'netsuite_batch_upsert_records',
  'netsuite_batch_delete_records',
]

const LOCATION_OPERATIONS = [
  'netsuite_create_record',
  'netsuite_update_record',
  'netsuite_upsert_record',
  'netsuite_transform_record',
  ...BATCH_OPERATIONS,
]

const BATCH_WRITE_OPERATIONS = [
  'netsuite_batch_create_records',
  'netsuite_batch_update_records',
  'netsuite_batch_upsert_records',
]

function usesOperation(operation: unknown, operations: readonly string[]): boolean {
  return typeof operation === 'string' && operations.includes(operation)
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

function parseJson(value: unknown, label: string): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

export const NetSuiteBlock: BlockConfig<NetSuiteResponse> = {
  type: 'netsuite',
  name: 'Oracle NetSuite',
  description: 'Manage NetSuite records, queries, datasets, batches, and async jobs',
  longDescription:
    'Connect a reusable Oracle NetSuite service-account credential to SuiteTalk REST Web Services. Read and write account-specific records, execute SuiteQL and SuiteAnalytics datasets, run asynchronous record batches, inspect metadata, and monitor async jobs.',
  docsLink: 'https://docs.sim.ai/integrations/netsuite',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle NetSuite',
    sentences: {
      byOperation: {
        netsuite_list_records: [
          {
            text: 'List records from',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'records' },
          { text: ', starting at offset', field: 'offset' },
        ],
        netsuite_get_record: [
          {
            text: 'Read',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record', field: 'recordId', core: true },
          { text: ', returning', field: 'fields' },
          { text: ', expanding', field: 'expand' },
          { text: ', with subresources', field: 'expandSubResources' },
        ],
        netsuite_create_record: [
          {
            text: 'Create',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record with', field: 'body' },
          { text: ', replacing sublists', field: 'replace' },
        ],
        netsuite_update_record: [
          {
            text: 'Update',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record', field: 'recordId', core: true },
          { text: ', setting', field: 'body' },
          { text: ', replacing sublists', field: 'replace' },
        ],
        netsuite_upsert_record: [
          {
            text: 'Upsert',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record by external ID', field: 'externalId', core: true },
          { text: ', setting', field: 'body' },
        ],
        netsuite_delete_record: [
          {
            text: 'Delete',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record', field: 'recordId', core: true },
        ],
        netsuite_get_subresource: [
          { text: 'Read subresource', field: 'subresourcePath', core: true },
          {
            text: 'from',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record', field: 'recordId', core: true },
        ],
        netsuite_get_record_form: [
          {
            text: 'Get the form for',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record', field: 'recordId' },
          { text: ', prefilled with', field: 'body' },
          { text: ', returning', field: 'fields' },
          { text: ', expanding', field: 'expand' },
          { text: ', with subresources', field: 'expandSubResources' },
        ],
        netsuite_get_select_options: [
          { text: 'Get select options for', field: 'fields', core: true },
          {
            text: 'on',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record', field: 'recordId' },
          { text: ', matching', field: 'q' },
          { text: ', using', field: 'body' },
          { text: ', up to', field: 'limit', after: 'options' },
          { text: ', starting at offset', field: 'offset' },
        ],
        netsuite_attach_record: [
          { text: 'Attach', field: 'relatedType', core: true },
          { text: 'ID', field: 'relatedId', core: true },
          {
            text: 'to',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record', field: 'recordId', core: true },
          { text: ', with role ID', field: 'roleId' },
          { text: ', or role external ID', field: 'roleExternalId' },
        ],
        netsuite_detach_record: [
          { text: 'Detach', field: 'relatedType', core: true },
          { text: 'ID', field: 'relatedId', core: true },
          {
            text: 'from',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record', field: 'recordId', core: true },
        ],
        netsuite_execute_action: [
          { text: 'Run action', field: 'action', core: true },
          {
            text: 'on',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record', field: 'recordId', core: true },
          { text: ', with', field: 'body' },
        ],
        netsuite_transform_record: [
          {
            text: 'Transform',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'record', field: 'recordId', core: true },
          { text: 'into', field: 'targetRecordType', core: true },
          { text: ', with', field: 'body' },
        ],
        netsuite_batch_get_records: [
          {
            text: 'Retrieve a batch of',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'records', field: 'ids', core: true },
          { text: ', returning', field: 'fields' },
          { text: ', expanding', field: 'expand' },
          { text: ', with subresources', field: 'expandSubResources' },
          { text: ', using idempotency key', field: 'idempotencyKey' },
        ],
        netsuite_batch_create_records: [
          {
            text: 'Create a batch of',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'records', field: 'items', core: true },
          { text: ', using idempotency key', field: 'idempotencyKey' },
        ],
        netsuite_batch_update_records: [
          {
            text: 'Update a batch of',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'records', field: 'items', core: true },
          { text: ', using idempotency key', field: 'idempotencyKey' },
        ],
        netsuite_batch_upsert_records: [
          {
            text: 'Upsert a batch of',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'records', field: 'items', core: true },
          { text: ', using idempotency key', field: 'idempotencyKey' },
        ],
        netsuite_batch_delete_records: [
          {
            text: 'Delete a batch of',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: 'records', field: 'ids', core: true },
          { text: ', using idempotency key', field: 'idempotencyKey' },
        ],
        netsuite_execute_suiteql: [
          { text: 'Run SuiteQL', field: 'query', core: true },
          { text: ', up to', field: 'limit', after: 'rows' },
          { text: ', starting at offset', field: 'offset' },
        ],
        netsuite_list_datasets: [
          'List SuiteAnalytics datasets',
          { text: ', up to', field: 'limit', after: 'datasets' },
          { text: ', starting at offset', field: 'offset' },
        ],
        netsuite_execute_dataset: [
          {
            text: 'Execute SuiteAnalytics dataset',
            field: 'datasetId',
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'rows' },
          { text: ', starting at offset', field: 'offset' },
        ],
        netsuite_list_record_types: ['List available record types'],
        netsuite_get_record_metadata: [
          {
            text: 'Get metadata for',
            field: ['recordTypeSelector', 'recordTypeManual'],
            core: true,
          },
          { text: ', in format', field: 'format' },
        ],
        netsuite_get_async_status: [
          { text: 'Get async job', field: 'jobId', core: true },
          { text: 'view', field: 'view' },
          {
            text: 'for task',
            field: ['statusTaskSelector', 'statusTaskIdManual'],
          },
        ],
        netsuite_get_async_result: [
          { text: 'Get result from async job', field: 'jobId', core: true },
          {
            text: 'for task',
            field: ['resultTaskSelector', 'resultTaskIdManual'],
            core: true,
          },
        ],
        netsuite_get_server_time: ['Get server time'],
        netsuite_get_governance_limits: ['Get governance limits'],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'NetSuite Account',
      type: 'oauth-input',
      serviceId: 'netsuite',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select NetSuite credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'NetSuite Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List/Search Records', id: 'netsuite_list_records' },
        { label: 'Get Record', id: 'netsuite_get_record' },
        { label: 'Create Record', id: 'netsuite_create_record' },
        { label: 'Update Record', id: 'netsuite_update_record' },
        { label: 'Upsert Record', id: 'netsuite_upsert_record' },
        { label: 'Delete Record', id: 'netsuite_delete_record' },
        { label: 'Get Subresource', id: 'netsuite_get_subresource' },
        { label: 'Get Record Form', id: 'netsuite_get_record_form' },
        { label: 'Get Select Options', id: 'netsuite_get_select_options' },
        { label: 'Attach Record or File', id: 'netsuite_attach_record' },
        { label: 'Detach Record or File', id: 'netsuite_detach_record' },
        { label: 'Execute Record Action', id: 'netsuite_execute_action' },
        { label: 'Transform Record', id: 'netsuite_transform_record' },
        { label: 'Batch Get Records', id: 'netsuite_batch_get_records' },
        { label: 'Batch Create Records', id: 'netsuite_batch_create_records' },
        { label: 'Batch Update Records', id: 'netsuite_batch_update_records' },
        { label: 'Batch Upsert Records', id: 'netsuite_batch_upsert_records' },
        { label: 'Batch Delete Records', id: 'netsuite_batch_delete_records' },
        { label: 'Execute SuiteQL', id: 'netsuite_execute_suiteql' },
        { label: 'List SuiteAnalytics Datasets', id: 'netsuite_list_datasets' },
        { label: 'Execute SuiteAnalytics Dataset', id: 'netsuite_execute_dataset' },
        { label: 'List Record Types', id: 'netsuite_list_record_types' },
        { label: 'Get Record Metadata', id: 'netsuite_get_record_metadata' },
        { label: 'Get Async Status', id: 'netsuite_get_async_status' },
        { label: 'Get Async Operation Result', id: 'netsuite_get_async_result' },
        { label: 'Get Server Time', id: 'netsuite_get_server_time' },
        { label: 'Get Governance Limits', id: 'netsuite_get_governance_limits' },
      ],
      value: () => 'netsuite_list_records',
      required: true,
    },
    {
      id: 'recordTypeSelector',
      title: 'Record Type',
      type: 'project-selector',
      canonicalParamId: 'recordType',
      serviceId: 'netsuite',
      selectorKey: 'netsuite.recordTypes',
      placeholder: 'Select record type',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: RECORD_TYPE_OPERATIONS },
      required: { field: 'operation', value: RECORD_TYPE_OPERATIONS },
    },
    {
      id: 'recordTypeManual',
      title: 'Record Type',
      type: 'short-input',
      canonicalParamId: 'recordType',
      placeholder: 'customer, salesOrder, purchaseOrder, ...',
      mode: 'advanced',
      condition: { field: 'operation', value: RECORD_TYPE_OPERATIONS },
      required: { field: 'operation', value: RECORD_TYPE_OPERATIONS },
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'Internal ID or eid:EXTERNAL_ID',
      condition: { field: 'operation', value: RECORD_ID_OPERATIONS },
      required: { field: 'operation', value: REQUIRED_RECORD_ID_OPERATIONS },
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'External ID without the eid: prefix',
      condition: { field: 'operation', value: 'netsuite_upsert_record' },
      required: { field: 'operation', value: 'netsuite_upsert_record' },
    },
    {
      id: 'q',
      title: 'Filter',
      type: 'long-input',
      placeholder: "email START_WITH 'billing@'",
      wandConfig: {
        enabled: true,
        prompt: `Generate a NetSuite SuiteTalk REST record q filter from the user's request.

Use NetSuite record field script IDs and valid SuiteTalk filter syntax. Follow this form: email START_WITH 'billing@'.

Return ONLY the q filter expression - no explanations, no extra text.`,
        placeholder: 'Describe the NetSuite records to filter',
      },
      condition: {
        field: 'operation',
        value: ['netsuite_list_records', 'netsuite_get_select_options'],
      },
    },
    {
      id: 'fields',
      title: 'Fields',
      type: 'short-input',
      placeholder: 'Comma-separated field IDs',
      condition: {
        field: 'operation',
        value: [...RECORD_QUERY_OPERATIONS, 'netsuite_get_select_options'],
      },
      required: { field: 'operation', value: 'netsuite_get_select_options' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of NetSuite field script IDs from the user's request.

Return ONLY the comma-separated field IDs - no explanations, no extra text.`,
        placeholder: 'Describe the fields to return',
      },
    },
    {
      id: 'body',
      title: 'Request Body (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{"companyName":"Acme Inc."}',
      condition: { field: 'operation', value: BODY_OPERATIONS },
      required: { field: 'operation', value: REQUIRED_BODY_OPERATIONS },
    },
    {
      id: 'subresourcePath',
      title: 'Subresource Path',
      type: 'short-input',
      placeholder: 'item or item/3',
      condition: { field: 'operation', value: 'netsuite_get_subresource' },
      required: { field: 'operation', value: 'netsuite_get_subresource' },
    },
    {
      id: 'relatedType',
      title: 'Related Type',
      type: 'dropdown',
      options: [
        { label: 'Contact', id: 'contact' },
        { label: 'File', id: 'file' },
      ],
      value: () => 'contact',
      condition: {
        field: 'operation',
        value: ['netsuite_attach_record', 'netsuite_detach_record'],
      },
      required: {
        field: 'operation',
        value: ['netsuite_attach_record', 'netsuite_detach_record'],
      },
    },
    {
      id: 'relatedId',
      title: 'Contact or File ID',
      type: 'short-input',
      placeholder: 'Internal ID or eid:EXTERNAL_ID',
      condition: {
        field: 'operation',
        value: ['netsuite_attach_record', 'netsuite_detach_record'],
      },
      required: {
        field: 'operation',
        value: ['netsuite_attach_record', 'netsuite_detach_record'],
      },
    },
    {
      id: 'roleId',
      title: 'Contact Role ID',
      type: 'short-input',
      placeholder: '-10',
      condition: {
        field: 'operation',
        value: 'netsuite_attach_record',
        and: { field: 'relatedType', value: 'contact' },
      },
      mode: 'advanced',
    },
    {
      id: 'roleExternalId',
      title: 'Contact Role External ID',
      type: 'short-input',
      placeholder: 'family',
      condition: {
        field: 'operation',
        value: 'netsuite_attach_record',
        and: { field: 'relatedType', value: 'contact' },
      },
      mode: 'advanced',
    },
    {
      id: 'action',
      title: 'Action',
      type: 'short-input',
      placeholder: 'approve, reject, confirm, ...',
      condition: { field: 'operation', value: 'netsuite_execute_action' },
      required: { field: 'operation', value: 'netsuite_execute_action' },
    },
    {
      id: 'targetRecordType',
      title: 'Target Record Type',
      type: 'short-input',
      placeholder: 'invoice, itemFulfillment, ...',
      condition: { field: 'operation', value: 'netsuite_transform_record' },
      required: { field: 'operation', value: 'netsuite_transform_record' },
    },
    {
      id: 'ids',
      title: 'Record IDs',
      type: 'long-input',
      placeholder: '1,2,eid:EXT-3',
      condition: {
        field: 'operation',
        value: ['netsuite_batch_get_records', 'netsuite_batch_delete_records'],
      },
      required: {
        field: 'operation',
        value: ['netsuite_batch_get_records', 'netsuite_batch_delete_records'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of NetSuite internal IDs or eid: external-ID references from the user's request.

Return ONLY the comma-separated IDs - no explanations, no extra text.`,
        placeholder: 'Describe the record IDs to include',
      },
    },
    {
      id: 'items',
      title: 'Records (JSON Array)',
      type: 'code',
      language: 'json',
      placeholder: '[{"id":"7","email":"billing@example.com"}]',
      condition: {
        field: 'operation',
        value: [
          'netsuite_batch_create_records',
          'netsuite_batch_update_records',
          'netsuite_batch_upsert_records',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'netsuite_batch_create_records',
          'netsuite_batch_update_records',
          'netsuite_batch_upsert_records',
        ],
      },
    },
    {
      id: 'query',
      title: 'SuiteQL Query',
      type: 'code',
      placeholder: 'SELECT id, entityid FROM customer ORDER BY id',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate a read-only SuiteQL SELECT query from the user's request.

Use NetSuite2.com record and field names, select only necessary fields, and add a stable unique ORDER BY when results may be paged.

Return ONLY the SuiteQL query - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the NetSuite report or records to query',
        generationType: 'sql-query',
      },
      condition: { field: 'operation', value: 'netsuite_execute_suiteql' },
      required: { field: 'operation', value: 'netsuite_execute_suiteql' },
    },
    {
      id: 'datasetId',
      title: 'Dataset ID',
      type: 'short-input',
      placeholder: 'customworkbook237',
      condition: { field: 'operation', value: 'netsuite_execute_dataset' },
      required: { field: 'operation', value: 'netsuite_execute_dataset' },
    },
    {
      id: 'jobId',
      title: 'Async Job ID',
      type: 'short-input',
      placeholder: 'Job ID from a batch Location response',
      condition: {
        field: 'operation',
        value: ['netsuite_get_async_status', 'netsuite_get_async_result'],
      },
      required: {
        field: 'operation',
        value: ['netsuite_get_async_status', 'netsuite_get_async_result'],
      },
    },
    {
      id: 'view',
      title: 'Async Status View',
      type: 'dropdown',
      options: [
        { label: 'Job Status', id: 'job' },
        { label: 'List Tasks', id: 'tasks' },
        { label: 'Task Status', id: 'task' },
      ],
      value: () => 'job',
      condition: { field: 'operation', value: 'netsuite_get_async_status' },
    },
    {
      id: 'statusTaskSelector',
      title: 'Async Task ID',
      type: 'project-selector',
      canonicalParamId: 'statusTaskId',
      serviceId: 'netsuite',
      selectorKey: 'netsuite.asyncTasks',
      placeholder: 'Select task',
      dependsOn: ['credential', 'jobId'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: 'netsuite_get_async_status',
        and: { field: 'view', value: 'task' },
      },
      required: {
        field: 'operation',
        value: 'netsuite_get_async_status',
        and: { field: 'view', value: 'task' },
      },
    },
    {
      id: 'statusTaskIdManual',
      title: 'Async Task ID',
      type: 'short-input',
      canonicalParamId: 'statusTaskId',
      placeholder: 'Task ID returned by List Tasks',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'netsuite_get_async_status',
        and: { field: 'view', value: 'task' },
      },
      required: {
        field: 'operation',
        value: 'netsuite_get_async_status',
        and: { field: 'view', value: 'task' },
      },
    },
    {
      id: 'resultTaskSelector',
      title: 'Async Task ID',
      type: 'project-selector',
      canonicalParamId: 'resultTaskId',
      serviceId: 'netsuite',
      selectorKey: 'netsuite.asyncTasks',
      placeholder: 'Select completed task',
      dependsOn: ['credential', 'jobId'],
      mode: 'basic',
      condition: { field: 'operation', value: 'netsuite_get_async_result' },
      required: { field: 'operation', value: 'netsuite_get_async_result' },
    },
    {
      id: 'resultTaskIdManual',
      title: 'Async Task ID',
      type: 'short-input',
      canonicalParamId: 'resultTaskId',
      placeholder: 'Completed task ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'netsuite_get_async_result' },
      required: { field: 'operation', value: 'netsuite_get_async_result' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100 (maximum 1000)',
      condition: { field: 'operation', value: PAGING_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0 (multiple of limit; first 100,000 results)',
      condition: { field: 'operation', value: PAGING_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'expand',
      title: 'Expand',
      type: 'short-input',
      placeholder: 'Comma-separated resources',
      condition: { field: 'operation', value: RECORD_QUERY_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'expandSubResources',
      title: 'Expand Subresources',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: RECORD_QUERY_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'replace',
      title: 'Replace Sublists',
      type: 'short-input',
      placeholder: 'Comma-separated sublist IDs',
      condition: {
        field: 'operation',
        value: ['netsuite_create_record', 'netsuite_update_record'],
      },
      mode: 'advanced',
    },
    {
      id: 'idempotencyKey',
      title: 'Idempotency Key',
      type: 'short-input',
      placeholder: 'Unique key for safe batch retries',
      condition: { field: 'operation', value: BATCH_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'format',
      title: 'Metadata Format',
      type: 'dropdown',
      options: [
        { label: 'Default', id: 'default' },
        { label: 'OpenAPI', id: 'openapi' },
        { label: 'JSON Schema', id: 'json_schema' },
      ],
      value: () => 'default',
      condition: { field: 'operation', value: 'netsuite_get_record_metadata' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'netsuite_list_records',
      'netsuite_get_record',
      'netsuite_create_record',
      'netsuite_update_record',
      'netsuite_upsert_record',
      'netsuite_delete_record',
      'netsuite_get_subresource',
      'netsuite_get_record_form',
      'netsuite_get_select_options',
      'netsuite_attach_record',
      'netsuite_detach_record',
      'netsuite_execute_action',
      'netsuite_transform_record',
      'netsuite_batch_get_records',
      'netsuite_batch_create_records',
      'netsuite_batch_update_records',
      'netsuite_batch_upsert_records',
      'netsuite_batch_delete_records',
      'netsuite_execute_suiteql',
      'netsuite_list_datasets',
      'netsuite_execute_dataset',
      'netsuite_list_record_types',
      'netsuite_get_record_metadata',
      'netsuite_get_async_status',
      'netsuite_get_async_result',
      'netsuite_get_server_time',
      'netsuite_get_governance_limits',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        if (typeof params.operation !== 'string') return {}
        const { operation, resultTaskId, statusTaskId, ...rest } = params
        const taskId =
          operation === 'netsuite_get_async_status'
            ? statusTaskId
            : operation === 'netsuite_get_async_result'
              ? resultTaskId
              : undefined
        return {
          ...rest,
          body: usesOperation(operation, BODY_OPERATIONS)
            ? parseJson(rest.body, 'Record fields')
            : undefined,
          items: usesOperation(operation, BATCH_WRITE_OPERATIONS)
            ? parseJson(rest.items, 'Records')
            : undefined,
          limit: usesOperation(operation, PAGING_OPERATIONS)
            ? parseOptionalNumberInput(rest.limit, 'Limit', {
                integer: true,
                min: 1,
                max: 1_000,
              })
            : undefined,
          offset: usesOperation(operation, PAGING_OPERATIONS)
            ? parseOptionalNumberInput(rest.offset, 'Offset', { integer: true, min: 0 })
            : undefined,
          expand: usesOperation(operation, RECORD_QUERY_OPERATIONS) ? rest.expand : undefined,
          expandSubResources: usesOperation(operation, RECORD_QUERY_OPERATIONS)
            ? optionalBoolean(rest.expandSubResources)
            : undefined,
          roleId:
            operation === 'netsuite_attach_record' && rest.relatedType === 'contact'
              ? rest.roleId
              : undefined,
          roleExternalId:
            operation === 'netsuite_attach_record' && rest.relatedType === 'contact'
              ? rest.roleExternalId
              : undefined,
          taskId,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'NetSuite operation to perform' },
    oauthCredential: { type: 'string', description: 'NetSuite service-account credential' },
    recordType: { type: 'string', description: 'REST record type script ID' },
    recordId: { type: 'string', description: 'Internal or external record ID' },
    externalId: { type: 'string', description: 'External ID used for upsert' },
    q: { type: 'string', description: 'Record or select-option filter expression' },
    fields: { type: 'string', description: 'Comma-separated field IDs' },
    body: {
      type: 'json',
      description: 'Account-specific record fields or parameters for a selected record action',
    },
    subresourcePath: { type: 'string', description: 'Record subresource path' },
    relatedType: { type: 'string', description: 'Related contact or file type' },
    relatedId: {
      type: 'string',
      description: 'Related contact or file internal ID or eid: external-ID reference',
    },
    roleId: { type: 'string', description: 'Optional contact role ID' },
    roleExternalId: { type: 'string', description: 'Optional contact role external ID' },
    action: { type: 'string', description: 'Record action name' },
    targetRecordType: { type: 'string', description: 'Record transformation target type' },
    ids: { type: 'string', description: 'Comma-separated batch record IDs' },
    items: { type: 'array', description: 'Homogeneous batch record collection' },
    query: { type: 'string', description: 'SuiteQL query' },
    datasetId: { type: 'string', description: 'SuiteAnalytics dataset script ID' },
    jobId: { type: 'string', description: 'Asynchronous job ID' },
    view: { type: 'string', description: 'Job-status, task-list, or task-status view' },
    statusTaskId: { type: 'string', description: 'Task ID for async status lookup' },
    resultTaskId: { type: 'string', description: 'Task ID for async result retrieval' },
    limit: { type: 'number', description: 'Page size (1-1000)' },
    offset: {
      type: 'number',
      description:
        'Page offset divisible by limit and within the first 100,000 results and 1,000 pages',
    },
    expand: { type: 'string', description: 'Resources to expand' },
    expandSubResources: { type: 'boolean', description: 'Expand sublists and subrecords' },
    replace: { type: 'string', description: 'Sublists replaced during create or update' },
    idempotencyKey: { type: 'string', description: 'Unique key for asynchronous batch retries' },
    format: { type: 'string', description: 'Metadata representation' },
  },
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description:
        'NetSuite payload: account-specific record fields, collection items and paging fields, metadata, or async task data',
    },
    location: {
      type: 'string',
      description: 'Record resource or async job location returned by NetSuite',
      condition: { field: 'operation', value: LOCATION_OPERATIONS },
    },
    jobId: {
      type: 'string',
      description: 'Async job ID parsed from the Location header',
      condition: { field: 'operation', value: BATCH_OPERATIONS },
    },
  },
}

export const NetSuiteBlockMeta = {
  tags: ['automation', 'data-analytics', 'payments'],
  url: 'https://www.netsuite.com',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Synchronize NetSuite customers',
      prompt:
        'Build a scheduled workflow that queries customers changed since the last run, upserts them into the destination CRM by external ID, and stores the new NetSuite server time for the next sync.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'data-sync'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Process NetSuite sales orders',
      prompt:
        'Create a workflow that looks up an approved NetSuite sales order, validates its lines, transforms it into an item fulfillment, and reports the completed transformation status.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'order-management'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Reconcile vendors and purchase orders',
      prompt:
        'Build a scheduled workflow that runs SuiteQL to compare open purchase orders with vendor records, flags missing or mismatched vendor details, and writes the reconciliation report to a table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor NetSuite inventory',
      prompt:
        'Create a scheduled workflow that uses SuiteQL to find inventory items below reorder point, enriches each item with its NetSuite record, and sends an operations digest.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'inventory'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Generate SuiteQL finance reports',
      prompt:
        'Build a workflow that accepts a reporting period, executes a bounded SuiteQL financial query with a stable ORDER BY clause, and stores the returned page in a table for review.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Export SuiteAnalytics datasets',
      prompt:
        'Create a scheduled workflow that lists available NetSuite SuiteAnalytics datasets, executes the selected dataset one page at a time, and writes each export page to a file.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'data-export'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Import records with async batches',
      prompt:
        'Build a workflow that validates up to 100 homogeneous NetSuite records against metadata, submits an asynchronous batch upsert with an idempotency key, lists its tasks, checks each task, and retrieves every completed result.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'data-sync'],
    },
  ],
  skills: [
    {
      name: 'lookup-netsuite-records',
      description: 'Find NetSuite records safely and retrieve the details needed by a workflow.',
      content:
        '# Look Up NetSuite Records\n\n## Steps\n\n1. Use List/Search Records with the exact record type and the narrowest supported q filter.\n2. Keep limit at 100 unless the user requests another page; do not auto-fetch pages.\n3. Use Get Record with the returned ID when full fields or subresources are needed.\n\n## Output\n\nReturn the record ID, requested business fields, and the page offset used.',
    },
    {
      name: 'change-netsuite-records-with-metadata',
      description:
        'Use account metadata to prepare safe create, update, upsert, and transform bodies.',
      content:
        '# Change NetSuite Records with Metadata\n\n## Steps\n\n1. Get Record Metadata for the target record type, using JSON Schema when field structure is needed.\n2. Construct only the documented fields required for the requested change.\n3. Prefer Upsert Record with a stable external ID for synchronization.\n4. Use Update Record for known internal IDs and include Replace Sublists only when replacement is intentional.\n\n## Output\n\nReport the HTTP status. Include Location for create and update when returned; retain the external ID for upserts and the source and target record context for transforms.',
    },
    {
      name: 'query-netsuite-financial-data',
      description: 'Run bounded, deterministic SuiteQL financial queries.',
      content:
        '# Query NetSuite Financial Data\n\n## Steps\n\n1. Write SuiteQL using NetSuite2.com record and field names.\n2. Add a stable, unique ORDER BY clause whenever results may be paged.\n3. Select only the fields needed for the report.\n4. Execute one page with limit at most 1000 and an offset divisible by the limit.\n\n## Output\n\nState whether additional pages remain rather than fetching them automatically.',
    },
    {
      name: 'synchronize-netsuite-records-in-batches',
      description: 'Submit independent asynchronous record batches with idempotency keys.',
      content:
        '# Synchronize NetSuite Records in Batches\n\n## Steps\n\n1. Group only independent records by one NetSuite record type and operation.\n2. Validate each record against NetSuite metadata and split input into batches of at most 100.\n3. Use an idempotency key unique to each batch.\n4. Submit the matching Batch Create, Update, Upsert, Get, or Delete operation.\n\n## Output\n\nPreserve the returned Location and job ID, inspect every task result, and report failures separately; do not treat submission as all-or-none success.',
    },
    {
      name: 'monitor-netsuite-async-jobs',
      description:
        'Follow NetSuite asynchronous jobs through completion and retrieve task results.',
      content:
        '# Monitor NetSuite Async Jobs\n\n## Steps\n\n1. Use Get Async Status with the job ID parsed from the batch Location header and choose Job Status.\n2. Wait until the documented completed state is true, then choose List Tasks and collect each task ID.\n3. Choose Task Status to check each task separately.\n4. Use Get Async Operation Result with both job ID and task ID.\n\n## Output\n\nReport failed task details separately and never resubmit without the original idempotency strategy.',
    },
  ],
} as const satisfies BlockMeta
