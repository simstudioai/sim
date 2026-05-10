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

const labelsQuerySchema = credentialIdQuerySchema.extend({
  query: optionalString,
  impersonateEmail: optionalString,
})

const gmailLabelQuerySchema = credentialIdQuerySchema.extend({
  labelId: z.string().min(1),
  impersonateEmail: optionalString,
})

const googleCalendarQuerySchema = credentialIdQuerySchema.extend({
  workflowId: optionalString,
  impersonateEmail: optionalString,
})

const googleDriveFilesQuerySchema = credentialIdQuerySchema.extend({
  mimeType: optionalString,
  folderId: optionalString,
  parentId: optionalString,
  query: optionalString,
  workflowId: optionalString,
  impersonateEmail: optionalString,
})

const googleDriveFileQuerySchema = credentialIdQuerySchema.extend({
  fileId: z.string().min(1, 'File ID is required'),
  workflowId: optionalString,
  impersonateEmail: optionalString,
})

const googleSheetsQuerySchema = credentialIdQuerySchema.extend({
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

type GmailLabelsSelectorQuery = ContractQueryInput<typeof gmailLabelsSelectorContract>
type GmailLabelSelectorQuery = ContractQueryInput<typeof gmailLabelSelectorContract>
type GoogleCalendarSelectorQuery = ContractQueryInput<typeof googleCalendarSelectorContract>
type GoogleTasksTaskListsSelectorBody = ContractBodyInput<
  typeof googleTasksTaskListsSelectorContract
>
type GoogleDriveFilesSelectorQuery = ContractQueryInput<typeof googleDriveFilesSelectorContract>
type GoogleDriveFileSelectorQuery = ContractQueryInput<typeof googleDriveFileSelectorContract>
type GoogleSheetsSelectorQuery = ContractQueryInput<typeof googleSheetsSelectorContract>

type GmailLabelsSelectorResponse = ContractJsonResponse<typeof gmailLabelsSelectorContract>
type GmailLabelSelectorResponse = ContractJsonResponse<typeof gmailLabelSelectorContract>
type GoogleCalendarSelectorResponse = ContractJsonResponse<typeof googleCalendarSelectorContract>
type GoogleTasksTaskListsSelectorResponse = ContractJsonResponse<
  typeof googleTasksTaskListsSelectorContract
>
type GoogleDriveFilesSelectorResponse = ContractJsonResponse<
  typeof googleDriveFilesSelectorContract
>
type GoogleDriveFileSelectorResponse = ContractJsonResponse<typeof googleDriveFileSelectorContract>
type GoogleSheetsSelectorResponse = ContractJsonResponse<typeof googleSheetsSelectorContract>
