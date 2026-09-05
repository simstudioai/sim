import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

/** Browser-safe types for the documented projections, not raw Oracle envelopes. */
export interface NarrativeArtifact {
  artifactId: string
  name: string
  description: string | null
  type: string | null
  typeID: string | null
  typeLabel: string | null
  pathName: string | null
  systemPath: string | null
  mimeType: string | null
  modifiedBy: string | null
  favorite: boolean | null
  ordinal: number | null
  createdBy: string | null
  creationDate: string | null
  modifiedDate: string | null
  lastAccessed: string | null
}

export interface NarrativeMember {
  memberId: string | null
  name: string | null
  alias: string | null
}

export interface NarrativePov {
  dimensionId: string | null
  name: string | null
  hidden: boolean | null
  fixedSelection: boolean | null
  suggestedMembers: Array<{ memberId: string | null; name: string | null; alias: string | null }>
}

export interface NarrativePrompt {
  promptId: string | null
  label: string | null
  dimensionName: string | null
  sourceElement: string | null
  sourceType: string | null
  allowMultipleSelections: boolean | null
  suggestedMembers: Array<{ memberId: string | null; name: string | null; alias: string | null }>
  defaultSelection: Array<{ memberId: string | null; name: string | null; alias: string | null }>
}

export interface NarrativeReport {
  reportId: string
  name: string
  description: string | null
  instanceType: string | null
  datasourceNames: Array<string>
  validationMessages: Array<string>
  invalidFields: Array<string>
  createdBy: string | null
  creationDate: string | null
  modifiedDate: string | null
  lastAccessed: string | null
}

export interface NarrativeBook {
  bookId: string
  name: string
  description: string | null
  pathName: string | null
  systemPath: string | null
  primaryDatasource: string | null
  datasourceNames: Array<string>
  validationMessages: Array<string>
  createdBy: string | null
  creationDate: string | null
  modifiedDate: string | null
  lastAccessed: string | null
}

export interface NarrativeReportPackage {
  reportPackageId: string
  name: string
  description: string | null
  libraryPath: string | null
  reportPackageType: string | null
  createdBy: string | null
  creationDate: string | null
  modifiedBy: string | null
  modifiedDate: string | null
}

export interface NarrativeJob {
  jobId: string
  status: number
  descriptiveStatus: string | null
  details: string | null
  jobName: string | null
  jobType: string | null
}

export interface NarrativeToolParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  folderId?: string
  limit?: number
  offset?: number
  q?: string
  orderBy?: string
  resourceId?: string
  name?: string
  description?: string
  systemPath?: string
  providerFile?: string
  mimeType?: string
  overwrite?: boolean | 'true' | 'false'
  fileName?: string
  format?: string
  globalPov?: string
  prompts?: string
  maxWaitSeconds?: number
  reportId?: string
  reportName?: string
  libraryLocation?: string
  snapShotName?: string
  reportPackageName?: string
  refreshableSources?: string[]
  artifactName?: string
  artifactType?: string
  exportLocation?: string
  exportFormat?: string
  exportLibraryFolder?: string
  saveAsFile?: string
  applicationName?: string
  errorFile?: string
  importFile?: string
  importLocation?: string
  importFormat?: string
  importFolder?: string
  deleteAfterImport?: boolean
  importPermissions?: boolean
}
export interface NarrativeResponse extends ToolResponse {
  output: {
    artifact?: NarrativeArtifact
    artifacts?: NarrativeArtifact[]
    report?: NarrativeReport
    reports?: NarrativeReport[]
    snapshot?: NarrativeReport
    snapshots?: NarrativeReport[]
    book?: NarrativeBook
    books?: NarrativeBook[]
    reportPackage?: NarrativeReportPackage
    dimensions?: NarrativePov[]
    prompts?: NarrativePrompt[]
    job?: NarrativeJob | null
    jobId?: string
    file?: UserFile
    deleted?: boolean
    artifactId?: string
    completed?: boolean
    timedOut?: boolean
    attempts?: number
    offset?: number
    limit?: number
    count?: number
    totalResults?: number
    hasMore?: boolean
  }
}
