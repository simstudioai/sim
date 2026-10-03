import type { UserFile } from '@/executor/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

/** Credential values are injected by the existing service-account execution pipeline. */
export interface OracleEpmAccountReconciliationAuthParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}

export interface OracleEpmAccountReconciliationAddUsersToTeamParams
  extends OracleEpmAccountReconciliationAuthParams {
  fileName: string
  teamName: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationArchiveMatchedTransactionsParams
  extends OracleEpmAccountReconciliationAuthParams {
  matchTypeId: string
  age: number
  filterOperator?:
    | 'EQUALS'
    | 'NOT_EQUALS'
    | 'STARTS_WITH'
    | 'ENDS_WITH'
    | 'CONTAINS'
    | 'NOT_CONTAINS'
  filterValue?: string[]
  logFileName?: string
  fileName?: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationCreateReconciliationsParams
  extends OracleEpmAccountReconciliationAuthParams {
  period: string
  filter?: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationDeleteFileParams
  extends OracleEpmAccountReconciliationAuthParams {
  fileName: string
}

export interface OracleEpmAccountReconciliationDeleteProfileParams
  extends OracleEpmAccountReconciliationAuthParams {
  accountId: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationDownloadCommentAttachmentParams
  extends OracleEpmAccountReconciliationAuthParams {
  period: string
  accountId: string
  referenceId: string
}

export interface OracleEpmAccountReconciliationDownloadFileParams
  extends OracleEpmAccountReconciliationAuthParams {
  fileName: string
}

export interface OracleEpmAccountReconciliationExportUserDetailsReportParams
  extends OracleEpmAccountReconciliationAuthParams {
  fileName: string
  format?: 'CSV' | 'XLS'
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationGetComplianceJobStatusParams
  extends OracleEpmAccountReconciliationAuthParams {
  jobId: string
}

export interface OracleEpmAccountReconciliationGetMatchingJobStatusParams
  extends OracleEpmAccountReconciliationAuthParams {
  jobId: string
}

export interface OracleEpmAccountReconciliationImportBalancesParams
  extends OracleEpmAccountReconciliationAuthParams {
  period: string
  dataLoadDefinition: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationImportComplianceTransactionsParams
  extends OracleEpmAccountReconciliationAuthParams {
  fileName: string
  period: string
  transactionType: 'BEX' | 'SRC' | 'SUB' | 'VEX'
  dateFormat: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationImportMatchingTransactionsParams
  extends OracleEpmAccountReconciliationAuthParams {
  fileName: string
  matchTypeId: string
  dataSource: string
  dateFormat: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationImportPremappedBalancesParams
  extends OracleEpmAccountReconciliationAuthParams {
  fileName: string
  period: string
  balanceType: 'SRC' | 'SUB'
  currencyBucket: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationImportProfilesParams
  extends OracleEpmAccountReconciliationAuthParams {
  fileName: string
  importType: 'Replace' | 'Update'
  profileType: 'Profiles' | 'Children'
  dateFormat: string
  period?: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationImportRatesParams
  extends OracleEpmAccountReconciliationAuthParams {
  fileName: string
  period: string
  rateType: string
  importType: 'Replace' | 'ReplaceAll'
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationImportReconciliationAttributesParams
  extends OracleEpmAccountReconciliationAuthParams {
  fileName: string
  period: string
  rules?: string
  reopen?: boolean
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationListFilesParams
  extends OracleEpmAccountReconciliationAuthParams {}

export interface OracleEpmAccountReconciliationListPeriodsParams
  extends OracleEpmAccountReconciliationAuthParams {
  status?: 'ALL' | 'OPEN' | 'CLOSED' | 'LOCKED' | 'PENDING' | 'OPEN_PENDING'
}

export interface OracleEpmAccountReconciliationListReconciliationCommentsParams
  extends OracleEpmAccountReconciliationAuthParams {
  period: string
  accountId: string
}

export interface OracleEpmAccountReconciliationListUsersParams
  extends OracleEpmAccountReconciliationAuthParams {
  userlogin?: string
  userattribute?: string
  epmgroups?: boolean
  idcsgroups?: boolean
  applicationroles?: boolean
  granularroles?: boolean
  indirect?: boolean
}

export interface OracleEpmAccountReconciliationMonitorReconciliationsParams
  extends OracleEpmAccountReconciliationAuthParams {
  periodName: string
  filterName: string
}

export interface OracleEpmAccountReconciliationPurgeArchivedTransactionsParams
  extends OracleEpmAccountReconciliationAuthParams {
  jobId: string
  logFileName?: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationPurgeMatchedTransactionsParams
  extends OracleEpmAccountReconciliationAuthParams {
  matchTypeId: string
  age: number
  filterOperator?:
    | 'EQUALS'
    | 'NOT_EQUALS'
    | 'STARTS_WITH'
    | 'ENDS_WITH'
    | 'CONTAINS'
    | 'NOT_CONTAINS'
  filterValue?: string[]
  logFileName?: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationRemoveUsersFromTeamParams
  extends OracleEpmAccountReconciliationAuthParams {
  fileName: string
  teamName: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationRunAutoAlertParams
  extends OracleEpmAccountReconciliationAuthParams {
  matchTypeId: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationRunAutoMatchParams
  extends OracleEpmAccountReconciliationAuthParams {
  matchTypeId: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationRunProfileRulesParams
  extends OracleEpmAccountReconciliationAuthParams {
  period: string
  filter?: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationRunReconciliationRulesParams
  extends OracleEpmAccountReconciliationAuthParams {
  period: string
  filter?: string
  ruleTypes?: string
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationSetPeriodStatusParams
  extends OracleEpmAccountReconciliationAuthParams {
  period: string
  status: 'pending' | 'open' | 'closed' | 'locked'
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationUnmatchAutoMatchJobParams
  extends OracleEpmAccountReconciliationAuthParams {
  autoMatchJobId: number
  createReverseAdjustment: boolean
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationUnmatchTransactionsParams
  extends OracleEpmAccountReconciliationAuthParams {
  matchTypeId: string
  matchIds: number[]
  forceReopen?: boolean
  waitForCompletion?: boolean
  maxWaitSeconds?: number
}

export interface OracleEpmAccountReconciliationUploadFileParams
  extends OracleEpmAccountReconciliationAuthParams {
  file: UserFile
  fileName?: string
  extDirPath?: string
}

export interface OracleEpmAccountReconciliationPeriod {
  Id: string
  Name: string
  Status: string
}

export interface OracleEpmAccountReconciliationRepositoryFile {
  name: string
  type: 'EXTERNAL' | 'LCM'
  size: string | null
  lastmodifiedtime: string | null
}

export interface OracleEpmAccountReconciliationReference {
  referenceId: number
  type: 'FILE' | 'URL'
  name: string
  url: string | null
}

export interface OracleEpmAccountReconciliationComment {
  commentId: number
  parentObjectId: number
  commentText: string
  postedBy: string
  postedDate: string
  references: OracleEpmAccountReconciliationReference[]
}

export interface OracleEpmAccountReconciliationGroup {
  groupname: string
  description: string
  type: string
}

export interface OracleEpmAccountReconciliationRole {
  rolename: string
  id: string
}

export interface OracleEpmAccountReconciliationUser {
  userlogin: string
  firstname: string
  lastname: string
  email: string
  epmgroups?: OracleEpmAccountReconciliationGroup[]
  idcsgroups?: OracleEpmAccountReconciliationGroup[]
  applicationroles?: OracleEpmAccountReconciliationRole[]
  granularroles?: OracleEpmAccountReconciliationRole[]
}

export interface OracleEpmAccountReconciliationJobOutput {
  status: number
  details: string | null
  state: 'pending' | 'succeeded' | 'failed'
  jobId?: string
  accepted?: boolean
  logFileName?: string
  archiveFileName?: string
  periodStatus?: 'pending' | 'open' | 'closed' | 'locked'
}

export interface OracleEpmAccountReconciliationResponse extends ToolResponse {
  output: {
    status?: number
    details?: string | null
    state?: 'pending' | 'succeeded' | 'failed'
    jobId?: string
    accepted?: boolean
    logFileName?: string
    archiveFileName?: string
    periodStatus?: 'pending' | 'open' | 'closed' | 'locked'
    periods?: OracleEpmAccountReconciliationPeriod[]
    files?: OracleEpmAccountReconciliationRepositoryFile[]
    comments?: OracleEpmAccountReconciliationComment[]
    users?: OracleEpmAccountReconciliationUser[]
    allClosed?: boolean
    fileName?: string
    file?: UserFile
  }
}

export const ARCS_JOB_STATUS_OUTPUTS = {
  status: {
    type: 'number',
    description: 'Oracle operation status: -1 in progress, 0 success, positive failure',
  },
  details: {
    type: 'string',
    description: 'Documented provider details; counts remain provider text',
    nullable: true,
  },
  state: {
    type: 'string',
    description: 'Normalized job state: pending, succeeded, or failed',
  },
  jobId: {
    type: 'string',
    description: 'Job ID extracted from a validated provider status link',
    optional: true,
  },
} satisfies ToolConfig['outputs']

export const ARCS_JOB_OUTPUTS = {
  ...ARCS_JOB_STATUS_OUTPUTS,
  accepted: {
    type: 'boolean',
    description: 'Whether Oracle accepted the launch; preserved if later work fails',
    optional: true,
  },
} satisfies ToolConfig['outputs']

export const ARCS_MATCHING_STATUS_OUTPUTS = {
  ...ARCS_JOB_STATUS_OUTPUTS,
  logFileName: {
    type: 'string',
    description: 'Repository log filename extracted from a validated log-content link',
    optional: true,
  },
  archiveFileName: {
    type: 'string',
    description: 'Repository archive filename extracted from a validated file-content link',
    optional: true,
  },
} satisfies ToolConfig['outputs']

export const ARCS_MATCHING_LOG_OUTPUTS = {
  ...ARCS_JOB_OUTPUTS,
  logFileName: {
    type: 'string',
    description: 'Repository log filename extracted from a validated log-content link',
    optional: true,
  },
} satisfies ToolConfig['outputs']

export const ARCS_MATCHING_OUTPUTS = {
  ...ARCS_MATCHING_LOG_OUTPUTS,
  archiveFileName: {
    type: 'string',
    description: 'Repository archive filename extracted from a validated file-content link',
    optional: true,
  },
} satisfies ToolConfig['outputs']

export const ARCS_PERIOD_JOB_OUTPUTS = {
  status: {
    type: 'number',
    description: 'Oracle operation status: -1 in progress, 0 success, positive failure',
  },
  details: {
    type: 'string',
    description: 'Documented provider details; counts remain provider text',
    nullable: true,
  },
  state: {
    type: 'string',
    description: 'Normalized job state: pending, succeeded, or failed',
  },
  jobId: {
    type: 'string',
    description: 'Job ID extracted from a validated provider status link',
    optional: true,
  },
  accepted: {
    type: 'boolean',
    description: 'Whether Oracle accepted the launch; preserved if later work fails',
    optional: true,
  },
  periodStatus: {
    type: 'string',
    description: 'Period status applied immediately, independently of the opening job',
    optional: true,
  },
} satisfies ToolConfig['outputs']

export const ARCS_PERIODS_OUTPUTS = {
  status: {
    type: 'number',
    description: 'Oracle operation status: -1 in progress, 0 success, positive failure',
  },
  details: {
    type: 'string',
    description: 'Documented provider details; counts remain provider text',
    nullable: true,
  },
  periods: {
    type: 'array',
    description: 'Periods matching the status filter',
    items: {
      type: 'object',
      properties: {
        Id: {
          type: 'string',
          description: 'Internal period ID',
        },
        Name: {
          type: 'string',
          description: 'Period name used by reconciliation operations',
        },
        Status: {
          type: 'string',
          description: '51 pending, 52 open, 53 closed, or 54 locked',
        },
      },
    },
  },
} satisfies ToolConfig['outputs']

export const ARCS_FILES_OUTPUTS = {
  status: {
    type: 'number',
    description: 'Oracle operation status: -1 in progress, 0 success, positive failure',
  },
  details: {
    type: 'string',
    description: 'Documented provider details; counts remain provider text',
    nullable: true,
  },
  files: {
    type: 'array',
    description: 'Repository files and snapshots',
    items: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Exact repository filename',
        },
        type: {
          type: 'string',
          description: 'EXTERNAL or LCM',
        },
        size: {
          type: 'string',
          description: 'File size in bytes',
          nullable: true,
        },
        lastmodifiedtime: {
          type: 'string',
          description: 'Last-modified timestamp as returned by Oracle',
          nullable: true,
        },
      },
    },
  },
} satisfies ToolConfig['outputs']

export const ARCS_USERS_OUTPUTS = {
  status: {
    type: 'number',
    description: 'Oracle operation status: -1 in progress, 0 success, positive failure',
  },
  users: {
    type: 'array',
    description: 'Environment users with requested memberships',
    items: {
      type: 'object',
      properties: {
        userlogin: {
          type: 'string',
          description: 'User login',
        },
        firstname: {
          type: 'string',
          description: 'First name',
        },
        lastname: {
          type: 'string',
          description: 'Last name',
        },
        email: {
          type: 'string',
          description: 'Email address',
        },
        epmgroups: {
          type: 'array',
          description: 'Group memberships',
          items: {
            type: 'object',
            properties: {
              groupname: {
                type: 'string',
                description: 'Group name',
              },
              description: {
                type: 'string',
                description: 'Group description',
              },
              type: {
                type: 'string',
                description: 'Group type',
              },
            },
          },
          optional: true,
        },
        idcsgroups: {
          type: 'array',
          description: 'Group memberships',
          items: {
            type: 'object',
            properties: {
              groupname: {
                type: 'string',
                description: 'Group name',
              },
              description: {
                type: 'string',
                description: 'Group description',
              },
              type: {
                type: 'string',
                description: 'Group type',
              },
            },
          },
          optional: true,
        },
        applicationroles: {
          type: 'array',
          description: 'Role assignments',
          items: {
            type: 'object',
            properties: {
              rolename: {
                type: 'string',
                description: 'Role name',
              },
              id: {
                type: 'string',
                description: 'Role ID',
              },
            },
          },
          optional: true,
        },
        granularroles: {
          type: 'array',
          description: 'Role assignments',
          items: {
            type: 'object',
            properties: {
              rolename: {
                type: 'string',
                description: 'Role name',
              },
              id: {
                type: 'string',
                description: 'Role ID',
              },
            },
          },
          optional: true,
        },
      },
    },
  },
} satisfies ToolConfig['outputs']

export const ARCS_COMMENTS_OUTPUTS = {
  comments: {
    type: 'array',
    description: 'Reconciliation comments and attachment references',
    items: {
      type: 'object',
      properties: {
        commentId: {
          type: 'number',
          description: 'Comment ID',
        },
        parentObjectId: {
          type: 'number',
          description: 'Parent reconciliation object ID',
        },
        commentText: {
          type: 'string',
          description: 'Comment text',
        },
        postedBy: {
          type: 'string',
          description: 'Posting user',
        },
        postedDate: {
          type: 'string',
          description: 'Posting date as returned by Oracle',
        },
        references: {
          type: 'array',
          description: 'File and URL references',
          items: {
            type: 'object',
            properties: {
              referenceId: {
                type: 'number',
                description: 'Reference ID used by Download Comment Attachment',
              },
              type: {
                type: 'string',
                description: 'FILE or URL',
              },
              name: {
                type: 'string',
                description: 'Reference name',
              },
              url: {
                type: 'string',
                description: 'URL reference target; null for FILE references',
                nullable: true,
              },
            },
          },
        },
      },
    },
  },
} satisfies ToolConfig['outputs']

export const ARCS_MONITOR_OUTPUTS = {
  status: {
    type: 'number',
    description:
      'Monitor status: -1 some reconciliations remain open, 0 all closed, positive failure',
  },
  details: {
    type: 'string',
    description: 'Documented provider details; counts remain provider text',
    nullable: true,
  },
  allClosed: {
    type: 'boolean',
    description:
      'True only when all filtered reconciliations are closed; -1 means some remain open',
  },
} satisfies ToolConfig['outputs']

export const ARCS_UPLOAD_OUTPUTS = {
  status: {
    type: 'number',
    description: 'Oracle operation status: -1 in progress, 0 success, positive failure',
  },
  details: {
    type: 'string',
    description: 'Documented provider details; counts remain provider text',
    nullable: true,
  },
  state: {
    type: 'string',
    description: 'Normalized job state: pending, succeeded, or failed',
  },
  fileName: {
    type: 'string',
    description: 'Exact staged repository filename to pass to import tools',
  },
} satisfies ToolConfig['outputs']

export const ARCS_DELETE_OUTPUTS = {
  status: {
    type: 'number',
    description: 'Oracle operation status: -1 in progress, 0 success, positive failure',
  },
  details: {
    type: 'string',
    description: 'Documented provider details; counts remain provider text',
    nullable: true,
  },
  fileName: {
    type: 'string',
    description: 'Deleted repository filename',
  },
} satisfies ToolConfig['outputs']

export const ARCS_REPORT_OUTPUTS = {
  status: {
    type: 'number',
    description: 'Oracle operation status: -1 in progress, 0 success, positive failure',
  },
  details: {
    type: 'string',
    description: 'Documented provider details; counts remain provider text',
    nullable: true,
  },
  state: {
    type: 'string',
    description: 'Normalized job state: pending, succeeded, or failed',
  },
  jobId: {
    type: 'string',
    description: 'Job ID extracted from a validated provider status link',
    optional: true,
  },
  accepted: {
    type: 'boolean',
    description: 'Whether Oracle accepted the launch; preserved if later work fails',
    optional: true,
  },
  fileName: {
    type: 'string',
    description: 'Requested report filename',
  },
  file: {
    type: 'file',
    description: 'Downloaded file stored in this Sim execution',
  },
} satisfies ToolConfig['outputs']

export const ARCS_DOWNLOAD_OUTPUTS = {
  file: {
    type: 'file',
    description: 'Downloaded file stored in this Sim execution',
  },
} satisfies ToolConfig['outputs']
