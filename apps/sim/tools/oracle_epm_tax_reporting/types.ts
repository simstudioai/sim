import type { UserFile } from '@/executor/types'
import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

export interface TaxReportingParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  application?: string
  jobType?: string
  jobName?: string
  parameters?: Record<string, unknown>
  dimension?: string
  memberName?: string
  parentName?: string
  planType?: string
  gridDefinition?: Record<string, unknown>
  dataGrid?: Record<string, unknown>
  aggregateEssbaseData?: boolean
  dateFormat?: string
  strictDateValidation?: boolean
  clearEssbaseData?: boolean
  clearPlanningData?: boolean
  profileName?: string
  waitForCompletion?: boolean
  jobId?: string
  jobFamily?: string
  childJobId?: string
  limit?: number
  offset?: number
  messageType?: string
  exportZipFileName?: string
  importZipFileName?: string
  refreshCube?: boolean
  errorFile?: string
  fileName?: string
  collection?: string
  year?: string
  period?: string
  frequencyDimensions?: Record<string, unknown>
  collectionIntervalName?: string
  templates?: string[]
  resetWorkflows?: boolean
  importMode?: string
  delimiter?: string
  groupName?: string
  reportName?: string
  generatedReportFileName?: string
  format?: string
  module?: string
  reportStatusRoute?: string
  downloadReport?: boolean
  file?: UserFile
  directory?: string
}

export interface TaxReportingLink {
  rel?: string
  href: string
  action?: string
}
export interface TaxReportingStatus {
  status: number
  details?: string | null
  links?: TaxReportingLink[]
}
export interface TaxReportingWait {
  waitOutcome?: 'incomplete'
}
export interface TaxReportingJob extends TaxReportingStatus, TaxReportingWait {
  jobId?: string
  jobName?: string
  detailedStatus?: number
  descriptiveStatus?: string | null
}
export interface TaxReportingReport extends TaxReportingStatus, TaxReportingWait {
  jobId?: string
  type?: string
}
export interface TaxVersionResponse extends ToolResponse {
  output: { version: string; lifecycle?: string; isLatest?: boolean }
}
export interface TaxApplicationsResponse extends ToolResponse {
  output: {
    items: Array<{
      name: string
      type?: string
      appType?: string
      appStorage?: string
      unicode?: boolean
      adminMode?: boolean | 'true' | 'false'
    }>
  }
}
export interface TaxDefinitionsResponse extends ToolResponse {
  output: { items: Array<{ jobName: string; jobType: string }> }
}
export interface TaxMemberResponse extends ToolResponse {
  output: {
    name: string
    parentName?: string | null
    description?: string | null
    dataType?: string
    objectType?: number
    dataStorage?: string
    dimName?: string
    twoPass?: boolean
  }
}
export interface TaxJobResponse extends ToolResponse {
  output: TaxReportingJob
}
export interface TaxJobStatusResponse extends ToolResponse {
  output: TaxReportingJob & { detail?: string | null }
}
export interface TaxSupplementalResponse extends ToolResponse {
  output: TaxReportingStatus & TaxReportingWait & { jobId?: string; detail?: string | null }
}
export interface TaxReportJobResponse extends ToolResponse {
  output: TaxReportingReport
}
export interface TaxReportResponse extends ToolResponse {
  output: TaxReportingReport & { file?: UserFile }
}
export interface TaxUploadResponse extends ToolResponse {
  output: TaxReportingStatus
}
export interface TaxGridResponse extends ToolResponse {
  output: {
    pov: string[]
    columns: string[][]
    rows: Array<{ headers: string[]; data: Array<string | number> }>
  }
}
export interface TaxImportSliceResponse extends ToolResponse {
  output: {
    numAcceptedCells: number
    numUpdateCells?: number
    numRejectedCells: number
    rejectedCells?: string[]
    rejectedCellsWithDetails?: Array<{
      memberNames: string[]
      readOnlyReasons: string[]
      otherReasons: string[]
    }>
  }
}
export interface TaxClearSliceResponse extends ToolResponse {
  output: { numClearedCells: number; numRejectedCells: number; rejectedCells?: string[] }
}
export interface TaxDetailsResponse extends ToolResponse {
  output: {
    items: Array<{
      recordsRead?: number
      recordsRejected?: number
      recordsProcessed?: number
      dimensionName?: string
      loadType?: string
      links?: TaxReportingLink[]
    }>
    links?: TaxReportingLink[]
  }
}
export interface TaxChildDetailsResponse extends ToolResponse {
  output: {
    items: Array<{ msgType: string; msgCategory: string; msgText: string }>
    links?: TaxReportingLink[]
  }
}
export interface TaxFilesResponse extends ToolResponse {
  output: TaxReportingStatus & {
    items: Array<{
      name: string
      type: 'LCM' | 'EXTERNAL'
      size?: string | number | null
      lastmodifiedtime?: string | number | null
    }>
  }
}
export interface TaxFileResponse extends ToolResponse {
  output: { file: UserFile }
}

export type TaxReportingConnection = Pick<
  TaxReportingParams,
  'oauthCredential' | 'accessToken' | 'instanceUrl'
>
export type TaxGetApiVersionParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, never>> &
  Pick<TaxReportingParams, never>
export type TaxListApplicationsParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, never>> &
  Pick<TaxReportingParams, never>
export type TaxListJobDefinitionsParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application'>> &
  Pick<TaxReportingParams, 'jobType'>
export type TaxGetMemberParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'dimension' | 'memberName'>> &
  Pick<TaxReportingParams, never>
export type TaxAddMemberParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'dimension' | 'memberName' | 'parentName'>> &
  Pick<TaxReportingParams, never>
export type TaxExportDataSliceParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'planType' | 'gridDefinition'>> &
  Pick<TaxReportingParams, never>
export type TaxImportDataSliceParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'planType' | 'dataGrid'>> &
  Pick<TaxReportingParams, 'aggregateEssbaseData' | 'dateFormat' | 'strictDateValidation'>
export type TaxClearDataSliceParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'planType' | 'gridDefinition'>> &
  Pick<TaxReportingParams, 'clearEssbaseData' | 'clearPlanningData'>
export type TaxCopyDataParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'profileName'>> &
  Pick<TaxReportingParams, 'waitForCompletion'>
export type TaxClearDataParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'profileName'>> &
  Pick<TaxReportingParams, 'waitForCompletion'>
export type TaxRunRuleParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'jobName'>> &
  Pick<TaxReportingParams, 'parameters' | 'waitForCompletion'>
export type TaxRunRulesetParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'jobName'>> &
  Pick<TaxReportingParams, 'parameters' | 'waitForCompletion'>
export type TaxExecuteJobParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'jobType' | 'jobName'>> &
  Pick<TaxReportingParams, 'parameters' | 'waitForCompletion'>
export type TaxGetJobStatusParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'jobId'>> &
  Pick<TaxReportingParams, 'application' | 'jobFamily' | 'waitForCompletion'>
export type TaxGetJobDetailsParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'jobId'>> &
  Pick<TaxReportingParams, 'limit' | 'offset' | 'messageType'>
export type TaxGetChildJobDetailsParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'jobId' | 'childJobId'>> &
  Pick<TaxReportingParams, 'limit' | 'offset' | 'messageType'>
export type TaxExportMetadataParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'jobName'>> &
  Pick<TaxReportingParams, 'exportZipFileName' | 'waitForCompletion'>
export type TaxImportMetadataParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'jobName'>> &
  Pick<TaxReportingParams, 'importZipFileName' | 'refreshCube' | 'errorFile' | 'waitForCompletion'>
export type TaxImportSupplementalCollectionDataParams = TaxReportingConnection &
  Required<
    Pick<TaxReportingParams, 'application' | 'fileName' | 'collection' | 'year' | 'period'>
  > &
  Pick<TaxReportingParams, 'frequencyDimensions' | 'jobName' | 'waitForCompletion'>
export type TaxDeployFormTemplatesParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'application' | 'collectionIntervalName' | 'templates'>> &
  Pick<
    TaxReportingParams,
    'frequencyDimensions' | 'resetWorkflows' | 'jobName' | 'waitForCompletion'
  >
export type TaxImportSupplementalDimensionMembersParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'dimension' | 'fileName'>> &
  Pick<TaxReportingParams, 'importMode' | 'delimiter' | 'dateFormat' | 'waitForCompletion'>
export type TaxGenerateReportParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'groupName' | 'reportName' | 'module'>> &
  Pick<
    TaxReportingParams,
    'generatedReportFileName' | 'parameters' | 'format' | 'waitForCompletion'
  >
export type TaxGenerateUserDetailsReportParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'fileName'>> &
  Pick<TaxReportingParams, 'format' | 'waitForCompletion'>
export type TaxGetReportStatusParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'jobId'>> &
  Pick<TaxReportingParams, 'module' | 'reportStatusRoute' | 'waitForCompletion' | 'downloadReport'>
export type TaxListFilesParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, never>> &
  Pick<TaxReportingParams, never>
export type TaxUploadFileParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'file' | 'fileName'>> &
  Pick<TaxReportingParams, 'directory'>
export type TaxDownloadFileParams = TaxReportingConnection &
  Required<Pick<TaxReportingParams, 'fileName'>> &
  Pick<TaxReportingParams, never>

/** Generator-readable constants follow the Cal.com types.ts output precedent. */
export const TAX_VERSION_OUTPUTS = {
  version: {
    type: 'string',
    description: 'API version',
  },
  lifecycle: {
    type: 'string',
    description: 'API lifecycle',
    optional: true,
  },
  isLatest: {
    type: 'boolean',
    description: 'Whether this is the latest API version',
    optional: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_APPLICATIONS_OUTPUTS = {
  items: {
    type: 'array',
    description: 'Accessible applications (bounded to 1,000)',
    items: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Application name',
        },
        type: {
          type: 'string',
          description: 'Product type',
          optional: true,
        },
        appType: {
          type: 'string',
          description: 'Business process type',
          optional: true,
        },
        appStorage: {
          type: 'string',
          description: 'Storage type',
          optional: true,
        },
        unicode: {
          type: 'boolean',
          description: 'Unicode enabled',
          optional: true,
        },
        adminMode: {
          type: 'json',
          description:
            'Oracle boolean or documented string boolean indicating administrator-only access',
          optional: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_DEFINITIONS_OUTPUTS = {
  items: {
    type: 'array',
    description: 'Deployed definitions, not running jobs (bounded to 1,000)',
    items: {
      type: 'object',
      properties: {
        jobName: {
          type: 'string',
          description: 'Exact deployed job name',
        },
        jobType: {
          type: 'string',
          description: 'Oracle job type',
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_MEMBER_OUTPUTS = {
  name: {
    type: 'string',
    description: 'Member name',
  },
  parentName: {
    type: 'string',
    description: 'Parent member',
    optional: true,
    nullable: true,
  },
  description: {
    type: 'string',
    description: 'Member description',
    optional: true,
    nullable: true,
  },
  dataType: {
    type: 'string',
    description: 'Member data type',
    optional: true,
  },
  objectType: {
    type: 'number',
    description: 'Oracle object type',
    optional: true,
  },
  dataStorage: {
    type: 'string',
    description: 'Storage attribute',
    optional: true,
  },
  dimName: {
    type: 'string',
    description: 'Dimension name',
    optional: true,
  },
  twoPass: {
    type: 'boolean',
    description: 'Two-pass calculation attribute',
    optional: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_JOB_OUTPUTS = {
  status: {
    type: 'number',
    description:
      'Oracle status: -1 pending, 0 success; other statuses depend on job family. 2 means cancellation pending for planning jobs.',
  },
  jobId: {
    type: 'string',
    description: 'Submitted job ID, normalized from documented jobId/jobID when returned.',
    optional: true,
  },
  jobName: {
    type: 'string',
    description: 'Oracle job name',
    optional: true,
  },
  details: {
    type: 'string',
    description: 'Oracle job details',
    optional: true,
    nullable: true,
  },
  descriptiveStatus: {
    type: 'string',
    description: 'Oracle status description',
    optional: true,
    nullable: true,
  },
  links: {
    type: 'array',
    description:
      'Documented Oracle links; returned links must be validated before authenticated use.',
    optional: true,
    items: {
      type: 'object',
      properties: {
        rel: {
          type: 'string',
          description: 'Exact relationship',
          optional: true,
        },
        href: {
          type: 'string',
          description: 'Provider-returned link target',
        },
        action: {
          type: 'string',
          description: 'HTTP method',
          optional: true,
        },
      },
    },
  },
  detailedStatus: {
    type: 'number',
    description: 'Oracle granular job status code, when returned.',
    optional: true,
  },
  waitOutcome: {
    type: 'string',
    description:
      'Sim local wait outcome: incomplete means waiting stopped before observing completion. The last Oracle snapshot is retained; inspect jobId or Job Status links before any resubmission. This is not an Oracle status or cancellation.',
    optional: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_GRID_OUTPUTS = {
  pov: {
    type: 'array',
    description: 'Point-of-view member names',
    items: {
      type: 'string',
    },
  },
  columns: {
    type: 'array',
    description: 'Arrays of column member names',
    items: {
      type: 'array',
    },
  },
  rows: {
    type: 'array',
    description: 'Core data rows (up to 1,000)',
    items: {
      type: 'object',
      properties: {
        headers: {
          type: 'array',
          description: 'Row member names',
          items: {
            type: 'string',
          },
        },
        data: {
          type: 'array',
          description: 'Text or numeric cell values',
          items: {
            type: 'json',
          },
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_IMPORT_SLICE_OUTPUTS = {
  numAcceptedCells: {
    type: 'number',
    description: 'Cells accepted for save',
  },
  numUpdateCells: {
    type: 'number',
    description: 'Cells actually updated',
    optional: true,
  },
  numRejectedCells: {
    type: 'number',
    description: 'Rejected cells',
  },
  rejectedCells: {
    type: 'array',
    description: 'First 100 rejected cell intersections',
    optional: true,
    items: {
      type: 'string',
    },
  },
  rejectedCellsWithDetails: {
    type: 'array',
    description: 'First 100 rejection diagnostics',
    optional: true,
    items: {
      type: 'object',
      properties: {
        memberNames: {
          type: 'array',
          description: 'Intersection members',
          items: {
            type: 'string',
          },
        },
        readOnlyReasons: {
          type: 'array',
          description: 'Read-only reasons',
          items: {
            type: 'string',
          },
        },
        otherReasons: {
          type: 'array',
          description: 'Other rejection reasons',
          items: {
            type: 'string',
          },
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_CLEAR_SLICE_OUTPUTS = {
  numClearedCells: {
    type: 'number',
    description: 'Cleared cells',
  },
  numRejectedCells: {
    type: 'number',
    description: 'Rejected cells',
  },
  rejectedCells: {
    type: 'array',
    description: 'Rejected cell intersections',
    optional: true,
    items: {
      type: 'string',
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_DETAILS_OUTPUTS = {
  items: {
    type: 'array',
    description: 'One page of job detail records',
    items: {
      type: 'object',
      properties: {
        recordsRead: {
          type: 'number',
          description: 'Records read',
          optional: true,
        },
        recordsRejected: {
          type: 'number',
          description: 'Rejected records',
          optional: true,
        },
        recordsProcessed: {
          type: 'number',
          description: 'Processed records',
          optional: true,
        },
        dimensionName: {
          type: 'string',
          description: 'Dimension name',
          optional: true,
        },
        loadType: {
          type: 'string',
          description: 'Load type',
          optional: true,
        },
        links: {
          type: 'array',
          description:
            'Documented Oracle links; returned links must be validated before authenticated use.',
          optional: true,
          items: {
            type: 'object',
            properties: {
              rel: {
                type: 'string',
                description: 'Exact relationship',
                optional: true,
              },
              href: {
                type: 'string',
                description: 'Provider-returned link target',
              },
              action: {
                type: 'string',
                description: 'HTTP method',
                optional: true,
              },
            },
          },
        },
      },
    },
  },
  links: {
    type: 'array',
    description:
      'Documented Oracle links; returned links must be validated before authenticated use.',
    optional: true,
    items: {
      type: 'object',
      properties: {
        rel: {
          type: 'string',
          description: 'Exact relationship',
          optional: true,
        },
        href: {
          type: 'string',
          description: 'Provider-returned link target',
        },
        action: {
          type: 'string',
          description: 'HTTP method',
          optional: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_CHILD_DETAILS_OUTPUTS = {
  items: {
    type: 'array',
    description: 'One page of child-job messages',
    items: {
      type: 'object',
      properties: {
        msgType: {
          type: 'string',
          description: 'Message type',
        },
        msgCategory: {
          type: 'string',
          description: 'Message category',
        },
        msgText: {
          type: 'string',
          description: 'Diagnostic message',
        },
      },
    },
  },
  links: {
    type: 'array',
    description:
      'Documented Oracle links; returned links must be validated before authenticated use.',
    optional: true,
    items: {
      type: 'object',
      properties: {
        rel: {
          type: 'string',
          description: 'Exact relationship',
          optional: true,
        },
        href: {
          type: 'string',
          description: 'Provider-returned link target',
        },
        action: {
          type: 'string',
          description: 'HTTP method',
          optional: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_REPORT_OUTPUTS = {
  status: {
    type: 'number',
    description:
      'Oracle migration status: -1 in progress, 0 success, any positive value is failure.',
  },
  details: {
    type: 'string',
    description: 'Oracle job details',
    optional: true,
    nullable: true,
  },
  links: {
    type: 'array',
    description:
      'Documented Oracle links; returned links must be validated before authenticated use.',
    optional: true,
    items: {
      type: 'object',
      properties: {
        rel: {
          type: 'string',
          description: 'Exact relationship',
          optional: true,
        },
        href: {
          type: 'string',
          description: 'Provider-returned link target',
        },
        action: {
          type: 'string',
          description: 'HTTP method',
          optional: true,
        },
      },
    },
  },
  jobId: {
    type: 'string',
    description: 'Submitted job ID, normalized from documented jobId/jobID when returned.',
    optional: true,
  },
  type: {
    type: 'string',
    description: 'Report or job type',
    optional: true,
  },
  waitOutcome: {
    type: 'string',
    description:
      'Sim local wait outcome: incomplete means waiting stopped before observing completion. The last Oracle snapshot is retained; inspect jobId or Job Status links before any resubmission. This is not an Oracle status or cancellation.',
    optional: true,
  },
  file: {
    type: 'file',
    description: 'Stored report as a canonical Sim UserFile when explicitly requested and complete',
    optional: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_FILES_OUTPUTS = {
  status: {
    type: 'number',
    description: 'Oracle migration status (0 success)',
  },
  details: {
    type: 'string',
    description: 'Oracle file-list details',
    optional: true,
    nullable: true,
  },
  items: {
    type: 'array',
    description: 'Repository files and snapshots (up to 1,000)',
    items: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Raw repository path',
        },
        type: {
          type: 'string',
          description: 'LCM or EXTERNAL',
        },
        size: {
          type: 'json',
          description: 'Byte size as documented numeric string or number; null for snapshots',
          optional: true,
          nullable: true,
        },
        lastmodifiedtime: {
          type: 'json',
          description:
            'Milliseconds since epoch as documented numeric string or number; null for snapshots',
          optional: true,
          nullable: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_FILE_OUTPUTS = {
  file: {
    type: 'file',
    description:
      'Downloaded canonical Sim UserFile with authorized storage key, name, type, size, and temporary URL',
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_UPLOAD_OUTPUTS = {
  status: {
    type: 'number',
    description:
      'Oracle migration status: -1 in progress, 0 success, any positive value is failure.',
  },
  details: {
    type: 'string',
    description: 'Oracle job details',
    optional: true,
    nullable: true,
  },
  links: {
    type: 'array',
    description:
      'Documented Oracle links; returned links must be validated before authenticated use.',
    optional: true,
    items: {
      type: 'object',
      properties: {
        rel: {
          type: 'string',
          description: 'Exact relationship',
          optional: true,
        },
        href: {
          type: 'string',
          description: 'Provider-returned link target',
        },
        action: {
          type: 'string',
          description: 'HTTP method',
          optional: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_SUPPLEMENTAL_OUTPUTS = {
  status: {
    type: 'number',
    description:
      'Oracle migration status: -1 in progress, 0 success, any positive value is failure.',
  },
  details: {
    type: 'string',
    description: 'Oracle job details',
    optional: true,
    nullable: true,
  },
  links: {
    type: 'array',
    description:
      'Documented Oracle links; returned links must be validated before authenticated use.',
    optional: true,
    items: {
      type: 'object',
      properties: {
        rel: {
          type: 'string',
          description: 'Exact relationship',
          optional: true,
        },
        href: {
          type: 'string',
          description: 'Provider-returned link target',
        },
        action: {
          type: 'string',
          description: 'HTTP method',
          optional: true,
        },
      },
    },
  },
  jobId: {
    type: 'string',
    description: 'Submitted job ID, normalized from documented jobId/jobID when returned.',
    optional: true,
  },
  detail: {
    type: 'string',
    description: 'Supplemental deployment details when returned under singular detail',
    optional: true,
    nullable: true,
  },
  waitOutcome: {
    type: 'string',
    description:
      'Sim local wait outcome: incomplete means waiting stopped before observing completion. The last Oracle snapshot is retained; inspect jobId or Job Status links before any resubmission. This is not an Oracle status or cancellation.',
    optional: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_REPORT_JOB_OUTPUTS = {
  status: {
    type: 'number',
    description:
      'Oracle migration status: -1 in progress, 0 success, any positive value is failure.',
  },
  details: {
    type: 'string',
    description: 'Oracle job details',
    optional: true,
    nullable: true,
  },
  links: {
    type: 'array',
    description:
      'Documented Oracle links; returned links must be validated before authenticated use.',
    optional: true,
    items: {
      type: 'object',
      properties: {
        rel: {
          type: 'string',
          description: 'Exact relationship',
          optional: true,
        },
        href: {
          type: 'string',
          description: 'Provider-returned link target',
        },
        action: {
          type: 'string',
          description: 'HTTP method',
          optional: true,
        },
      },
    },
  },
  jobId: {
    type: 'string',
    description: 'Submitted job ID, normalized from documented jobId/jobID when returned.',
    optional: true,
  },
  type: {
    type: 'string',
    description: 'Report or job type',
    optional: true,
  },
  waitOutcome: {
    type: 'string',
    description:
      'Sim local wait outcome: incomplete means waiting stopped before observing completion. The last Oracle snapshot is retained; inspect jobId or Job Status links before any resubmission. This is not an Oracle status or cancellation.',
    optional: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const TAX_JOB_STATUS_OUTPUTS = {
  status: {
    type: 'number',
    description:
      'Oracle status: -1 pending, 0 success; other statuses depend on job family. 2 means cancellation pending for planning jobs.',
  },
  jobId: {
    type: 'string',
    description: 'Submitted job ID, normalized from documented jobId/jobID when returned.',
    optional: true,
  },
  jobName: {
    type: 'string',
    description: 'Oracle job name',
    optional: true,
  },
  details: {
    type: 'string',
    description: 'Oracle job details',
    optional: true,
    nullable: true,
  },
  descriptiveStatus: {
    type: 'string',
    description: 'Oracle status description',
    optional: true,
    nullable: true,
  },
  links: {
    type: 'array',
    description:
      'Documented Oracle links; returned links must be validated before authenticated use.',
    optional: true,
    items: {
      type: 'object',
      properties: {
        rel: {
          type: 'string',
          description: 'Exact relationship',
          optional: true,
        },
        href: {
          type: 'string',
          description: 'Provider-returned link target',
        },
        action: {
          type: 'string',
          description: 'HTTP method',
          optional: true,
        },
      },
    },
  },
  detailedStatus: {
    type: 'number',
    description: 'Oracle granular job status code, when returned.',
    optional: true,
  },
  waitOutcome: {
    type: 'string',
    description:
      'Sim local wait outcome: incomplete means waiting stopped before observing completion. The last Oracle snapshot is retained; inspect jobId or Job Status links before any resubmission. This is not an Oracle status or cancellation.',
    optional: true,
  },
  detail: {
    type: 'string',
    description: 'Supplemental deployment details when returned under singular detail',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>
