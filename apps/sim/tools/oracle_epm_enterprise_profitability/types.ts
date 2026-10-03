import type { UserFile } from '@/executor/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface OracleEpcmAuthParams {
  oauthCredential: string
  /** Credential-bound Basic authentication token injected by the executor. */
  accessToken?: string
  /** Credential-bound REST base URL, excluding product context and version. */
  instanceUrl?: string
}

export interface OracleEpcmListApplicationsParams extends OracleEpcmAuthParams {}

export interface OracleEpcmGetMemberParams extends OracleEpcmAuthParams {
  applicationName: string
  dimensionName: string
  memberName: string
}

export interface OracleEpcmAddMemberParams extends OracleEpcmAuthParams {
  applicationName: string
  dimensionName: string
  memberName: string
  parentName: string
}

export interface OracleEpcmListJobDefinitionsParams extends OracleEpcmAuthParams {
  applicationName: string
  jobType: 'IMPORT_DATA' | 'EXPORT_DATA' | 'IMPORT_METADATA' | 'EXPORT_METADATA'
}

export interface OracleEpcmGenerateModelDocumentationParams extends OracleEpcmAuthParams {
  applicationName: string
  jobName: string
  modelName: string
  fileName: string
  outputType?: 'PDF' | 'Word' | 'Excel' | 'HTML' | 'XML'
}

export interface OracleEpcmValidateModelParams extends OracleEpcmAuthParams {
  applicationName: string
  jobName: string
  modelName: string
  fileName: string
  ruleStatus?: 'All' | 'Enabled' | 'Disabled'
}

export interface OracleEpcmCalculateModelParams extends OracleEpcmAuthParams {
  applicationName: string
  jobName: string
  modelName: string
  povDelimiter?: string
  povName: string
  executionType?:
    | 'ALL_RULES'
    | 'RULESET_SUBSET'
    | 'SINGLE_RULE'
    | 'RUN_FROM_RULE'
    | 'STOP_AFTER_RULE'
  ruleName?: string
  rulesetSeqNumStart?: number
  rulesetSeqNumEnd?: number
  clearCalculatedData?: boolean
  executeCalculations?: boolean
  optimizeForReporting?: boolean
  captureDebugScripts?: boolean
  comment?: string
}

export interface OracleEpcmClearPovParams extends OracleEpcmAuthParams {
  applicationName: string
  jobName: string
  povDelimiter?: string
  povName: string
  cubeName: string
  clearInput?: boolean
  clearAllocatedValues?: boolean
  clearAdjustmentValues?: boolean
}

export interface OracleEpcmCopyPovParams extends OracleEpcmAuthParams {
  applicationName: string
  jobName: string
  povDelimiter?: string
  sourcePOVName: string
  destPOVName: string
  sourceCubeName: string
  destCubeName: string
  copyType: 'ALL_DATA' | 'INPUT'
}

export interface OracleEpcmDeletePovParams extends OracleEpcmAuthParams {
  applicationName: string
  jobName: string
  povDelimiter?: string
  povName: string
}

export interface OracleEpcmGetJobStatusParams extends OracleEpcmAuthParams {
  applicationName: string
  jobId: string
}

export interface OracleEpcmWaitForJobParams extends OracleEpcmAuthParams {
  applicationName: string
  jobId: string
  maxWaitSeconds?: number
}

export interface OracleEpcmGetJobDetailsParams extends OracleEpcmAuthParams {
  applicationName: string
  jobId: string
  jobType: 'IMPORT_DATA' | 'EXPORT_DATA' | 'IMPORT_METADATA' | 'EXPORT_METADATA'
  offset?: number
  limit?: number
  messageType?: 'ERROR' | 'WARNING' | 'INFO'
}

export interface OracleEpcmGetChildJobDetailsParams extends OracleEpcmAuthParams {
  applicationName: string
  jobId: string
  childJobId: string
  jobType: 'IMPORT_METADATA' | 'EXPORT_METADATA'
  offset?: number
  limit?: number
  messageType?: 'ERROR' | 'WARNING' | 'INFO'
}

export interface OracleEpcmExportDataSliceParams extends OracleEpcmAuthParams {
  applicationName: string
  cubeName: string
  gridDefinition: OracleEpcmGridDefinition | string
}

export interface OracleEpcmImportDataSliceParams extends OracleEpcmAuthParams {
  applicationName: string
  cubeName: string
  dataGrid: OracleEpcmDataGrid | string
  aggregateEssbaseData?: boolean
  dateFormat?:
    | 'MM-DD-YYYY'
    | 'DD-MM-YYYY'
    | 'YYYY-MM-DD'
    | 'MM/DD/YYYY'
    | 'DD/MM/YYYY'
    | 'YYYY/MM/DD'
  strictDateValidation?: boolean
}

export interface OracleEpcmImportDataParams extends OracleEpcmAuthParams {
  applicationName: string
  jobName?: string
  fileName?: string
  sourceType?: 'Planning' | 'Essbase'
  cubeName?: string
  delimiter?: 'comma' | 'tab'
  includeMetaData?: boolean
  stopOnError?: boolean
}

export interface OracleEpcmExportDataParams extends OracleEpcmAuthParams {
  applicationName: string
  jobName?: string
  fileName?: string
  cubeName?: string
  rowMembers?: string
  columnMembers?: string
  povMembers?: string
  delimiter?: 'comma' | 'tab'
  includeDynamicMembers?: boolean
  exportDataDecimalScale?: number
}

export interface OracleEpcmImportMetadataParams extends OracleEpcmAuthParams {
  applicationName: string
  jobName: string
  fileName?: string
  refreshCube?: boolean
}

export interface OracleEpcmExportMetadataParams extends OracleEpcmAuthParams {
  applicationName: string
  jobName: string
  fileName?: string
}

export interface OracleEpcmListFilesParams extends OracleEpcmAuthParams {}

export interface OracleEpcmUploadFileParams extends OracleEpcmAuthParams {
  fileName: string
  file: UserFile | UserFile[]
}

export interface OracleEpcmDownloadFileParams extends OracleEpcmAuthParams {
  fileName: string
}

export interface OracleEpcmDeleteFileParams extends OracleEpcmAuthParams {
  fileName: string
}

export type OracleEpcmExchangeJobType =
  | 'IMPORT_DATA'
  | 'EXPORT_DATA'
  | 'IMPORT_METADATA'
  | 'EXPORT_METADATA'

export interface OracleEpcmApplication {
  name: string
  type?: string
  appType?: string
  appStorage?: string
}

export interface OracleEpcmMember {
  name: string
  description?: string | null
  parentName?: string | null
  dimName?: string
  dataType?: string
  dataStorage?: string
  objectType?: number
  twoPass?: boolean
}

export interface OracleEpcmJob {
  jobId: string
  status: number
  state: 'pending' | 'succeeded' | 'failed'
  jobName?: string
  descriptiveStatus?: string
  details?: string | null
}

export interface OracleEpcmRepositoryFile {
  name: string
  type: 'EXTERNAL'
  size: number | null
  lastModifiedTime: number | null
}

export interface OracleEpcmGridDefinition {
  suppressMissingBlocks?: boolean
  suppressMissingRows?: boolean
  suppressMissingColumns?: boolean
  pov: { dimensions?: string[]; members: string[][] }
  rows: { dimensions?: string[]; members: string[][] }[]
  columns: { dimensions?: string[]; members: string[][] }[]
}

export interface OracleEpcmDataGrid {
  pov: string[]
  columns: string[][]
  rows: { headers: string[]; data: (string | number)[] }[]
}

export interface OracleEpcmImportResult {
  numAcceptedCells: number
  numRejectedCells: number
  numUpdateCells?: number
  rejectedCells?: string[]
  rejectedCellsWithDetails?: {
    memberNames: string[]
    readOnlyReasons: string[]
    otherReasons: string[]
  }[]
}

export interface OracleEpcmJobDetail {
  recordsRead?: number
  recordsRejected?: number
  recordsProcessed?: number
  dimensionName?: string
  loadType?: string
  childJobIds: string[]
}

export interface OracleEpcmJobMessage {
  msgType: string
  msgCategory?: string
  msgText: string
}

export type OracleEpcmOutput =
  | { applications: OracleEpcmApplication[] }
  | { member: OracleEpcmMember }
  | { jobDefinitions: { jobName: string; jobType: OracleEpcmExchangeJobType }[] }
  | OracleEpcmJob
  | (OracleEpcmJob & { attempts: number })
  | { details: OracleEpcmJobDetail[]; offset: number; limit: number }
  | { messages: OracleEpcmJobMessage[]; offset: number; limit: number }
  | { grid: OracleEpcmDataGrid }
  | OracleEpcmImportResult
  | { files: OracleEpcmRepositoryFile[] }
  | { file: UserFile }
  | { fileName: string; status: number }

export interface OracleEpcmResponse<T extends object = OracleEpcmOutput> extends ToolResponse {
  output: T
}

export const ORACLE_EPCM_ADD_MEMBER_OUTPUTS = {
  member: {
    type: 'object',
    description: 'Documented member properties; this is not a descendant listing',
    properties: {
      name: {
        type: 'string',
        description: 'Member name',
      },
      description: {
        type: 'string',
        optional: true,
        nullable: true,
      },
      parentName: {
        type: 'string',
        optional: true,
        nullable: true,
      },
      dimName: {
        type: 'string',
        optional: true,
      },
      dataType: {
        type: 'string',
        optional: true,
      },
      dataStorage: {
        type: 'string',
        optional: true,
      },
      objectType: {
        type: 'number',
        optional: true,
      },
      twoPass: {
        type: 'boolean',
        optional: true,
      },
    },
  },
} satisfies ToolConfig['outputs']

export const ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS = {
  jobId: {
    type: 'string',
    description: 'Oracle job ID; retain it for status and waiting',
  },
  status: {
    type: 'number',
    description:
      'Oracle status: -1 running, 0 success, 1 error, 2 cancelling, 3 cancelled, 4 invalid parameters, 2147483647 unknown',
  },
  state: {
    type: 'string',
    description: 'Normalized pending, succeeded, or failed state',
  },
  jobName: {
    type: 'string',
    description: 'Job name returned by Oracle',
    optional: true,
  },
  descriptiveStatus: {
    type: 'string',
    description: 'Oracle descriptive status',
    optional: true,
  },
  details: {
    type: 'string',
    description: 'Oracle job details',
    nullable: true,
    optional: true,
  },
} satisfies ToolConfig['outputs']

export const ORACLE_EPCM_DELETE_FILE_OUTPUTS = {
  fileName: {
    type: 'string',
  },
  status: {
    type: 'number',
    description: 'Oracle repository status; zero means success',
  },
} satisfies ToolConfig['outputs']

export const ORACLE_EPCM_DOWNLOAD_FILE_OUTPUTS = {
  file: {
    type: 'file',
    description: 'Canonical Sim UserFile stored in this execution',
  },
} satisfies ToolConfig['outputs']

export const ORACLE_EPCM_EXPORT_DATA_SLICE_OUTPUTS = {
  grid: {
    type: 'object',
    description: 'Data slice with unmodified financial cell values',
    properties: {
      pov: {
        type: 'array',
        items: {
          type: 'string',
        },
      },
      columns: {
        type: 'array',
        items: {
          type: 'array',
        },
      },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            headers: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
            data: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
          },
        },
      },
    },
  },
} satisfies ToolConfig['outputs']

export const ORACLE_EPCM_GET_CHILD_JOB_DETAILS_OUTPUTS = {
  messages: {
    type: 'array',
    description: 'Child job messages',
    items: {
      type: 'object',
      properties: {
        msgType: {
          type: 'string',
        },
        msgCategory: {
          type: 'string',
          optional: true,
        },
        msgText: {
          type: 'string',
        },
      },
    },
  },
  offset: {
    type: 'number',
  },
  limit: {
    type: 'number',
  },
} satisfies ToolConfig['outputs']

export const ORACLE_EPCM_GET_JOB_DETAILS_OUTPUTS = {
  details: {
    type: 'array',
    description: 'One page of exchange diagnostics',
    items: {
      type: 'object',
      properties: {
        recordsRead: {
          type: 'number',
          optional: true,
        },
        recordsRejected: {
          type: 'number',
          optional: true,
        },
        recordsProcessed: {
          type: 'number',
          optional: true,
        },
        dimensionName: {
          type: 'string',
          optional: true,
        },
        loadType: {
          type: 'string',
          optional: true,
        },
        childJobIds: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
      },
    },
  },
  offset: {
    type: 'number',
  },
  limit: {
    type: 'number',
  },
} satisfies ToolConfig['outputs']

export const ORACLE_EPCM_IMPORT_DATA_SLICE_OUTPUTS = {
  numAcceptedCells: {
    type: 'number',
  },
  numRejectedCells: {
    type: 'number',
  },
  numUpdateCells: {
    type: 'number',
    optional: true,
  },
  rejectedCells: {
    type: 'array',
    optional: true,
    items: {
      type: 'string',
    },
  },
  rejectedCellsWithDetails: {
    type: 'array',
    optional: true,
    items: {
      type: 'object',
      properties: {
        memberNames: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        readOnlyReasons: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        otherReasons: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
      },
    },
  },
} satisfies ToolConfig['outputs']

export const ORACLE_EPCM_LIST_APPLICATIONS_OUTPUTS = {
  applications: {
    type: 'array',
    description: 'Accessible applications (not filtered by an invented EPCM type)',
    items: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
        },
        type: {
          type: 'string',
          optional: true,
        },
        appType: {
          type: 'string',
          optional: true,
        },
        appStorage: {
          type: 'string',
          optional: true,
        },
      },
    },
  },
} satisfies ToolConfig['outputs']

export const ORACLE_EPCM_LIST_FILES_OUTPUTS = {
  files: {
    type: 'array',
    description: 'Ordinary repository files, excluding LCM snapshots',
    items: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
        },
        type: {
          type: 'string',
        },
        size: {
          type: 'number',
          nullable: true,
        },
        lastModifiedTime: {
          type: 'number',
          nullable: true,
        },
      },
    },
  },
} satisfies ToolConfig['outputs']

export const ORACLE_EPCM_LIST_JOB_DEFINITIONS_OUTPUTS = {
  jobDefinitions: {
    type: 'array',
    description: 'Saved exchange jobs matching the selected type',
    items: {
      type: 'object',
      properties: {
        jobName: {
          type: 'string',
        },
        jobType: {
          type: 'string',
        },
      },
    },
  },
} satisfies ToolConfig['outputs']

export const ORACLE_EPCM_WAIT_FOR_JOB_OUTPUTS = {
  jobId: {
    type: 'string',
    description: 'Oracle job ID; retain it for status and waiting',
  },
  status: {
    type: 'number',
    description:
      'Oracle status: -1 running, 0 success, 1 error, 2 cancelling, 3 cancelled, 4 invalid parameters, 2147483647 unknown',
  },
  state: {
    type: 'string',
    description: 'Normalized pending, succeeded, or failed state',
  },
  jobName: {
    type: 'string',
    description: 'Job name returned by Oracle',
    optional: true,
  },
  descriptiveStatus: {
    type: 'string',
    description: 'Oracle descriptive status',
    optional: true,
  },
  details: {
    type: 'string',
    description: 'Oracle job details',
    nullable: true,
    optional: true,
  },
  attempts: {
    type: 'number',
    description: 'Number of status reads',
  },
} satisfies ToolConfig['outputs']
