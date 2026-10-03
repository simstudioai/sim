import type { UserFile } from '@/executor/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface OraclePcmAuthParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}

export interface OraclePcmCreateApplicationParams extends OraclePcmAuthParams {
  applicationName: string
  description: string
  ruleDimensionName: string
  balanceDimensionName: string
}

export interface OraclePcmEnableApplicationParams extends OraclePcmAuthParams {
  applicationName: string
}

export interface OraclePcmDeployCubeParams extends OraclePcmAuthParams {
  applicationName: string
  isKeepData: boolean
  isReplaceCube: boolean
  comment: string
}

export interface OraclePcmUpdateDimensionsParams extends OraclePcmAuthParams {
  applicationName: string
  dataFileName: string
  stringDelimiter?: string
  acceptableDecreasePercentage?: number
}

export interface OraclePcmLoadDataParams extends OraclePcmAuthParams {
  applicationName: string
  clearAllDataFlag: boolean
  dataLoadValue: 'ADD_EXISTING_VALUES' | 'OVERWRITE_EXISTING_VALUES'
  dataFileName: string
}

export interface OraclePcmRunCalculationParams extends OraclePcmAuthParams {
  applicationName: string
  povName: string
  exeType: 'ALL_RULES' | 'RULESET_SUBSET' | 'SINGLE_RULE'
  dataPOVName?: string
  isClearCalculated?: boolean
  optimizeReporting?: boolean
  subsetStart?: number
  subsetEnd?: number
  ruleName?: string
  ruleSetName?: string
  comment?: string
  stringDelimiter?: string
}

export interface OraclePcmCopyPovParams extends OraclePcmAuthParams {
  applicationName: string
  povName: string
  destinationPovName: string
  isManageRule: boolean
  isInputData: boolean
  modelViewName?: string
  createDestPOV: boolean
  nonEmptyTupleEnabled?: boolean
  stringDelimiter: string
}

export interface OraclePcmClearPovParams extends OraclePcmAuthParams {
  applicationName: string
  povName: string
  isManageRule?: boolean
  isInputData?: boolean
  queryName?: string
  isAllocatedValues?: boolean
  isAdjustmentValues?: boolean
  stringDelimiter?: string
}

export interface OraclePcmGetRuleBalancingParams extends OraclePcmAuthParams {
  applicationName: string
  povName: string
  modelViewName: string
  stringDelimiter?: string
}

export interface OraclePcmGenerateProgramDocumentationParams extends OraclePcmAuthParams {
  applicationName: string
  povName: string
  fileName?: string
  fileType?: 'PDF' | 'XML' | 'WORD' | 'EXCEL' | 'HTML'
  skipFilters?: boolean
  subsetStart?: number
  subsetEnd?: number
  useAlias?: boolean
  stringDelimiter?: string
}

export interface OraclePcmExportQueryResultsParams extends OraclePcmAuthParams {
  applicationName: string
  fileName: string
  queryName?: string
  exportOnlyLevel0Flg?: boolean
  fileOutputOptions?: 'ZIP_ONLY' | 'ZIP_AND_TEXT' | 'TEXT_ONLY'
  roundingPrecision?: number
  dataFormat?: 'NATIVE' | 'COLUMNAR'
  memberFilters?: string
  includeHeader?: boolean
  delimiter?: string
  keepDuplicateMemberFormat?: boolean
}

export interface OraclePcmImportTemplateParams extends OraclePcmAuthParams {
  applicationName: string
  description: string
  fileName: string
  isApplicationOverwrite: boolean
}

export interface OraclePcmApplyDataGrantsParams extends OraclePcmAuthParams {
  applicationName: string
}

export interface OraclePcmMergeSlicesParams extends OraclePcmAuthParams {
  applicationName: string
  removeZeroCells?: boolean
}

export interface OraclePcmOptimizeCubeParams extends OraclePcmAuthParams {
  applicationName: string
  type:
    | 'clearAggregations'
    | 'createAggregations'
    | 'startQueryTracking'
    | 'stopQueryTracking'
    | 'createQBOAggregations'
}

export interface OraclePcmGetTaskStatusParams extends OraclePcmAuthParams {
  processName: string
}

export interface OraclePcmWaitForTaskParams extends OraclePcmAuthParams {
  processName: string
  maxWaitSeconds?: number
}

export interface OraclePcmUploadFileParams extends OraclePcmAuthParams {
  fileName: string
  file: UserFile | UserFile[]
}

export interface OraclePcmListFilesParams extends OraclePcmAuthParams {}

export interface OraclePcmDownloadFileParams extends OraclePcmAuthParams {
  fileName: string
}

export interface OraclePcmTask {
  processName: string | null
  status: number
  state: 'pending' | 'succeeded' | 'failed'
  statusMessage: string | null
  details: string | null
}

export interface OraclePcmRepositoryFile {
  name: string
  type: 'EXTERNAL'
  size: number | null
  lastModifiedTime: number | null
}

export interface OraclePcmRuleBalance {
  ruleNumber: string
  balanceTypeRule: boolean
  scale: number
  sequence: number
  name: string
  description: string | null
  runningBalance: number | null
  balance: number | null
  allocationIn: number | null
  allocationOut: number | null
  adjustmentIn: number | null
  adjustmentOut: number | null
  input: number | null
  runningRemainder: number | null
  remainder: number | null
  netChange: number | null
  offset: number | null
}

export type OraclePcmOutput =
  | OraclePcmTask
  | (Partial<OraclePcmTask> & { processName: string; timedOut: boolean; attempts?: number })
  | { items: OraclePcmRuleBalance[]; status: number }
  | { files: OraclePcmRepositoryFile[] }
  | { file: UserFile }
  | { fileName: string; status: number }

export interface OraclePcmResponse<T extends object = OraclePcmOutput> extends ToolResponse {
  output: T
}

export const ORACLE_PCM_TASK_OUTPUTS = {
  processName: {
    type: 'string',
    nullable: true,
    description: 'Task identifier from a validated Job Status link; retain for polling',
  },
  status: {
    type: 'number',
    description: 'PCM status: -1 pending, 0 success, any positive value failed',
  },
  state: { type: 'string', description: 'Normalized pending, succeeded, or failed state' },
  statusMessage: { type: 'string', nullable: true, description: 'Oracle status message' },
  details: {
    type: 'string',
    nullable: true,
    description: 'Oracle task details; may be prose rather than an identifier',
  },
} satisfies ToolConfig['outputs']

export const ORACLE_PCM_WAIT_OUTPUTS = {
  processName: {
    type: 'string',
    description: 'Task identifier retained even when the wait expires',
  },
  status: { ...ORACLE_PCM_TASK_OUTPUTS.status, optional: true },
  state: { ...ORACLE_PCM_TASK_OUTPUTS.state, optional: true },
  statusMessage: { ...ORACLE_PCM_TASK_OUTPUTS.statusMessage, optional: true },
  details: { ...ORACLE_PCM_TASK_OUTPUTS.details, optional: true },
  timedOut: {
    type: 'boolean',
    description: 'Whether the bounded wait expired; the remote task was not cancelled',
  },
  attempts: {
    type: 'number',
    optional: true,
    description: 'Status reads before a terminal result',
  },
} satisfies ToolConfig['outputs']

export const ORACLE_PCM_FILE_OUTPUTS = {
  fileName: { type: 'string', description: 'Uploaded repository path in profitinbox' },
  status: { type: 'number', description: 'Zero means the ordinary-file upload succeeded' },
} satisfies ToolConfig['outputs']

export const ORACLE_PCM_DOWNLOAD_OUTPUTS = {
  file: { type: 'file', description: 'Canonical Sim UserFile stored in this execution' },
} satisfies ToolConfig['outputs']

export const ORACLE_PCM_FILES_OUTPUTS = {
  files: {
    type: 'array',
    description: 'Ordinary PCM repository files; names include profitinbox or profitoutbox',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        size: { type: 'number', nullable: true },
        lastModifiedTime: { type: 'number', nullable: true },
      },
    },
  },
} satisfies ToolConfig['outputs']

export const ORACLE_PCM_BALANCE_OUTPUTS = {
  status: { type: 'number' },
  items: {
    type: 'array',
    description: 'Documented scalar rule-balancing fields; nested rules are omitted',
    items: {
      type: 'object',
      properties: {
        ruleNumber: { type: 'string' },
        balanceTypeRule: { type: 'boolean' },
        scale: { type: 'number' },
        sequence: { type: 'number' },
        name: { type: 'string' },
        description: { type: 'string', nullable: true },
        runningBalance: { type: 'number', nullable: true },
        balance: { type: 'number', nullable: true },
        allocationIn: { type: 'number', nullable: true },
        allocationOut: { type: 'number', nullable: true },
        adjustmentIn: { type: 'number', nullable: true },
        adjustmentOut: { type: 'number', nullable: true },
        input: { type: 'number', nullable: true },
        runningRemainder: { type: 'number', nullable: true },
        remainder: { type: 'number', nullable: true },
        netChange: { type: 'number', nullable: true },
        offset: { type: 'number', nullable: true },
      },
    },
  },
} satisfies ToolConfig['outputs']
