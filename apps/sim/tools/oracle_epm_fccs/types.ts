import type { UserFile } from '@/executor/types'
import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

export const FCCS_JOB_OUTPUTS = {
  jobId: {
    type: 'string',
    description:
      'Oracle execution ID normalized from jobId or jobID; wire this to Get/Wait for Job',
  },
  status: {
    type: 'number',
    description:
      '-1 in progress, 0 success, 1 error, 2 cancel pending, 3 cancelled, 4 invalid parameter, greater values unknown',
  },
  details: {
    type: 'string',
    description: 'Documented job status details',
    optional: true,
    nullable: true,
  },
  jobName: { type: 'string', description: 'Oracle job name', optional: true },
  descriptiveStatus: { type: 'string', description: 'Oracle status label', optional: true },
  detailedStatus: {
    type: 'number',
    description: 'Oracle granular status code when provided',
    optional: true,
  },
} satisfies Record<string, ToolOutputProperty>

export interface FccsAuthParams {
  oauthCredential?: string
  accessToken?: string
  instanceUrl?: string
}

export interface FccsResponse extends ToolResponse {
  output: Record<string, unknown>
}

export interface FccsListApplicationsParams extends FccsAuthParams {}

export interface FccsListCubesParams extends FccsAuthParams {
  application: string
}

export interface FccsListDimensionsParams extends FccsAuthParams {
  application: string
  cube: string
  offset?: number
  limit?: number
  filter?: Record<string, unknown>
}

export interface FccsGetDimensionParams extends FccsAuthParams {
  application: string
  cube: string
  dimension: string
  aliasTableName?: string
}

export interface FccsGetMemberParams extends FccsAuthParams {
  application: string
  dimension: string
  member: string
}

export interface FccsAddMemberParams extends FccsAuthParams {
  application: string
  dimension: string
  member: string
  parentName: string
}

export interface FccsValidateMetadataParams extends FccsAuthParams {
  application: string
  logFileName?: string
}

export interface FccsListJobDefinitionsParams extends FccsAuthParams {
  application: string
  jobType?: string
}

export interface FccsExecuteJobParams extends FccsAuthParams {
  application: string
  jobType: string
  jobName: string
  parameters?: Record<string, unknown>
}

export interface FccsRunRuleParams extends FccsAuthParams {
  application: string
  rule: string
  parameters?: Record<string, unknown>
}

export interface FccsRunRulesetParams extends FccsAuthParams {
  application: string
  ruleset: string
  parameters?: Record<string, unknown>
}

export interface FccsRunConsolidationParams extends FccsAuthParams {
  application: string
  entity: string
  period: string
  scenario: string
  year: string
  force?: boolean
}

export interface FccsRunTranslationParams extends FccsAuthParams {
  application: string
  entity: string
  period: string
  scenario: string
  year: string
  force?: boolean
}

export interface FccsGetJobParams extends FccsAuthParams {
  application: string
  jobId: string
}

export interface FccsWaitForJobParams extends FccsAuthParams {
  application: string
  jobId: string
  maxWaitSeconds?: number
}

export interface FccsGetJobDetailsParams extends FccsAuthParams {
  application: string
  jobId: string
  detailJobType: string
  offset?: number
  limit?: number
  messageType?: string
}

export interface FccsGetChildJobDetailsParams extends FccsAuthParams {
  application: string
  jobId: string
  childJobId: string
  childJobType: string
  offset?: number
  limit?: number
  messageType?: string
}

export interface FccsExportJobConsoleParams extends FccsAuthParams {
  application: string
  jobName?: string
  parameters?: Record<string, unknown>
}

export interface FccsExportDataSliceParams extends FccsAuthParams {
  application: string
  cube: string
  gridDefinition: Record<string, unknown>
}

export interface FccsImportDataSliceParams extends FccsAuthParams {
  application: string
  cube: string
  dataGrid: Record<string, unknown>
  aggregateEssbaseData?: boolean
}

export interface FccsClearDataSliceParams extends FccsAuthParams {
  application: string
  cube: string
  gridDefinition: Record<string, unknown>
}

export interface FccsClearDataProfileParams extends FccsAuthParams {
  application: string
  profileName: string
}

export interface FccsCopyDataProfileParams extends FccsAuthParams {
  application: string
  profileName: string
}

export interface FccsExportApplicationDataParams extends FccsAuthParams {
  application: string
  jobName: string
  parameters?: Record<string, unknown>
}

export interface FccsImportApplicationDataParams extends FccsAuthParams {
  application: string
  jobName: string
  parameters?: Record<string, unknown>
}

export interface FccsImportExchangeRatesParams extends FccsAuthParams {
  application: string
  jobName: string
  parameters?: Record<string, unknown>
}

export interface FccsExportMetadataParams extends FccsAuthParams {
  application: string
  jobName: string
  parameters?: Record<string, unknown>
}

export interface FccsImportMetadataParams extends FccsAuthParams {
  application: string
  jobName: string
  parameters?: Record<string, unknown>
}

export interface FccsListJournalsParams extends FccsAuthParams {
  application: string
  scenario: string
  year: string
  period: string
  journalStatus: string
  consolidation?: string
  group?: string
  journalLabel?: string
  description?: string
  entity?: string
  offset?: number
  limit?: number
}

export interface FccsPerformJournalActionParams extends FccsAuthParams {
  application: string
  journalLabel: string
  scenario: string
  year: string
  period: string
  journalAction: string
  consolidation?: string
}

export interface FccsUpdateJournalPeriodParams extends FccsAuthParams {
  application: string
  scenario: string
  year: string
  period: string
  periodAction: string
}

export interface FccsExportJournalsParams extends FccsAuthParams {
  application: string
  fileName: string
}

export interface FccsImportJournalsParams extends FccsAuthParams {
  application: string
  jobName: string
  fileName?: string
  errorFileName?: string
}

export interface FccsGenerateIntercompanyReportParams extends FccsAuthParams {
  application: string
  jobName: string
  scenario?: string
  year?: string
  period?: string
  reportFormat?: string
  fileName?: string
}

export interface FccsExportConsolidationRulesetsParams extends FccsAuthParams {
  application: string
  rules: string[]
}

export interface FccsImportConsolidationRulesetsParams extends FccsAuthParams {
  application: string
  fileName: string
}

export interface FccsListFilesParams extends FccsAuthParams {}

export interface FccsUploadFileParams extends FccsAuthParams {
  file: UserFile
  fileName: string
  directory?: string
}

export interface FccsDownloadFileParams extends FccsAuthParams {
  fileName: string
}

export interface FccsDeleteFileParams extends FccsAuthParams {
  fileName: string
}
