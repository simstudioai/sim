import type { UserFile } from '@/executor/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface OracleEpmDataAuthParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}

export interface OracleEpmDataWaitParams {
  waitForCompletion?: boolean
}

export interface OracleEpmDataConnectionOption {
  optionName: string
  optionValue: string
}

export interface OracleEpmDataGetConnectionParams extends OracleEpmDataAuthParams {
  connectionName: string
}

export interface OracleEpmDataUpdateConnectionParams extends OracleEpmDataAuthParams {
  sourceSystemId: string
  sourceSystemName: string
  sourceSystemType: string
  sourceSystemOptions: OracleEpmDataConnectionOption[]
}

export interface OracleEpmDataGetPipelineDetailsParams extends OracleEpmDataAuthParams {
  pipelineCode: string
}

export interface OracleEpmDataRunPipelineParams extends OracleEpmDataGetPipelineDetailsParams {
  variables?: Record<string, string>
}

export interface OracleEpmDataRunIntegrationParams extends OracleEpmDataAuthParams {
  jobName: string
  periodName: string
  importMode: string
  exportMode: string
  fileName?: string
  executionMode?: 'SYNC' | 'ASYNC'
  sourceFilters?: Record<string, string>
  targetOptions?: Record<string, string>
}

export interface OracleEpmDataRunDataRuleParams
  extends OracleEpmDataAuthParams,
    OracleEpmDataWaitParams {
  jobName: string
  startPeriod: string
  endPeriod: string
  importMode: string
  exportMode: string
  fileName?: string
}

export interface OracleEpmDataRunBatchParams
  extends OracleEpmDataAuthParams,
    OracleEpmDataWaitParams {
  jobName: string
}

export interface OracleEpmDataGetJobStatusParams
  extends OracleEpmDataAuthParams,
    OracleEpmDataWaitParams {
  jobId: string
}

export interface OracleEpmDataExecuteReportParams extends OracleEpmDataRunBatchParams {
  reportFormatType: string
  parameters: Record<string, string>
}

export interface OracleEpmDataImportMappingsParams
  extends OracleEpmDataAuthParams,
    OracleEpmDataWaitParams {
  dimension: string
  fileName: string
  importMode?: string
  validationMode?: boolean
  locationName?: string
}

export interface OracleEpmDataExportMappingsParams
  extends OracleEpmDataAuthParams,
    OracleEpmDataWaitParams {
  dimension: string
  fileName: string
  locationName: string
}

export interface OracleEpmDataImportDataIntegrationParams extends OracleEpmDataAuthParams {
  fileName: string
}

export interface OracleEpmDataExportDataIntegrationParams
  extends OracleEpmDataImportDataIntegrationParams,
    OracleEpmDataWaitParams {
  snapshotType: 'ALL' | 'ALL_INCREMENTAL' | 'INCREMENTAL' | 'SETUP'
  overwriteFile?: boolean
}

export interface OracleEpmDataGetPovStatusParams extends OracleEpmDataAuthParams {
  period: string
  category: string
  application?: string
  locationName?: string
}

export interface OracleEpmDataSetPovLockParams extends OracleEpmDataGetPovStatusParams {
  lockType: 'application' | 'location'
  lockOperation: 'lock' | 'unlock'
  unlockByLocation?: boolean
}

export interface OracleEpmDataUploadFileParams extends OracleEpmDataAuthParams {
  file: UserFile
  fileName: string
  extDirPath?: string
}

export interface OracleEpmDataDownloadFileParams extends OracleEpmDataAuthParams {
  fileName: string
}

export type OracleEpmDataDeleteFileParams = OracleEpmDataDownloadFileParams
export type OracleEpmDataListConnectionsParams = OracleEpmDataAuthParams
export type OracleEpmDataListFilesParams = OracleEpmDataAuthParams

export interface OracleEpmDataResponse<T extends object = Record<string, unknown>>
  extends ToolResponse {
  output: T
}

/** These two submissions deliberately promise no Oracle response properties. */
export type OracleEpmDataSubmissionResponse = OracleEpmDataResponse<{
  httpStatus: number
  data: unknown
}>

export interface OracleEpmDataJob {
  status: number
  jobId: string
  details: string | null
  jobName?: string | null
  jobStatus?: string | null
  descriptiveStatus?: string | null
  logFileName?: string | null
  outputFileName?: string | null
  processType?: string | null
  executedBy?: string | null
  action?: 'IMPORT' | 'EXPORT'
  snapshotType?: string
}

export type OracleEpmDataJobResponse = OracleEpmDataResponse<
  OracleEpmDataJob & { httpStatus: number }
>

export interface OracleEpmDataPov {
  period: string
  category: string
  status: string
  application: string
  location: string
}

export interface OracleEpmDataRepositoryFile {
  name: string
  type: string
  size: string | null
  lastmodifiedtime: string | null
}

export const ORACLE_EPM_DATA_STATUS_OUTPUTS = {
  httpStatus: {
    type: 'number',
    description: 'HTTP status returned by Oracle, distinct from Oracle job status',
  },
  status: {
    type: 'number',
    description: 'Oracle status code; HTTP success alone does not mean job completion',
  },
  details: {
    type: 'string',
    description: 'Oracle operation or error details',
    nullable: true,
    optional: true,
  },
} as const satisfies ToolConfig['outputs']

export const ORACLE_EPM_DATA_JOB_OUTPUTS = {
  httpStatus: {
    type: 'number',
    description: 'HTTP status returned by Oracle, distinct from Oracle job status',
  },
  status: {
    type: 'number',
    description: 'Oracle status code; HTTP success alone does not mean job completion',
  },
  details: {
    type: 'string',
    description: 'Oracle operation or error details',
    nullable: true,
    optional: true,
  },
  jobId: {
    type: 'string',
    description: 'Oracle process ID; snapshot imports return the non-pollable placeholder 0',
  },
  jobName: {
    type: 'string',
    description: 'Job name when returned',
    nullable: true,
    optional: true,
  },
  jobStatus: {
    type: 'string',
    description: 'Provider job status text',
    nullable: true,
    optional: true,
  },
  descriptiveStatus: {
    type: 'string',
    description: 'Provider description of job status',
    nullable: true,
    optional: true,
  },
  logFileName: {
    type: 'string',
    description: 'Repository filename of the execution log',
    nullable: true,
    optional: true,
  },
  outputFileName: {
    type: 'string',
    description: 'Repository filename of generated output, when available',
    nullable: true,
    optional: true,
  },
  processType: {
    type: 'string',
    description: 'Oracle process type',
    nullable: true,
    optional: true,
  },
  executedBy: {
    type: 'string',
    description: 'User that executed the Oracle job',
    nullable: true,
    optional: true,
  },
  action: {
    type: 'string',
    description: 'Snapshot action, when returned',
    optional: true,
  },
  snapshotType: {
    type: 'string',
    description: 'Export snapshot type, when returned',
    optional: true,
  },
} as const satisfies ToolConfig['outputs']

export const ORACLE_EPM_DATA_SUBMISSION_OUTPUTS = {
  httpStatus: {
    type: 'number',
    description: 'HTTP status returned by Oracle, distinct from Oracle job status',
  },
  data: {
    type: 'json',
    description:
      'Uninterpreted Oracle submission JSON. No acceptance, completion, status, or job-ID field is assumed.',
  },
} as const satisfies ToolConfig['outputs']

export const ORACLE_EPM_DATA_CONNECTIONS_OUTPUTS = {
  httpStatus: {
    type: 'number',
    description: 'HTTP status returned by Oracle, distinct from Oracle job status',
  },
  status: {
    type: 'number',
    description: 'Oracle status code; HTTP success alone does not mean job completion',
  },
  details: {
    type: 'string',
    description: 'Oracle operation or error details',
    nullable: true,
    optional: true,
  },
  connections: {
    type: 'array',
    description: 'Documented Data Integration connection names and references',
    items: {
      type: 'object',
      properties: {
        connectionName: {
          type: 'string',
          description: 'Connection name',
        },
        refUrl: {
          type: 'string',
          description: 'Provider reference URL; not an arbitrary URL input',
        },
      },
    },
    optional: true,
  },
} as const satisfies ToolConfig['outputs']

export const ORACLE_EPM_DATA_CONNECTION_OUTPUTS = {
  httpStatus: {
    type: 'number',
    description: 'HTTP status returned by Oracle, distinct from Oracle job status',
  },
  status: {
    type: 'number',
    description: 'Oracle status code; HTTP success alone does not mean job completion',
  },
  details: {
    type: 'string',
    description: 'Oracle operation or error details',
    nullable: true,
    optional: true,
  },
  connection: {
    type: 'json',
    description: 'Connection definition and Oracle-returned options',
    properties: {
      status: {
        type: 'number',
        description: 'Oracle status code; HTTP success alone does not mean job completion',
      },
      sourceSystemId: {
        type: 'string',
        description: 'Connection ID, normalized to a string',
      },
      sourceSystemName: {
        type: 'string',
        description: 'Source system name',
      },
      sourceSystemType: {
        type: 'string',
        description: 'Source system type',
      },
      sourceSystemDescription: {
        type: 'string',
        description: 'Source system description',
        nullable: true,
        optional: true,
      },
      sourceSystemOptions: {
        type: 'array',
        description: 'Connection options',
        items: {
          type: 'object',
          properties: {
            optionName: {
              type: 'string',
              description: 'Oracle option name',
            },
            optionValue: {
              type: 'string',
              description: 'Oracle option value; secret values may be masked by Oracle',
            },
          },
        },
        optional: true,
      },
    },
    optional: true,
  },
} as const satisfies ToolConfig['outputs']

export const ORACLE_EPM_DATA_PIPELINE_OUTPUTS = {
  httpStatus: {
    type: 'number',
    description: 'HTTP status returned by Oracle, distinct from Oracle job status',
  },
  status: {
    type: 'number',
    description: 'Oracle status code; HTTP success alone does not mean job completion',
  },
  details: {
    type: 'string',
    description: 'Oracle operation or error details',
    nullable: true,
    optional: true,
  },
  pipeline: {
    type: 'json',
    description: 'Pipeline definition, variables, stages, jobs, and latest execution metadata',
    properties: {
      name: {
        type: 'string',
        description: 'Pipeline code',
      },
      displayName: {
        type: 'string',
        description: 'Pipeline display name',
      },
      id: {
        type: 'number',
        description: 'Pipeline definition ID',
      },
      parallelJobs: {
        type: 'number',
        description: 'Parallel job setting',
      },
      variables: {
        type: 'array',
        description: 'Configured pipeline variables',
        items: {
          type: 'object',
          properties: {
            varName: {
              type: 'string',
              description: 'Variable name',
            },
            varDisplayName: {
              type: 'string',
              description: 'Variable display name',
            },
            varDefaultValue: {
              type: 'string',
              description: 'Variable default value',
              nullable: true,
              optional: true,
            },
            varType: {
              type: 'string',
              description: 'Variable type',
            },
            varValObject: {
              type: 'string',
              description: 'Variable value object',
              nullable: true,
              optional: true,
            },
            varSequence: {
              type: 'number',
              description: 'Variable sequence',
            },
            varDefaultParam: {
              type: 'string',
              description: 'Default parameter flag',
            },
          },
        },
        optional: true,
      },
      stages: {
        type: 'array',
        description: 'Configured stages and their jobs',
        items: {
          type: 'object',
          properties: {
            stageName: {
              type: 'string',
              description: 'Stage name',
            },
            stageDisplayName: {
              type: 'string',
              description: 'Stage display name',
            },
            stageID: {
              type: 'number',
              description: 'Stage ID',
            },
            stageSequence: {
              type: 'number',
              description: 'Stage sequence',
            },
            stageParallel: {
              type: 'string',
              description: 'Parallel stage flag',
            },
            plNextStageSuccess: {
              type: 'string',
              description: 'Next-stage behavior on success',
            },
            plNextStageFailure: {
              type: 'string',
              description: 'Next-stage behavior on failure',
            },
            jobs: {
              type: 'array',
              description: 'Configured stage jobs',
              items: {
                type: 'object',
                properties: {
                  jobType: {
                    type: 'string',
                    description: 'Configured job type',
                  },
                  jobName: {
                    type: 'string',
                    description: 'Configured job name',
                  },
                  jobID: {
                    type: 'number',
                    description: 'Configured job ID',
                  },
                  jobSeq: {
                    type: 'number',
                    description: 'Job sequence',
                  },
                  jobObject: {
                    type: 'string',
                    description: 'Job object',
                    nullable: true,
                    optional: true,
                  },
                  jobConnection: {
                    type: 'string',
                    description: 'Connection name',
                    nullable: true,
                    optional: true,
                  },
                  status: {
                    type: 'string',
                    description: 'Latest job status',
                    nullable: true,
                    optional: true,
                  },
                  endTime: {
                    type: 'string',
                    description: 'Latest end time',
                    nullable: true,
                    optional: true,
                  },
                  logFile: {
                    type: 'string',
                    description: 'Latest log filename',
                    nullable: true,
                    optional: true,
                  },
                  processId: {
                    type: 'number',
                    description: 'Latest process ID',
                    optional: true,
                    nullable: true,
                  },
                  parameters: {
                    type: 'array',
                    description: 'Configured job parameters',
                    items: {
                      type: 'object',
                      properties: {
                        paramName: {
                          type: 'string',
                          description: 'Parameter name',
                        },
                        paramValue: {
                          type: 'string',
                          description: 'Parameter value',
                          nullable: true,
                          optional: true,
                        },
                        paramLevel: {
                          type: 'string',
                          description: 'Parameter level',
                        },
                      },
                    },
                    optional: true,
                  },
                },
              },
              optional: true,
            },
          },
        },
        optional: true,
      },
      status: {
        type: 'string',
        description: 'Latest pipeline status',
        nullable: true,
        optional: true,
      },
      processId: {
        type: 'number',
        description: 'Latest process ID',
        optional: true,
        nullable: true,
      },
      lastUpdatedDate: {
        type: 'string',
        description: 'Latest update date',
        nullable: true,
        optional: true,
      },
      proxyAdminUser: {
        type: 'string',
        description: 'Proxy administrator',
        nullable: true,
        optional: true,
      },
    },
    optional: true,
  },
} as const satisfies ToolConfig['outputs']

export const ORACLE_EPM_DATA_POV_OUTPUTS = {
  httpStatus: {
    type: 'number',
    description: 'HTTP status returned by Oracle, distinct from Oracle job status',
  },
  status: {
    type: 'number',
    description: 'Oracle status code; HTTP success alone does not mean job completion',
  },
  details: {
    type: 'string',
    description: 'Oracle operation or error details',
    nullable: true,
    optional: true,
  },
  povs: {
    type: 'array',
    description: 'POV lock records; may include an application-summary record',
    items: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'Period name',
        },
        category: {
          type: 'string',
          description: 'Category name',
        },
        status: {
          type: 'string',
          description: 'Lock status',
        },
        application: {
          type: 'string',
          description: 'Application name',
        },
        location: {
          type: 'string',
          description: 'Location or application-summary name',
        },
      },
    },
    optional: true,
  },
} as const satisfies ToolConfig['outputs']

export const ORACLE_EPM_DATA_MESSAGE_OUTPUTS = {
  httpStatus: {
    type: 'number',
    description: 'HTTP status returned by Oracle, distinct from Oracle job status',
  },
  status: {
    type: 'number',
    description: 'Oracle status code; HTTP success alone does not mean job completion',
  },
  details: {
    type: 'string',
    description: 'Oracle operation or error details',
    nullable: true,
    optional: true,
  },
  response: {
    type: 'string',
    description: 'Oracle confirmation message',
    optional: true,
  },
} as const satisfies ToolConfig['outputs']

export const ORACLE_EPM_DATA_FILES_OUTPUTS = {
  httpStatus: {
    type: 'number',
    description: 'HTTP status returned by Oracle, distinct from Oracle job status',
  },
  status: {
    type: 'number',
    description: 'Oracle status code; HTTP success alone does not mean job completion',
  },
  details: {
    type: 'string',
    description: 'Oracle operation or error details',
    nullable: true,
    optional: true,
  },
  files: {
    type: 'array',
    description: 'Repository files and application snapshots',
    items: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Complete repository filename',
        },
        type: {
          type: 'string',
          description: 'EXTERNAL or LCM snapshot',
        },
        size: {
          type: 'string',
          description: 'Byte count as an Oracle decimal string; null for LCM snapshots',
          nullable: true,
          optional: true,
        },
        lastmodifiedtime: {
          type: 'string',
          description:
            'Milliseconds since epoch as an Oracle decimal string; null for LCM snapshots',
          nullable: true,
          optional: true,
        },
      },
    },
    optional: true,
  },
} as const satisfies ToolConfig['outputs']

export const ORACLE_EPM_DATA_FILE_STATUS_OUTPUTS = {
  httpStatus: {
    type: 'number',
    description: 'HTTP status returned by Oracle, distinct from Oracle job status',
  },
  status: {
    type: 'number',
    description: 'Oracle status code; HTTP success alone does not mean job completion',
  },
  details: {
    type: 'string',
    description: 'Oracle operation or error details',
    nullable: true,
    optional: true,
  },
  fileName: {
    type: 'string',
    description: 'Complete repository filename',
  },
} as const satisfies ToolConfig['outputs']

export const ORACLE_EPM_DATA_DOWNLOAD_OUTPUTS = {
  httpStatus: {
    type: 'number',
    description: 'HTTP status returned by Oracle, distinct from Oracle job status',
  },
  fileName: {
    type: 'string',
    description: 'Complete repository filename',
  },
  file: {
    type: 'file',
    description: 'Downloaded UserFile stored in this workflow execution',
  },
} as const satisfies ToolConfig['outputs']
