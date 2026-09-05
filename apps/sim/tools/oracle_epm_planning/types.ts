import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface OracleEpmPlanningAuth {
  oauthCredential: string
  /** Injected from the selected reusable service-account credential, never model-authored. */
  accessToken?: string
  instanceUrl?: string
}

export interface PlanningGridAxis {
  dimensions?: string[]
  members: string[][]
}

export interface PlanningGridDefinition {
  pov: PlanningGridAxis
  columns: PlanningGridAxis[]
  rows: PlanningGridAxis[]
  suppressMissingBlocks?: boolean
  suppressMissingRows?: boolean
  suppressMissingColumns?: boolean
}

export interface PlanningDataGrid {
  pov: string[]
  columns: string[][]
  rows: { headers: string[]; data: (string | number)[] }[]
}

export interface PlanningSubstitutionVariable {
  name: string
  value: string
  planType: string
}

export interface PlanningApplication {
  name: string
  type?: string
  appType?: string
  appStorage?: string
  unicode?: boolean
  adminMode?: boolean
  hybrid?: boolean
}

export interface PlanningCube {
  planTypeName: string
  planType: number
  cubeName: string
  numDimensions: number
  cubeType: number
}

export interface PlanningDimension {
  name: string
  id?: string
  path?: string
  alias?: string
  parentName?: string
  dimName?: string
  dimType?: string
  level?: number
  generation?: number
  children?: PlanningDimension[]
}

export interface PlanningMember {
  name: string
  description: string | null
  parentName: string | null
  dimName: string
  dataType?: string
  dataStorage: string
  objectType: number
  twoPass: boolean
}

export interface PlanningJob {
  jobId: number
  status: number
  details: string | null
  jobName: string
  descriptiveStatus: string | null
  detailedStatus?: number
}

export interface PlanningJobDetail {
  recordsRead?: number
  recordsRejected?: number
  recordsProcessed?: number
  dimensionName?: string
  loadType?: string
}

export interface PlanningImportResult {
  numAcceptedCells: number
  numUpdateCells: number
  numRejectedCells: number
  rejectedCells: string[]
  rejectedCellsWithDetails: {
    memberNames: string[]
    readOnlyReasons: string[]
    otherReasons: string[]
  }[]
}

export interface PlanningClearResult {
  numClearedCells: number
  numRejectedCells: number
  rejectedCells: string[]
}

export interface PlanningFormData {
  gridInfo: {
    pageDimNames: string[]
    allowedPageMembersByDim: Record<string, string[]>
    rowDimNames: string[]
    columnDimNames: string[]
  }
  pov: Record<string, string>
  columns: string[][]
  rows: { headers: string[]; data: number[] }[]
}

export interface PlanningRepositoryFile {
  name: string
  type: 'LCM' | 'EXTERNAL'
  size: number | null
  lastModifiedTime: number | null
}

/** Runtime prompt/job parameter names are defined by the customer's deployed jobs. */
export type PlanningJobParameters = Record<string, string | number | boolean>

export interface OracleEpmPlanningInputs {
  application: string
  cube: string
  dimension: string
  memberName: string
  parentName: string
  aliasTableName: string
  variableName: string
  variables: PlanningSubstitutionVariable[]
  derivedValues: boolean
  jobType: string
  jobName: string
  parameters: PlanningJobParameters
  jobId: string
  maxWaitSeconds: number
  offset: number
  limit: number
  messageType: 'INFO' | 'WARNING' | 'ERROR'
  gridDefinition: PlanningGridDefinition
  dataGrid: PlanningDataGrid
  importOptions: {
    aggregateEssbaseData?: boolean
    cellNotesOption?: 'Overwrite' | 'Append' | 'Skip'
    dateFormat?: string
    strictDateValidation?: boolean
  }
  clearEssbaseData: boolean
  clearPlanningData: boolean
  form: string
  displayMemberAs: 'MEMBER_NAME' | 'MEMBER_NAME_THEN_ALIAS' | 'ALIAS_THEN_MEMBER_NAME'
  memberAliasDelimiter: string
  forceStartExpanded: boolean
  file: UserFile
  fileName: string
  loginLevel: 'Administrators' | 'All Users'
}

type PlanningParams<
  R extends keyof OracleEpmPlanningInputs,
  O extends keyof OracleEpmPlanningInputs,
> = OracleEpmPlanningAuth &
  Pick<OracleEpmPlanningInputs, R> &
  Partial<Pick<OracleEpmPlanningInputs, O>>

export type OracleEpmPlanningListApplicationsParams = PlanningParams<never, never>
export type OracleEpmPlanningListCubesParams = PlanningParams<'application', never>
export type OracleEpmPlanningListDimensionsParams = PlanningParams<
  'application' | 'cube',
  'offset' | 'limit'
>
export type OracleEpmPlanningGetDimensionParams = PlanningParams<
  'application' | 'cube' | 'dimension',
  'aliasTableName'
>
export type OracleEpmPlanningGetMemberParams = PlanningParams<
  'application' | 'dimension' | 'memberName',
  never
>
export type OracleEpmPlanningAddMemberParams = PlanningParams<
  'application' | 'dimension' | 'memberName' | 'parentName',
  never
>
export type OracleEpmPlanningListSubstitutionVariablesParams = PlanningParams<
  'application',
  'cube' | 'derivedValues'
>
export type OracleEpmPlanningGetSubstitutionVariableParams = PlanningParams<
  'application' | 'variableName',
  'cube' | 'derivedValues'
>
export type OracleEpmPlanningSetSubstitutionVariablesParams = PlanningParams<
  'application' | 'variables',
  never
>
export type OracleEpmPlanningDeleteSubstitutionVariableParams = PlanningParams<
  'application' | 'variableName',
  'cube'
>
export type OracleEpmPlanningListJobDefinitionsParams = PlanningParams<'application', 'jobType'>
export type OracleEpmPlanningRunJobParams = PlanningParams<
  'application' | 'jobType' | 'jobName',
  'parameters'
>
export type OracleEpmPlanningRunRuleParams = PlanningParams<'application' | 'jobName', 'parameters'>
export type OracleEpmPlanningRunRulesetParams = PlanningParams<
  'application' | 'jobName',
  'parameters'
>
export type OracleEpmPlanningGetJobParams = PlanningParams<'application' | 'jobId', never>
export type OracleEpmPlanningWaitForJobParams = PlanningParams<
  'application' | 'jobId',
  'maxWaitSeconds'
>
export type OracleEpmPlanningGetJobDetailsParams = PlanningParams<
  'application' | 'jobId',
  'offset' | 'limit' | 'messageType'
>
export type OracleEpmPlanningExportDataSliceParams = PlanningParams<
  'application' | 'cube' | 'gridDefinition',
  never
>
export type OracleEpmPlanningImportDataSliceParams = PlanningParams<
  'application' | 'cube' | 'dataGrid',
  'importOptions'
>
export type OracleEpmPlanningClearDataSliceParams = PlanningParams<
  'application' | 'cube' | 'gridDefinition',
  'clearEssbaseData' | 'clearPlanningData'
>
export type OracleEpmPlanningExportFormDataParams = PlanningParams<
  'application' | 'form',
  'displayMemberAs' | 'memberAliasDelimiter' | 'forceStartExpanded'
>
export type OracleEpmPlanningExportApplicationDataParams = PlanningParams<
  'application',
  'jobName' | 'cube' | 'parameters'
>
export type OracleEpmPlanningImportApplicationDataParams = PlanningParams<
  'application',
  'jobName' | 'cube' | 'fileName' | 'parameters'
>
export type OracleEpmPlanningListFilesParams = PlanningParams<never, never>
export type OracleEpmPlanningUploadFileParams = PlanningParams<
  'file',
  'fileName' | 'maxWaitSeconds'
>
export type OracleEpmPlanningDownloadFileParams = PlanningParams<'fileName', 'maxWaitSeconds'>
export type OracleEpmPlanningDeleteFileParams = PlanningParams<'fileName', never>
export type OracleEpmPlanningRefreshCubeParams = PlanningParams<
  'application' | 'jobName',
  'parameters'
>
export type OracleEpmPlanningSetAdministrationModeParams = PlanningParams<
  'application' | 'loginLevel',
  'jobName'
>

export interface OracleEpmPlanningOutput {
  applications?: PlanningApplication[]
  cubes?: PlanningCube[]
  dimensions?: PlanningDimension[]
  totalResults?: number
  hasMore?: boolean
  dimension?: PlanningDimension
  member?: PlanningMember
  variables?: PlanningSubstitutionVariable[]
  variable?: PlanningSubstitutionVariable
  updated?: boolean
  deleted?: boolean
  jobDefinitions?: { jobName: string; jobType: string }[]
  job?: PlanningJob
  jobDetails?: PlanningJobDetail[]
  dataGrid?: PlanningDataGrid
  importResult?: PlanningImportResult
  clearResult?: PlanningClearResult
  formData?: PlanningFormData
  files?: PlanningRepositoryFile[]
  upload?: { fileName: string; size: number; status: number }
  file?: UserFile
}

export interface OracleEpmPlanningResponse extends ToolResponse {
  output: OracleEpmPlanningOutput
}
