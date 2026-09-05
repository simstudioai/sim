import type { ToolConfig } from '@/tools/types'

/** Credential material is injected by the existing oracle-epm-service-account executor path. */
export const fccsAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle EPM service account credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Credential-bound authorization material injected by the executor',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'REST base URL injected from the selected credential',
  },
} satisfies ToolConfig['params']

export const fccsParamFields = {
  application: {
    type: 'string',
    description: 'Exact FCCS application name',
    required: true,
    visibility: 'user-or-llm',
  },
  cube: {
    type: 'string',
    description: 'Cube planTypeName from List Cubes',
    required: true,
    visibility: 'user-or-llm',
  },
  dimension: {
    type: 'string',
    description: 'Exact dimension name',
    required: true,
    visibility: 'user-or-llm',
  },
  member: {
    type: 'string',
    description: 'Exact member name; for Add Member, the new dynamic child name',
    required: true,
    visibility: 'user-or-llm',
  },
  parentName: {
    type: 'string',
    description: 'Parent enabled for dynamic children after a cube refresh',
    required: true,
    visibility: 'user-or-llm',
  },
  aliasTableName: {
    type: 'string',
    description: 'Alias table name for hierarchy labels',
    required: true,
    visibility: 'user-or-llm',
  },
  offset: {
    type: 'number',
    description: 'Zero-based starting record index',
    required: true,
    visibility: 'user-or-llm',
  },
  limit: {
    type: 'number',
    description: 'Page size, 1–1000 (default 25); requests one page only',
    required: true,
    visibility: 'user-or-llm',
  },
  filter: {
    type: 'json',
    description: 'Documented dimension query object (for example {"dimType":"Entity"})',
    required: true,
    visibility: 'user-or-llm',
  },
  logFileName: {
    type: 'string',
    description: 'Validation log filename; sent in the documented resource query',
    required: true,
    visibility: 'user-or-llm',
  },
  jobType: {
    type: 'string',
    description:
      'FCCS job family: RULES, RULESET, IMPORT_DATA, EXPORT_DATA, IMPORT_METADATA, EXPORT_METADATA, IMPORT_EXCHANGE_RATES, JOBCONSOLE_EXPORT, Clear_Data, Copy_Data, IMPORT_JOURNAL, EXPORT_JOURNAL, GENERATE_INTERCOMPANY_REPORT',
    required: true,
    visibility: 'user-or-llm',
  },
  jobName: {
    type: 'string',
    description:
      'Exact saved job or report definition name; definitions and required overrides depend on the tenant',
    required: true,
    visibility: 'user-or-llm',
  },
  parameters: {
    type: 'json',
    description:
      'Case-sensitive documented job overrides or tenant-defined rule runtime prompts as a JSON object',
    required: true,
    visibility: 'user-or-llm',
  },
  rule: {
    type: 'string',
    description: 'Exact deployed business rule name',
    required: true,
    visibility: 'user-or-llm',
  },
  ruleset: {
    type: 'string',
    description: 'Exact deployed business ruleset name',
    required: true,
    visibility: 'user-or-llm',
  },
  entity: {
    type: 'string',
    description: 'Entity member or rule-supported member selection expression',
    required: true,
    visibility: 'user-or-llm',
  },
  period: {
    type: 'string',
    description: 'Period member',
    required: true,
    visibility: 'user-or-llm',
  },
  scenario: {
    type: 'string',
    description: 'Scenario member',
    required: true,
    visibility: 'user-or-llm',
  },
  year: {
    type: 'string',
    description: 'Year member, such as FY26',
    required: true,
    visibility: 'user-or-llm',
  },
  force: {
    type: 'boolean',
    description:
      'Use ForceConsolidate or ForceTranslate (default false); requires applicable Oracle permissions',
    required: true,
    visibility: 'user-or-llm',
  },
  jobId: {
    type: 'string',
    description: 'Execution job ID from submission output; not a saved job definition ID',
    required: true,
    visibility: 'user-or-llm',
  },
  childJobId: {
    type: 'string',
    description: 'Child job ID from Get Job Details',
    required: true,
    visibility: 'user-or-llm',
  },
  maxWaitSeconds: {
    type: 'number',
    description:
      'Maximum wait in seconds, 1–86400 (default 300), also bounded by the workflow deadline',
    required: true,
    visibility: 'user-or-llm',
  },
  detailJobType: {
    type: 'string',
    description:
      'Original job family: IMPORT_DATA, EXPORT_DATA, IMPORT_METADATA, or EXPORT_METADATA',
    required: true,
    visibility: 'user-or-llm',
  },
  childJobType: {
    type: 'string',
    description: 'Original job family: IMPORT_METADATA or EXPORT_METADATA',
    required: true,
    visibility: 'user-or-llm',
  },
  messageType: {
    type: 'string',
    description: 'Optional message filter: ERROR, WARNING, or INFO',
    required: true,
    visibility: 'user-or-llm',
  },
  gridDefinition: {
    type: 'json',
    description:
      'Essbase region: pov {dimensions?,members:string[][]}, columns/rows arrays of the same axes; optional suppressMissingBlocks/Rows/Columns',
    required: true,
    visibility: 'user-or-llm',
  },
  dataGrid: {
    type: 'json',
    description:
      'Numeric Essbase grid: pov:string[], columns:string[][], rows:{headers:string[],data:(number|numeric string|"#missing")[]}[]',
    required: true,
    visibility: 'user-or-llm',
  },
  aggregateEssbaseData: {
    type: 'boolean',
    description: 'Add to existing values instead of overwriting (default false)',
    required: true,
    visibility: 'user-or-llm',
  },
  profileName: {
    type: 'string',
    description: 'Existing FCCS Clear Data or Copy Data profile name; no listing API is documented',
    required: true,
    visibility: 'user-or-llm',
  },
  journalStatus: {
    type: 'string',
    description: 'WORKING, SUBMITTED, POSTED, or APPROVED',
    required: true,
    visibility: 'user-or-llm',
  },
  consolidation: {
    type: 'string',
    description: 'Journal consolidation member, such as FCCS_Entity Input',
    required: true,
    visibility: 'user-or-llm',
  },
  group: {
    type: 'string',
    description: 'Journal group filter',
    required: true,
    visibility: 'user-or-llm',
  },
  journalLabel: {
    type: 'string',
    description: 'Journal label',
    required: true,
    visibility: 'user-or-llm',
  },
  description: {
    type: 'string',
    description: 'Journal description filter',
    required: true,
    visibility: 'user-or-llm',
  },
  journalAction: {
    type: 'string',
    description: 'SUBMIT, APPROVE, POST, UNPOST, or REJECT',
    required: true,
    visibility: 'user-or-llm',
  },
  periodAction: {
    type: 'string',
    description: 'OPEN or CLOSE',
    required: true,
    visibility: 'user-or-llm',
  },
  fileName: {
    type: 'string',
    description: 'Exact repository filename/path; do not URL encode it. Upload requires a basename',
    required: true,
    visibility: 'user-or-llm',
  },
  errorFileName: {
    type: 'string',
    description: 'Repository filename for journal import diagnostics',
    required: true,
    visibility: 'user-or-llm',
  },
  reportFormat: {
    type: 'string',
    description: 'Format accepted by the saved intercompany report (for example HTML)',
    required: true,
    visibility: 'user-or-llm',
  },
  rules: {
    type: 'array',
    description:
      'Configurable-consolidation ruleset names to export; distinct from Calculation Manager rulesets',
    required: true,
    visibility: 'user-or-llm',
    items: {
      type: 'string',
    },
    minItems: 1,
    maxItems: 1000,
  },
  file: {
    type: 'file',
    description: 'One authorized Sim UserFile to upload, no larger than 100 MiB',
    required: true,
    visibility: 'user-or-llm',
  },
  directory: {
    type: 'string',
    description:
      'Optional inbox or outbox directory; subdirectories supported. Omit for the default repository',
    required: true,
    visibility: 'user-or-llm',
  },
} satisfies ToolConfig['params']

/** Coerce resolved UI text, never unresolved variable expressions or provider parameter values. */
export function coerceFccsNumber(value: unknown): unknown {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : value === ''
      ? undefined
      : value
}
export function coerceFccsBoolean(value: unknown): unknown {
  return value === 'true' ? true : value === 'false' ? false : value === '' ? undefined : value
}
export function coerceFccsJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') return value === '' ? undefined : value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}
