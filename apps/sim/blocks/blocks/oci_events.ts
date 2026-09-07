import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { OciEventsResponse } from '@/tools/oci_events/types'

const RULE_FIELD = ['ruleSelector', 'ruleIdInput'] as const

export const OciEventsBlock: BlockConfig<OciEventsResponse> = {
  type: 'oci_events',
  name: 'OCI Events',
  description: 'Discover and manage OCI event routing rules',
  longDescription:
    'Manage OCI Events rules using a reusable OCI API signing-key credential. List and inspect rules, create routing to existing Notifications topics, Streaming streams or Functions, update conditions and enabled states, move rules, and delete rules. Conditions match events in the rule compartment and child compartments. Updates replace supplied actions and tag maps; omit fields to retain them and use an ETag to protect concurrent changes. IAM must permit rule management and the selected action destinations. Sim limits requests to 1 MiB, responses to 8 MiB and each JSON input to 10000 values, 32 nesting levels and 1 MiB of text. This integration manages routing configuration; it does not receive events or start Sim workflows. Topic subscriptions, stream consumption and function management belong to their respective services.',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  authMode: AuthMode.ApiKey,
  docsLink: 'https://docs.sim.ai/integrations/oci_events',
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Events',
    sentences: {
      byOperation: {
        list_rules: [{ text: 'List rules in', field: 'compartmentId', core: true }],
        get_rule: [{ text: 'Get rule', field: RULE_FIELD, core: true }],
        create_rule: [{ text: 'Create rule', field: 'displayName', core: true }],
        update_rule: [{ text: 'Update rule', field: RULE_FIELD, core: true }],
        delete_rule: [{ text: 'Delete rule', field: RULE_FIELD, core: true }],
        change_rule_compartment: [
          { text: 'Move rule', field: RULE_FIELD, core: true },
          { text: 'to', field: 'destinationCompartmentId', core: true },
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
        { label: 'List Rules', id: 'list_rules' },
        { label: 'Get Rule', id: 'get_rule' },
        { label: 'Create Rule', id: 'create_rule' },
        { label: 'Update Rule', id: 'update_rule' },
        { label: 'Delete Rule', id: 'delete_rule' },
        { label: 'Change Rule Compartment', id: 'change_rule_compartment' },
      ],
      value: () => 'list_rules',
    },
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci_events',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      requiredScopes: getScopesForService('oci_events'),
      mode: 'basic',
      required: true,
      placeholder: 'Select an OCI credential',
    },
    {
      id: 'manualCredential',
      title: 'OCI Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Enter a credential ID',
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      required: false,
      placeholder: 'Optional override; defaults to the credential region',
    },
    {
      id: 'compartmentId',
      title: 'Compartment',
      type: 'short-input',
      required: { field: 'operation', value: ['list_rules', 'create_rule'] },
      placeholder: 'Compartment OCID; also scopes the rule picker',
    },
    {
      id: 'ruleSelector',
      title: 'Rule',
      type: 'file-selector',
      canonicalParamId: 'ruleId',
      selectorKey: 'oci_events.rules',
      dependsOn: {
        all: ['oauthCredential', 'compartmentId'],
        any: ['oauthCredential', 'region', 'compartmentId'],
      },
      mode: 'basic',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_rule', 'update_rule', 'delete_rule', 'change_rule_compartment'],
      },
      placeholder: 'Select a rule',
    },
    {
      id: 'ruleIdInput',
      title: 'Rule',
      type: 'short-input',
      canonicalParamId: 'ruleId',
      mode: 'advanced',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_rule', 'update_rule', 'delete_rule', 'change_rule_compartment'],
      },
      placeholder: 'Rule OCID or reference',
    },
    {
      id: 'destinationCompartmentId',
      title: 'Destination Compartment',
      type: 'short-input',
      condition: { field: 'operation', value: ['change_rule_compartment'] },
      required: true,
      placeholder: 'Destination compartment OCID in the same tenancy',
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_rules', 'create_rule', 'update_rule'] },
      required: { field: 'operation', value: ['create_rule'] },
      placeholder: 'Rule name; on List Rules this is the OCI name filter',
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      condition: { field: 'operation', value: ['create_rule', 'update_rule'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Omit to keep the description; an explicit empty string clears it on update',
    },
    {
      id: 'isEnabled',
      title: 'Rule Enabled',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_rule', 'update_rule'] },
      required: { field: 'operation', value: ['create_rule'] },
      options: (params) => {
        const choices = [
          { label: 'Enabled', id: 'true' },
          { label: 'Disabled', id: 'false' },
        ]
        return params?.values.operation === 'update_rule'
          ? [{ label: 'Keep current', id: '' }, ...choices]
          : choices
      },
    },
    {
      id: 'condition',
      title: 'Condition',
      type: 'code',
      condition: { field: 'operation', value: ['create_rule', 'update_rule'] },
      required: { field: 'operation', value: ['create_rule'] },
      placeholder: '{"eventType":"com.oraclecloud.objectstorage.createbucket"}',
      wandConfig: {
        enabled: true,
        prompt:
          'Write an OCI Events filter object. Match eventType using a string or alternatives array; data fields must preserve event nesting. Example: {"eventType":"com.oraclecloud.objectstorage.createbucket","data":{"resourceName":"logs*"}}. Explicit {} matches all compartment and descendant events. Return ONLY the JSON object.',
        placeholder: 'Describe the desired configuration',
        generationType: 'json-object',
      },
    },
    {
      id: 'actions',
      title: 'Actions',
      type: 'code',
      condition: { field: 'operation', value: ['create_rule', 'update_rule'] },
      required: { field: 'operation', value: ['create_rule'] },
      placeholder: '[{"actionType":"ONS","isEnabled":true,"topicId":"<topic_ocid>"}]',
      wandConfig: {
        enabled: true,
        prompt:
          'Write a replacement JSON array of 1–10 OCI Events actions. Each requires actionType, isEnabled and the matching destination: ONS/topicId, OSS/streamId or FAAS/functionId. Optional description. Example: [{"actionType":"ONS","isEnabled":true,"topicId":"<topic_ocid>"}]. Use supplied existing OCIDs; omit action IDs and lifecycle fields. Return ONLY the JSON array.',
        placeholder: 'Describe the desired configuration',
        generationType: 'json-array',
      },
    },
    {
      id: 'freeformTags',
      title: 'Freeform Tags',
      type: 'code',
      condition: { field: 'operation', value: ['create_rule', 'update_rule'] },
      required: false,
      mode: 'advanced',
      placeholder: '{"Department":"Operations"}; {} clears tags on update',
      wandConfig: {
        enabled: true,
        prompt:
          'Write a map of tag names to string values, for example {"Department":"Operations"}. Updates replace the map; {} clears it. Return ONLY the JSON object.',
        placeholder: 'Describe the desired configuration',
        generationType: 'json-object',
      },
    },
    {
      id: 'definedTags',
      title: 'Defined Tags',
      type: 'code',
      condition: { field: 'operation', value: ['create_rule', 'update_rule'] },
      required: false,
      mode: 'advanced',
      placeholder: '{"Operations":{"CostCenter":"42"}}; {} clears tags on update',
      wandConfig: {
        enabled: true,
        prompt:
          'Write a map of tag namespaces to maps of tag names and string values, for example {"Operations":{"CostCenter":"42"}}. Updates replace the map; {} clears it. Return ONLY the JSON object.',
        placeholder: 'Describe the desired configuration',
        generationType: 'json-object',
      },
    },
    {
      id: 'limit',
      title: 'Page Size',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_rules'] },
      required: false,
      mode: 'advanced',
      placeholder: '1–50; defaults to 10',
    },
    {
      id: 'page',
      title: 'Page Token',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_rules'] },
      required: false,
      mode: 'advanced',
      placeholder: 'nextPage from the preceding list response',
    },
    {
      id: 'lifecycleState',
      title: 'Lifecycle State',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_rules'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'All', id: '' },
        { label: 'Creating', id: 'CREATING' },
        { label: 'Active', id: 'ACTIVE' },
        { label: 'Inactive', id: 'INACTIVE' },
        { label: 'Updating', id: 'UPDATING' },
        { label: 'Deleting', id: 'DELETING' },
        { label: 'Deleted', id: 'DELETED' },
        { label: 'Failed', id: 'FAILED' },
      ],
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_rules'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Creation time', id: 'TIME_CREATED' },
        { label: 'OCID', id: 'ID' },
        { label: 'Display name', id: 'DISPLAY_NAME' },
      ],
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_rules'] },
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Ascending', id: 'ASC' },
        { label: 'Descending', id: 'DESC' },
      ],
    },
    {
      id: 'ifMatch',
      title: 'If Match',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['update_rule', 'delete_rule', 'change_rule_compartment'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'ETag from Get Rule for optimistic concurrency control',
    },
    {
      id: 'opcRetryToken',
      title: 'Retry Token',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_rule', 'change_rule_compartment'] },
      required: false,
      mode: 'advanced',
      placeholder: 'Stable token for retries of the same request; 1–64 characters',
    },
    {
      id: 'opcRequestId',
      title: 'Request ID',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Optional OCI request correlation identifier',
    },
  ],
  tools: {
    access: [
      'oci_events_list_rules',
      'oci_events_get_rule',
      'oci_events_create_rule',
      'oci_events_update_rule',
      'oci_events_delete_rule',
      'oci_events_change_rule_compartment',
    ],
    config: {
      tool: (params) => `oci_events_${params.operation}`,
      params: (params) => {
        const { operation, ...result } = params
        for (const [key, value] of Object.entries(result)) {
          if (value === null || (value === '' && key !== 'description')) {
            result[key] = undefined
          }
        }
        if (typeof result.limit === 'string' && result.limit.trim() !== '') {
          result.limit = Number(result.limit)
        }
        if (result.isEnabled === 'true') result.isEnabled = true
        else if (result.isEnabled === 'false') result.isEnabled = false
        return result
      },
    },
  },
  inputs: {
    oauthCredential: { type: 'string', description: 'Reusable OCI credential ID' },
    region: { type: 'string', description: 'Optional OCI region override' },
    compartmentId: { type: 'string', description: 'Compartment OCID for rules or the picker' },
    ruleId: { type: 'string', description: 'Rule OCID' },
    destinationCompartmentId: { type: 'string', description: 'Destination Compartment' },
    displayName: { type: 'string', description: 'Display Name' },
    description: { type: 'string', description: 'Description' },
    isEnabled: { type: 'boolean', description: 'Rule Enabled' },
    condition: { type: 'json', description: 'Condition' },
    actions: { type: 'json', description: 'Actions' },
    freeformTags: { type: 'json', description: 'Freeform Tags' },
    definedTags: { type: 'json', description: 'Defined Tags' },
    limit: { type: 'number', description: 'Page Size' },
    page: { type: 'string', description: 'Page Token' },
    lifecycleState: { type: 'string', description: 'Lifecycle State' },
    sortBy: { type: 'string', description: 'Sort By' },
    sortOrder: { type: 'string', description: 'Sort Order' },
    ifMatch: { type: 'string', description: 'If Match' },
    opcRetryToken: { type: 'string', description: 'Retry Token' },
    opcRequestId: { type: 'string', description: 'Request ID' },
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP status' },
    opcRequestId: { type: 'string', description: 'OCI request identifier' },
    nextPage: { type: 'string', description: 'Continuation token from List Rules' },
    etag: { type: 'string', description: 'Rule ETag from Get, Create or Update Rule' },
    rules: {
      type: 'json',
      description:
        'Rule summaries (id, displayName, compartmentId, condition, isEnabled, lifecycleState, timeCreated, description, freeformTags, definedTags); actions require Get Rule',
    },
    rule: {
      type: 'json',
      description:
        'Rule (id, displayName, compartmentId, condition, isEnabled, lifecycleState, lifecycleMessage, timeCreated, description, freeformTags, definedTags, actions.actions). Each action has id, actionType, isEnabled, description, lifecycleState, lifecycleMessage and topicId, streamId or functionId.',
    },
  },
}

export const OciEventsBlockMeta = {
  tags: ['automation', 'cloud'],
  url: 'https://docs.oracle.com/en-us/iaas/Content/Events/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Inventory event rules',
      prompt:
        'Create a workflow to list a bounded page of OCI Events rules in a selected compartment, follow the continuation token when requested, and summarize enabled states.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Inspect event routing',
      prompt:
        'Create a workflow to get a selected OCI Events rule and inspect its condition, action destinations, enabled states and lifecycle.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Route backup notifications',
      prompt:
        'Create a workflow to create an OCI Events rule for the documented database backup event type, using an existing Notifications topic and a confirmed event condition. Get the rule to inspect the configuration.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Configure function routing',
      prompt:
        'Create a workflow to create an OCI Events rule that sends matching resource events to an existing Function OCID. Use the documented event type and supplied function destination, then inspect the rule.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Configure stream routing',
      prompt:
        'Create a workflow to create an OCI Events rule that routes selected resource events to an existing Streaming stream. Verify the event filter and stream action through Get Rule.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Maintain event rules',
      prompt:
        'Create a workflow to get a rule and its ETag, update its enabled state or replace the desired action configurations, and inspect the resulting rule. Preserve fields omitted from the update.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Move an event rule',
      prompt:
        'Create a workflow to get a rule and its ETag, move it to a selected compartment in the same tenancy, and get it again to inspect the changed matching scope.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Retire an event rule',
      prompt:
        'Create a workflow to get a selected rule and its ETag, review its routing destinations, and delete that rule using the ETag.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
  ],
  skills: [
    {
      name: 'inventory-event-rules',
      description: 'Inventory event rules',
      content:
        '# Inventory event rules\n\n## Steps\n1. Select an OCI credential, region and compartment.\n2. List a bounded page of OCI Events rules in a selected compartment, follow the continuation token when requested, and summarize enabled states.\n\n## Output\nA paginated inventory of routing rules.',
    },
    {
      name: 'inspect-event-routing',
      description: 'Inspect event routing',
      content:
        '# Inspect event routing\n\n## Steps\n1. Select an OCI credential, region and compartment.\n2. Get a selected OCI Events rule and inspect its condition, action destinations, enabled states and lifecycle.\n\n## Output\nThe rule configuration and ETag.',
    },
    {
      name: 'route-backup-notifications',
      description: 'Route backup notifications',
      content:
        '# Route backup notifications\n\n## Steps\n1. Select an OCI credential, region and compartment.\n2. Create an OCI Events rule for the documented database backup event type, using an existing Notifications topic and a confirmed event condition. Get the rule to inspect the configuration.\n\n## Output\nThe created rule and configured topic destination.',
    },
    {
      name: 'configure-function-routing',
      description: 'Configure function routing',
      content:
        '# Configure function routing\n\n## Steps\n1. Select an OCI credential, region and compartment.\n2. Create an OCI Events rule that sends matching resource events to an existing Function OCID. Use the documented event type and supplied function destination, then inspect the rule.\n\n## Output\nThe rule and function action configuration; delivery remains managed by OCI.',
    },
    {
      name: 'configure-stream-routing',
      description: 'Configure stream routing',
      content:
        '# Configure stream routing\n\n## Steps\n1. Select an OCI credential, region and compartment.\n2. Create an OCI Events rule that routes selected resource events to an existing Streaming stream. Verify the event filter and stream action through Get Rule.\n\n## Output\nThe rule and stream destination configuration.',
    },
    {
      name: 'maintain-event-rules',
      description: 'Maintain event rules',
      content:
        '# Maintain event rules\n\n## Steps\n1. Select an OCI credential, region and compartment.\n2. Get a rule and its ETag, update its enabled state or replace the desired action configurations, and inspect the resulting rule. Preserve fields omitted from the update.\n\n## Output\nThe updated rule and ETag.',
    },
  ],
} as const satisfies BlockMeta
