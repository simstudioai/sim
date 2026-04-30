import { z } from 'zod'
import {
  credentialIdQuerySchema,
  credentialWorkflowImpersonateBodySchema,
  defineGetSelector,
  definePostSelector,
  fileOptionSchema,
  folderOptionSchema,
  idNameSchema,
  idTitleSchema,
  optionalString,
} from '@/lib/api/contracts/selectors/shared'
import type {
  ContractBodyInput,
  ContractJsonResponse,
  ContractQueryInput,
} from '@/lib/api/contracts/types'

const googleCalendarSchema = z.object({ id: z.string(), summary: z.string() }).passthrough()
const gmailLabelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
    messagesTotal: z.number().optional(),
    messagesUnread: z.number().optional(),
  })
  .passthrough()

export const labelsQuerySchema = credentialIdQuerySchema.extend({
  query: optionalString,
  impersonateEmail: optionalString,
})

export const gmailLabelQuerySchema = credentialIdQuerySchema.extend({
  labelId: z.string().min(1),
  impersonateEmail: optionalString,
})

export const googleCalendarQuerySchema = credentialIdQuerySchema.extend({
  workflowId: optionalString,
  impersonateEmail: optionalString,
})

export const googleDriveFilesQuerySchema = credentialIdQuerySchema.extend({
  mimeType: optionalString,
  folderId: optionalString,
  parentId: optionalString,
  query: optionalString,
  workflowId: optionalString,
  impersonateEmail: optionalString,
})

export const googleDriveFileQuerySchema = credentialIdQuerySchema.extend({
  fileId: z.string().min(1, 'File ID is required'),
  workflowId: optionalString,
  impersonateEmail: optionalString,
})

export const googleSheetsQuerySchema = credentialIdQuerySchema.extend({
  spreadsheetId: z.string().min(1, 'Spreadsheet ID is required'),
  workflowId: optionalString,
  impersonateEmail: optionalString,
})

export const gmailLabelsSelectorContract = defineGetSelector(
  '/api/tools/gmail/labels',
  labelsQuerySchema,
  z.object({ labels: z.array(folderOptionSchema) })
)

export const gmailLabelSelectorContract = defineGetSelector(
  '/api/tools/gmail/label',
  gmailLabelQuerySchema,
  z.object({ label: gmailLabelSchema })
)

export const googleCalendarSelectorContract = defineGetSelector(
  '/api/tools/google_calendar/calendars',
  googleCalendarQuerySchema,
  z.object({ calendars: z.array(googleCalendarSchema) })
)

export const googleTasksTaskListsSelectorContract = definePostSelector(
  '/api/tools/google_tasks/task-lists',
  credentialWorkflowImpersonateBodySchema,
  z.object({ taskLists: z.array(idTitleSchema) })
)

export const googleDriveFilesSelectorContract = defineGetSelector(
  '/api/tools/drive/files',
  googleDriveFilesQuerySchema,
  z.object({ files: z.array(fileOptionSchema) })
)

export const googleDriveFileSelectorContract = defineGetSelector(
  '/api/tools/drive/file',
  googleDriveFileQuerySchema,
  z.object({ file: fileOptionSchema.optional() }).passthrough()
)

export const googleSheetsSelectorContract = defineGetSelector(
  '/api/tools/google_sheets/sheets',
  googleSheetsQuerySchema,
  z.object({ sheets: z.array(idNameSchema) })
)

export type GmailLabelsSelectorQuery = ContractQueryInput<typeof gmailLabelsSelectorContract>
export type GmailLabelSelectorQuery = ContractQueryInput<typeof gmailLabelSelectorContract>
export type GoogleCalendarSelectorQuery = ContractQueryInput<typeof googleCalendarSelectorContract>
export type GoogleTasksTaskListsSelectorBody = ContractBodyInput<
  typeof googleTasksTaskListsSelectorContract
>
export type GoogleDriveFilesSelectorQuery = ContractQueryInput<
  typeof googleDriveFilesSelectorContract
>
export type GoogleDriveFileSelectorQuery = ContractQueryInput<
  typeof googleDriveFileSelectorContract
>
export type GoogleSheetsSelectorQuery = ContractQueryInput<typeof googleSheetsSelectorContract>

export type GmailLabelsSelectorResponse = ContractJsonResponse<typeof gmailLabelsSelectorContract>
export type GmailLabelSelectorResponse = ContractJsonResponse<typeof gmailLabelSelectorContract>
export type GoogleCalendarSelectorResponse = ContractJsonResponse<
  typeof googleCalendarSelectorContract
>
export type GoogleTasksTaskListsSelectorResponse = ContractJsonResponse<
  typeof googleTasksTaskListsSelectorContract
>
export type GoogleDriveFilesSelectorResponse = ContractJsonResponse<
  typeof googleDriveFilesSelectorContract
>
export type GoogleDriveFileSelectorResponse = ContractJsonResponse<
  typeof googleDriveFileSelectorContract
>
export type GoogleSheetsSelectorResponse = ContractJsonResponse<typeof googleSheetsSelectorContract>
