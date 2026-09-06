import type { OracleEpmPlanningInputs } from '@/tools/oracle_epm_planning/types'
import type { ToolConfig } from '@/tools/types'

/** Shared public metadata only: importing this module never loads credentials or transport. */
export const oracleEpmPlanningAuthParamFields = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle EPM service-account credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Authorization material injected by the executor from the selected credential',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Environment URL injected by the executor from the selected credential',
  },
} satisfies ToolConfig['params']

export const oracleEpmPlanningParamFields = {
  clearData: {
    type: 'boolean',
    description:
      'Explicitly clear the target region before copying. Destructive when true; Sim defaults to false, while Oracle defaults to true.',
    visibility: 'user-or-llm',
  },
  overrideMembersMap: {
    type: 'json',
    description:
      'Optional dimension-to-member-selection map, for example {"Period":"ILvl0Descendants(Q1)"}. Values must be strings.',
    visibility: 'user-or-llm',
  },
  overrideExclusionMembersMap: {
    type: 'json',
    description:
      'Optional dimension-to-excluded-member-selection map, for example {"Period":"Jan"}. Values must be strings.',
    visibility: 'user-or-llm',
  },
  userVariableValues: {
    type: 'array',
    description:
      '1–1000 user-variable values: [{userName, name, dimension, member}]. Names are tenant-specific; do not assume batch atomicity.',
    items: {
      type: 'object',
      required: ['userName', 'name', 'dimension', 'member'],
      additionalProperties: false,
      properties: {
        userName: {
          type: 'string',
        },
        name: {
          type: 'string',
        },
        dimension: {
          type: 'string',
        },
        member: {
          type: 'string',
        },
      },
    },
    visibility: 'user-or-llm',
  },
  scenario: {
    type: 'string',
    description: 'Exact scenario member name for the planning units.',
    visibility: 'user-or-llm',
  },
  planningVersion: {
    type: 'string',
    description: 'Exact version member name for the planning units, not the REST API version.',
    visibility: 'user-or-llm',
  },
  puhIdentifier: {
    type: 'string',
    description:
      'Raw Oracle planning-unit hierarchy identifier for scenario and version, including required quotes and :: separators. Not a numeric puId or a URL. Maximum 255 UTF-8 bytes; do not percent-encode.',
    visibility: 'user-or-llm',
  },
  puIdentifier: {
    type: 'string',
    description:
      'Raw Oracle compound planning-unit identifier including scenario, version and PM-member context. Not the numeric puId or a URL. Preserve its exact quoting/separators; maximum 255 UTF-8 bytes. Do not percent-encode.',
    visibility: 'user-or-llm',
  },
  pmMembers: {
    type: 'string',
    description:
      'Oracle PM-member selection (Entity: Secondary member), preserving tenant-specific quoting and comma-separated member names.',
    visibility: 'user-or-llm',
  },
  actionId: {
    type: 'number',
    description:
      'Explicit action ID returned by Get Planning Unit Actions, such as 6 for Promote. May change status or ownership.',
    visibility: 'user-or-llm',
  },
  comments: {
    type: 'string',
    description: 'Optional comment for the explicit approval transition.',
    visibility: 'user-or-llm',
  },
  approvalOptions: {
    type: 'number',
    description: '0 for limited approvals or 1 for full approvals (default 1).',
    visibility: 'user-or-llm',
  },
  annotSeq: {
    type: 'number',
    description:
      'Annotation sequence to retrieve replies; -1 (default) with logSeq -1 retrieves parent nodes.',
    visibility: 'user-or-llm',
  },
  logSeq: {
    type: 'number',
    description:
      'History sequence to retrieve replies; -1 (default) with annotSeq -1 retrieves parent nodes.',
    visibility: 'user-or-llm',
  },
  insightSlice: {
    type: 'json',
    description:
      'IPM slice: pov {members:string[], dimensions:string[]}; rowAxisDefinition and columnAxisDefinition each {dimensions:string[], segments:string[][][]}. Not a Planning data grid.',
    visibility: 'user-or-llm',
  },
  retrievalMode: {
    type: 'string',
    description:
      'USE_EXISTING (default) reads stored insights. FORCE_RECOMPUTE generates insights and requires a calendar and Administrator or IPM Manage role.',
    visibility: 'user-or-llm',
  },
  calendar: {
    type: 'string',
    description:
      'Tenant calendar name, required only when generating insights with FORCE_RECOMPUTE.',
    visibility: 'user-or-llm',
  },
  insightIds: {
    type: 'array',
    description:
      '1–1000 insight ID strings returned by Get Insights; required in ids summary mode.',
    items: {
      type: 'string',
    },
    visibility: 'user-or-llm',
  },
  summaryInputMode: {
    type: 'string',
    description:
      'ids summarizes explicit insight IDs; slice summarizes an insight slice and requires cube plus insightSlice.',
    visibility: 'user-or-llm',
  },
  summarySize: {
    type: 'number',
    description:
      'Maximum summary length in words (default 100; Sim range 1–10000). Output format is always text.',
    visibility: 'user-or-llm',
  },
  application: {
    type: 'string',
    description: 'Application name, exactly as configured in Oracle.',
  },
  cube: {
    type: 'string',
    description: 'Cube / plan type name, not its numeric plan type ID.',
  },
  dimension: {
    type: 'string',
    description: 'Dimension name.',
  },
  memberName: {
    type: 'string',
    description: 'Exact member name.',
  },
  parentName: {
    type: 'string',
    description: 'Dynamic-enabled parent member name.',
  },
  aliasTableName: {
    type: 'string',
    description: 'Optional alias table name for the dimension hierarchy.',
  },
  variableName: {
    type: 'string',
    description: 'Substitution variable name.',
  },
  variables: {
    type: 'array',
    description:
      'Variables to create or update: [{name, value, planType}]. Use ALL for application scope.',
    items: {
      type: 'object',
      required: ['name', 'value', 'planType'],
      properties: {
        name: {
          type: 'string',
        },
        value: {
          type: 'string',
        },
        planType: {
          type: 'string',
        },
      },
    },
  },
  derivedValues: {
    type: 'boolean',
    description: 'Include inherited application variables for a cube (default false).',
  },
  jobType: {
    type: 'string',
    description: 'Oracle job type, such as RULES, RULESET, IMPORT_DATA or EXPORT_DATA.',
  },
  jobName: {
    type: 'string',
    description: 'Configured job, deployed rule or ruleset name.',
  },
  parameters: {
    type: 'json',
    description:
      'Job-specific parameters or runtime prompts as a JSON object. Parameter names must match Oracle or the deployed job.',
  },
  jobId: {
    type: 'string',
    description: 'Numeric ID returned when the Planning job was submitted.',
  },
  maxWaitSeconds: {
    type: 'number',
    description:
      'Maximum wait in seconds (1–3600, default 300); also bounded by the workflow deadline.',
  },
  offset: {
    type: 'number',
    description: 'Zero-based page offset (default 0).',
  },
  limit: {
    type: 'number',
    description: 'Page size, 1–1000 (default 100).',
  },
  messageType: {
    type: 'string',
    description: 'Diagnostic message filter: INFO, WARNING or ERROR.',
  },
  gridDefinition: {
    type: 'json',
    description:
      'Grid selection: pov {members: string[][]}, columns and rows arrays of {members: string[][]}; optional dimensions and missing-cell suppression flags.',
  },
  dataGrid: {
    type: 'json',
    description:
      'Cell grid: pov string[], columns string[][], rows [{headers: string[], data: (string|number)[]}]. Use #missing to clear a cell.',
  },
  importOptions: {
    type: 'json',
    description:
      'Optional aggregateEssbaseData, cellNotesOption (Overwrite/Append/Skip), dateFormat, strictDateValidation. Defaults follow Oracle.',
  },
  clearEssbaseData: {
    type: 'boolean',
    description: 'Clear Essbase cell values (default true). This is destructive.',
  },
  clearPlanningData: {
    type: 'boolean',
    description: 'Clear Planning cell details (default false). This is destructive.',
  },
  form: {
    type: 'string',
    description: 'Exact form name or ID. Form discovery and page filtering are not supported.',
  },
  displayMemberAs: {
    type: 'string',
    description:
      'MEMBER_NAME, MEMBER_NAME_THEN_ALIAS, or ALIAS_THEN_MEMBER_NAME (default MEMBER_NAME).',
  },
  memberAliasDelimiter: {
    type: 'string',
    description: 'Delimiter between a member and alias (default colon).',
  },
  forceStartExpanded: {
    type: 'boolean',
    description: 'Force expandable form rows and columns to start expanded (default false).',
  },
  file: {
    type: 'file',
    description:
      'One authorized Sim UserFile. Maximum Sim input size: 5 GiB; Oracle may impose additional limits.',
  },
  fileName: {
    type: 'string',
    description:
      'Oracle repository file name, including any documented repository folder. Download outputs are limited to 100 MiB.',
  },
  loginLevel: {
    type: 'string',
    description:
      'Administrators or All Users. Administrators mode logs off Interactive Users and Planners.',
  },
} satisfies Record<keyof OracleEpmPlanningInputs, ToolConfig['params'][string]>
