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
