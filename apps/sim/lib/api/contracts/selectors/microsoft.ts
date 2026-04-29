import { z } from 'zod'
import {
  credentialIdQuerySchema,
  credentialIdQueryWithSearchSchema,
  credentialWorkflowBodySchema,
  defineGetSelector,
  definePostSelector,
  fileOptionSchema,
  idDisplayNameSchema,
  idNameSchema,
  idTitleSchema,
  optionalString,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractBody, ContractJsonResponse, ContractQuery } from '@/lib/api/contracts/types'

export const teamsChannelsBodySchema = credentialWorkflowBodySchema.extend({
  teamId: z.string().min(1),
})

export const plannerTasksBodySchema = credentialWorkflowBodySchema.extend({
  planId: z.string().min(1),
})

export const microsoftExcelSheetsQuerySchema = credentialIdQuerySchema.extend({
  spreadsheetId: z.string().min(1, 'Spreadsheet ID is required'),
  driveId: optionalString,
  workflowId: optionalString,
})

/**
 * Body for `POST /api/tools/microsoft_excel/drives`. The route serves both
 * list-drives (no `driveId`) and single-drive lookup (`driveId` provided),
 * dispatching at runtime. The contract permits the optional `driveId` so a
 * single body schema covers both flows.
 */
export const microsoftExcelDrivesBodySchema = credentialWorkflowBodySchema.extend({
  siteId: z.string().min(1, 'Site ID is required'),
  driveId: optionalString,
})

export const microsoftFilesQuerySchema = credentialIdQuerySchema.extend({
  query: optionalString,
  driveId: optionalString,
  workflowId: optionalString,
})

export const microsoftFileQuerySchema = credentialIdQuerySchema.extend({
  fileId: z.string({ error: 'File ID is required' }).min(1, 'File ID is required'),
  workflowId: optionalString,
})

export const onedriveFolderQuerySchema = z.object({
  credentialId: z.preprocess(
    (value) => value ?? '',
    z.string().min(1, 'Credential ID and File ID are required')
  ),
  fileId: z.preprocess(
    (value) => value ?? '',
    z.string().min(1, 'Credential ID and File ID are required')
  ),
})

export const onedriveFilesQuerySchema = credentialIdQueryWithSearchSchema
export const onedriveFoldersQuerySchema = credentialIdQueryWithSearchSchema
export const outlookFoldersQuerySchema = credentialIdQuerySchema

export const outlookFoldersSelectorContract = defineGetSelector(
  '/api/tools/outlook/folders',
  outlookFoldersQuerySchema,
  z.object({ folders: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()) })
)

export const microsoftTeamsSelectorContract = definePostSelector(
  '/api/tools/microsoft-teams/teams',
  credentialWorkflowBodySchema,
  z.object({ teams: z.array(idDisplayNameSchema) })
)

export const microsoftChatsSelectorContract = definePostSelector(
  '/api/tools/microsoft-teams/chats',
  credentialWorkflowBodySchema,
  z.object({ chats: z.array(idDisplayNameSchema) })
)

export const microsoftChannelsSelectorContract = definePostSelector(
  '/api/tools/microsoft-teams/channels',
  teamsChannelsBodySchema,
  z.object({ channels: z.array(idDisplayNameSchema) })
)

export const microsoftPlannerPlansSelectorContract = definePostSelector(
  '/api/tools/microsoft_planner/plans',
  credentialWorkflowBodySchema,
  z.object({ plans: z.array(idTitleSchema) })
)

export const microsoftPlannerTasksSelectorContract = definePostSelector(
  '/api/tools/microsoft_planner/tasks',
  plannerTasksBodySchema,
  z
    .object({
      tasks: z.array(idTitleSchema),
      metadata: z
        .object({
          planId: z.string(),
          planUrl: z.string(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
)

export const onedriveFilesSelectorContract = defineGetSelector(
  '/api/tools/onedrive/files',
  onedriveFilesQuerySchema,
  z.object({ files: z.array(fileOptionSchema) })
)

export const onedriveFoldersSelectorContract = defineGetSelector(
  '/api/tools/onedrive/folders',
  onedriveFoldersQuerySchema,
  z.object({ files: z.array(fileOptionSchema) })
)

export const onedriveFolderSelectorContract = defineGetSelector(
  '/api/tools/onedrive/folder',
  onedriveFolderQuerySchema,
  z.object({ file: fileOptionSchema.optional() }).passthrough()
)

export const microsoftExcelSheetsSelectorContract = defineGetSelector(
  '/api/tools/microsoft_excel/sheets',
  microsoftExcelSheetsQuerySchema,
  z.object({ sheets: z.array(idNameSchema) })
)

export const microsoftExcelDrivesSelectorContract = definePostSelector(
  '/api/tools/microsoft_excel/drives',
  microsoftExcelDrivesBodySchema,
  z.object({ drives: z.array(idNameSchema) })
)

/**
 * Single-drive variant. Same body schema as the list contract; the `driveId`
 * is what discriminates the response shape at the route layer.
 */
export const microsoftExcelDriveSelectorContract = definePostSelector(
  '/api/tools/microsoft_excel/drives',
  microsoftExcelDrivesBodySchema,
  z.object({ drive: idNameSchema.optional() })
)

export const microsoftFilesSelectorContract = defineGetSelector(
  '/api/auth/oauth/microsoft/files',
  microsoftFilesQuerySchema,
  z.object({ files: z.array(fileOptionSchema) })
)

export const microsoftFileSelectorContract = defineGetSelector(
  '/api/auth/oauth/microsoft/file',
  microsoftFileQuerySchema,
  z.object({ file: fileOptionSchema.optional() }).passthrough()
)

export type OutlookFoldersSelectorResponse = ContractJsonResponse<
  typeof outlookFoldersSelectorContract
>
export type OutlookFoldersSelectorQuery = ContractQuery<typeof outlookFoldersSelectorContract>
export type MicrosoftTeamsSelectorResponse = ContractJsonResponse<
  typeof microsoftTeamsSelectorContract
>
export type MicrosoftTeamsSelectorBody = ContractBody<typeof microsoftTeamsSelectorContract>
export type MicrosoftChatsSelectorResponse = ContractJsonResponse<
  typeof microsoftChatsSelectorContract
>
export type MicrosoftChatsSelectorBody = ContractBody<typeof microsoftChatsSelectorContract>
export type MicrosoftChannelsSelectorResponse = ContractJsonResponse<
  typeof microsoftChannelsSelectorContract
>
export type MicrosoftChannelsSelectorBody = ContractBody<typeof microsoftChannelsSelectorContract>
export type MicrosoftPlannerPlansSelectorResponse = ContractJsonResponse<
  typeof microsoftPlannerPlansSelectorContract
>
export type MicrosoftPlannerPlansSelectorBody = ContractBody<
  typeof microsoftPlannerPlansSelectorContract
>
export type MicrosoftPlannerTasksSelectorResponse = ContractJsonResponse<
  typeof microsoftPlannerTasksSelectorContract
>
export type MicrosoftPlannerTasksSelectorBody = ContractBody<
  typeof microsoftPlannerTasksSelectorContract
>
export type OnedriveFilesSelectorResponse = ContractJsonResponse<
  typeof onedriveFilesSelectorContract
>
export type OnedriveFilesSelectorQuery = ContractQuery<typeof onedriveFilesSelectorContract>
export type OnedriveFoldersSelectorResponse = ContractJsonResponse<
  typeof onedriveFoldersSelectorContract
>
export type OnedriveFoldersSelectorQuery = ContractQuery<typeof onedriveFoldersSelectorContract>
export type OnedriveFolderSelectorResponse = ContractJsonResponse<
  typeof onedriveFolderSelectorContract
>
export type OnedriveFolderSelectorQuery = ContractQuery<typeof onedriveFolderSelectorContract>
export type MicrosoftExcelSheetsSelectorResponse = ContractJsonResponse<
  typeof microsoftExcelSheetsSelectorContract
>
export type MicrosoftExcelSheetsSelectorQuery = ContractQuery<
  typeof microsoftExcelSheetsSelectorContract
>
export type MicrosoftExcelDrivesSelectorResponse = ContractJsonResponse<
  typeof microsoftExcelDrivesSelectorContract
>
export type MicrosoftExcelDrivesSelectorBody = ContractBody<
  typeof microsoftExcelDrivesSelectorContract
>
export type MicrosoftExcelDriveSelectorResponse = ContractJsonResponse<
  typeof microsoftExcelDriveSelectorContract
>
export type MicrosoftExcelDriveSelectorBody = ContractBody<
  typeof microsoftExcelDriveSelectorContract
>
export type MicrosoftFilesSelectorResponse = ContractJsonResponse<
  typeof microsoftFilesSelectorContract
>
export type MicrosoftFilesSelectorQuery = ContractQuery<typeof microsoftFilesSelectorContract>
export type MicrosoftFileSelectorResponse = ContractJsonResponse<
  typeof microsoftFileSelectorContract
>
export type MicrosoftFileSelectorQuery = ContractQuery<typeof microsoftFileSelectorContract>
