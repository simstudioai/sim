import type { ToolConfig } from '@/tools/types'

type ServiceNowParams = ToolConfig['params']

/** Instance URL plus Basic Auth credentials, shared by every ServiceNow tool. */
export const authParams: ServiceNowParams = {
  instanceUrl: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'ServiceNow instance URL (e.g., https://instance.service-now.com)',
  },
  username: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'ServiceNow username',
  },
  password: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'ServiceNow password',
  },
}

/**
 * `sysparm_display_value`. Defaults to `all` on every semantic tool, so a
 * reference field such as `assigned_to` returns both its sys_id and its label.
 */
export const displayValueParam: ServiceNowParams = {
  displayValue: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'How reference and choice fields are returned: "all" (default — both the sys_id and the label, as {value, display_value}), "true" (labels only), or "false" (raw sys_ids and coded values only).',
  },
}

/** `sysparm_fields`. */
export const fieldsParam: ServiceNowParams = {
  fields: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Comma-separated list of fields to return (e.g., number,short_description,state). Returns all fields when omitted.',
  },
}

/** Pagination plus an escape hatch to an arbitrary encoded query. */
export const listParams: ServiceNowParams = {
  query: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Additional ServiceNow encoded query, ANDed with the other filters (e.g., "opened_at>=javascript:gs.beginningOfLastMonth()").',
  },
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Maximum number of records to return (sysparm_limit). Omitting it sends no limit at all, and the Table API then applies its own default of 10,000 records, so always set it to what you will actually read.',
  },
  offset: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Number of records to skip for pagination (sysparm_offset).',
  },
  ...fieldsParam,
  ...displayValueParam,
}

/**
 * `sysparm_input_display_value`. When true, ServiceNow resolves a display name
 * written to a reference field into the stored sys_id.
 */
export const inputDisplayValueParam: ServiceNowParams = {
  inputDisplayValue: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: `Set to true to write display names into reference fields (e.g., assigned_to: "Beth Anglin") and let ServiceNow resolve them to sys_ids. Defaults to false, meaning reference fields must be sys_ids. Note that true also reinterprets date and time values in the requesting user's timezone rather than GMT.`,
  },
}

/** Response-shaping params for create/update tools. */
export const writeParams: ServiceNowParams = {
  ...fieldsParam,
  ...displayValueParam,
  ...inputDisplayValueParam,
}

/** The two ways to address an existing record. */
export const recordIdentifierParams: ServiceNowParams = {
  sysId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Record sys_id. Provide either this or the record number.',
  },
  number: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Record number (e.g., INC0010001). Provide either this or the sys_id.',
  },
}

/**
 * sys_id of the record being written to. The Table API addresses updates by
 * sys_id only, so callers holding a record number must resolve it first.
 */
export const requiredSysIdParam: ServiceNowParams = {
  sysId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'sys_id of the record to update. If you only have the record number, look it up first (for example with Get ServiceNow Incident).',
  },
}

/** JSON escape hatch for fields the tool does not name explicitly. */
export const additionalFieldsParam: ServiceNowParams = {
  additionalFields: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Any other ServiceNow fields to set, as a JSON object of raw column names (e.g., {"correlation_id": "abc-123", "u_custom": "x"}). Merged last, so it overrides the named parameters.',
  },
}

/** Standard list-shaped outputs. */
export const recordListOutputs: ToolConfig['outputs'] = {
  records: {
    type: 'array',
    description:
      'Matching ServiceNow records. With the default display value mode "all", every field is an object of the form {value, display_value}.',
  },
  metadata: {
    type: 'json',
    description: 'Operation metadata',
    properties: {
      recordCount: { type: 'number', description: 'Number of records returned' },
    },
  },
}

/** Standard single-record outputs. */
export const recordOutputs: ToolConfig['outputs'] = {
  record: {
    type: 'json',
    description:
      'The ServiceNow record. With the default display value mode "all", every field is an object of the form {value, display_value}.',
    nullable: true,
  },
  metadata: {
    type: 'json',
    description: 'Operation metadata',
    properties: {
      recordCount: { type: 'number', description: 'Number of records returned (0 or 1)' },
    },
  },
}
