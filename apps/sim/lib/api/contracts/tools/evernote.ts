import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const evernoteSuccessOutputSchema = <T extends z.ZodType>(output: T) =>
  z.object({
    success: z.literal(true),
    output,
  })

const evernoteNoteResponseSchema = evernoteSuccessOutputSchema(z.object({ note: z.unknown() }))
const evernoteNotebookResponseSchema = evernoteSuccessOutputSchema(
  z.object({ notebook: z.unknown() })
)
const evernoteTagResponseSchema = evernoteSuccessOutputSchema(z.object({ tag: z.unknown() }))
const evernoteListNotebooksResponseSchema = evernoteSuccessOutputSchema(
  z.object({ notebooks: z.array(z.unknown()) })
)
const evernoteListTagsResponseSchema = evernoteSuccessOutputSchema(
  z.object({ tags: z.array(z.unknown()) })
)
const evernoteSearchNotesResponseSchema = evernoteSuccessOutputSchema(
  z.object({
    totalNotes: z.number(),
    notes: z.array(z.unknown()),
  })
)
const evernoteDeleteNoteResponseSchema = evernoteSuccessOutputSchema(
  z.object({
    success: z.literal(true),
    noteGuid: z.string(),
  })
)

const CREATE_NOTE_REQUIRED = 'apiKey, title, and content are required'
export const evernoteCreateNoteBodySchema = z.object({
  apiKey: z.string({ error: CREATE_NOTE_REQUIRED }).min(1, CREATE_NOTE_REQUIRED),
  title: z.string({ error: CREATE_NOTE_REQUIRED }).min(1, CREATE_NOTE_REQUIRED),
  content: z.string({ error: CREATE_NOTE_REQUIRED }).min(1, CREATE_NOTE_REQUIRED),
  notebookGuid: z.string().nullish(),
  tagNames: z.union([z.string(), z.array(z.string())]).nullish(),
})

const UPDATE_NOTE_REQUIRED = 'apiKey and noteGuid are required'
export const evernoteUpdateNoteBodySchema = z.object({
  apiKey: z.string({ error: UPDATE_NOTE_REQUIRED }).min(1, UPDATE_NOTE_REQUIRED),
  noteGuid: z.string({ error: UPDATE_NOTE_REQUIRED }).min(1, UPDATE_NOTE_REQUIRED),
  title: z.string().nullish(),
  content: z.string().nullish(),
  notebookGuid: z.string().nullish(),
  tagNames: z.union([z.string(), z.array(z.string())]).nullish(),
})

const CREATE_TAG_REQUIRED = 'apiKey and name are required'
export const evernoteCreateTagBodySchema = z.object({
  apiKey: z.string({ error: CREATE_TAG_REQUIRED }).min(1, CREATE_TAG_REQUIRED),
  name: z.string({ error: CREATE_TAG_REQUIRED }).min(1, CREATE_TAG_REQUIRED),
  parentGuid: z.string().nullish(),
})

const SEARCH_NOTES_REQUIRED = 'apiKey and query are required'
export const evernoteSearchNotesBodySchema = z.object({
  apiKey: z.string({ error: SEARCH_NOTES_REQUIRED }).min(1, SEARCH_NOTES_REQUIRED),
  query: z.string({ error: SEARCH_NOTES_REQUIRED }).min(1, SEARCH_NOTES_REQUIRED),
  notebookGuid: z.string().nullish(),
  offset: z.unknown().optional().default(0),
  maxNotes: z.unknown().optional().default(25),
})

const CREATE_NOTEBOOK_REQUIRED = 'apiKey and name are required'
export const evernoteCreateNotebookBodySchema = z.object({
  apiKey: z.string({ error: CREATE_NOTEBOOK_REQUIRED }).min(1, CREATE_NOTEBOOK_REQUIRED),
  name: z.string({ error: CREATE_NOTEBOOK_REQUIRED }).min(1, CREATE_NOTEBOOK_REQUIRED),
  stack: z.string().nullish(),
})

const DELETE_NOTE_REQUIRED = 'apiKey and noteGuid are required'
export const evernoteDeleteNoteBodySchema = z.object({
  apiKey: z.string({ error: DELETE_NOTE_REQUIRED }).min(1, DELETE_NOTE_REQUIRED),
  noteGuid: z.string({ error: DELETE_NOTE_REQUIRED }).min(1, DELETE_NOTE_REQUIRED),
})

const LIST_NOTEBOOKS_REQUIRED = 'apiKey is required'
export const evernoteListNotebooksBodySchema = z.object({
  apiKey: z.string({ error: LIST_NOTEBOOKS_REQUIRED }).min(1, LIST_NOTEBOOKS_REQUIRED),
})

const GET_NOTEBOOK_REQUIRED = 'apiKey and notebookGuid are required'
export const evernoteGetNotebookBodySchema = z.object({
  apiKey: z.string({ error: GET_NOTEBOOK_REQUIRED }).min(1, GET_NOTEBOOK_REQUIRED),
  notebookGuid: z.string({ error: GET_NOTEBOOK_REQUIRED }).min(1, GET_NOTEBOOK_REQUIRED),
})

const LIST_TAGS_REQUIRED = 'apiKey is required'
export const evernoteListTagsBodySchema = z.object({
  apiKey: z.string({ error: LIST_TAGS_REQUIRED }).min(1, LIST_TAGS_REQUIRED),
})

const GET_NOTE_REQUIRED = 'apiKey and noteGuid are required'
export const evernoteGetNoteBodySchema = z.object({
  apiKey: z.string({ error: GET_NOTE_REQUIRED }).min(1, GET_NOTE_REQUIRED),
  noteGuid: z.string({ error: GET_NOTE_REQUIRED }).min(1, GET_NOTE_REQUIRED),
  withContent: z.boolean().nullish(),
})

const COPY_NOTE_REQUIRED = 'apiKey, noteGuid, and toNotebookGuid are required'
export const evernoteCopyNoteBodySchema = z.object({
  apiKey: z.string({ error: COPY_NOTE_REQUIRED }).min(1, COPY_NOTE_REQUIRED),
  noteGuid: z.string({ error: COPY_NOTE_REQUIRED }).min(1, COPY_NOTE_REQUIRED),
  toNotebookGuid: z.string({ error: COPY_NOTE_REQUIRED }).min(1, COPY_NOTE_REQUIRED),
})

export const evernoteCreateNoteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/evernote/create-note',
  body: evernoteCreateNoteBodySchema,
  response: { mode: 'json', schema: evernoteNoteResponseSchema },
})

export const evernoteUpdateNoteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/evernote/update-note',
  body: evernoteUpdateNoteBodySchema,
  response: { mode: 'json', schema: evernoteNoteResponseSchema },
})

export const evernoteCreateTagContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/evernote/create-tag',
  body: evernoteCreateTagBodySchema,
  response: { mode: 'json', schema: evernoteTagResponseSchema },
})

export const evernoteSearchNotesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/evernote/search-notes',
  body: evernoteSearchNotesBodySchema,
  response: { mode: 'json', schema: evernoteSearchNotesResponseSchema },
})

export const evernoteCreateNotebookContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/evernote/create-notebook',
  body: evernoteCreateNotebookBodySchema,
  response: { mode: 'json', schema: evernoteNotebookResponseSchema },
})

export const evernoteDeleteNoteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/evernote/delete-note',
  body: evernoteDeleteNoteBodySchema,
  response: { mode: 'json', schema: evernoteDeleteNoteResponseSchema },
})

export const evernoteListNotebooksContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/evernote/list-notebooks',
  body: evernoteListNotebooksBodySchema,
  response: { mode: 'json', schema: evernoteListNotebooksResponseSchema },
})

export const evernoteGetNotebookContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/evernote/get-notebook',
  body: evernoteGetNotebookBodySchema,
  response: { mode: 'json', schema: evernoteNotebookResponseSchema },
})

export const evernoteListTagsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/evernote/list-tags',
  body: evernoteListTagsBodySchema,
  response: { mode: 'json', schema: evernoteListTagsResponseSchema },
})

export const evernoteGetNoteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/evernote/get-note',
  body: evernoteGetNoteBodySchema,
  response: { mode: 'json', schema: evernoteNoteResponseSchema },
})

export const evernoteCopyNoteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/evernote/copy-note',
  body: evernoteCopyNoteBodySchema,
  response: { mode: 'json', schema: evernoteNoteResponseSchema },
})

export type EvernoteCreateNoteBody = ContractBody<typeof evernoteCreateNoteContract>
export type EvernoteCreateNoteBodyInput = ContractBodyInput<typeof evernoteCreateNoteContract>
export type EvernoteCreateNoteResponse = ContractJsonResponse<typeof evernoteCreateNoteContract>
export type EvernoteUpdateNoteBody = ContractBody<typeof evernoteUpdateNoteContract>
export type EvernoteUpdateNoteBodyInput = ContractBodyInput<typeof evernoteUpdateNoteContract>
export type EvernoteUpdateNoteResponse = ContractJsonResponse<typeof evernoteUpdateNoteContract>
export type EvernoteCreateTagBody = ContractBody<typeof evernoteCreateTagContract>
export type EvernoteCreateTagBodyInput = ContractBodyInput<typeof evernoteCreateTagContract>
export type EvernoteCreateTagResponse = ContractJsonResponse<typeof evernoteCreateTagContract>
export type EvernoteSearchNotesBody = ContractBody<typeof evernoteSearchNotesContract>
export type EvernoteSearchNotesBodyInput = ContractBodyInput<typeof evernoteSearchNotesContract>
export type EvernoteSearchNotesResponse = ContractJsonResponse<typeof evernoteSearchNotesContract>
export type EvernoteCreateNotebookBody = ContractBody<typeof evernoteCreateNotebookContract>
export type EvernoteCreateNotebookBodyInput = ContractBodyInput<
  typeof evernoteCreateNotebookContract
>
export type EvernoteCreateNotebookResponse = ContractJsonResponse<
  typeof evernoteCreateNotebookContract
>
export type EvernoteDeleteNoteBody = ContractBody<typeof evernoteDeleteNoteContract>
export type EvernoteDeleteNoteBodyInput = ContractBodyInput<typeof evernoteDeleteNoteContract>
export type EvernoteDeleteNoteResponse = ContractJsonResponse<typeof evernoteDeleteNoteContract>
export type EvernoteListNotebooksBody = ContractBody<typeof evernoteListNotebooksContract>
export type EvernoteListNotebooksBodyInput = ContractBodyInput<typeof evernoteListNotebooksContract>
export type EvernoteListNotebooksResponse = ContractJsonResponse<
  typeof evernoteListNotebooksContract
>
export type EvernoteGetNotebookBody = ContractBody<typeof evernoteGetNotebookContract>
export type EvernoteGetNotebookBodyInput = ContractBodyInput<typeof evernoteGetNotebookContract>
export type EvernoteGetNotebookResponse = ContractJsonResponse<typeof evernoteGetNotebookContract>
export type EvernoteListTagsBody = ContractBody<typeof evernoteListTagsContract>
export type EvernoteListTagsBodyInput = ContractBodyInput<typeof evernoteListTagsContract>
export type EvernoteListTagsResponse = ContractJsonResponse<typeof evernoteListTagsContract>
export type EvernoteGetNoteBody = ContractBody<typeof evernoteGetNoteContract>
export type EvernoteGetNoteBodyInput = ContractBodyInput<typeof evernoteGetNoteContract>
export type EvernoteGetNoteResponse = ContractJsonResponse<typeof evernoteGetNoteContract>
export type EvernoteCopyNoteBody = ContractBody<typeof evernoteCopyNoteContract>
export type EvernoteCopyNoteBodyInput = ContractBodyInput<typeof evernoteCopyNoteContract>
export type EvernoteCopyNoteResponse = ContractJsonResponse<typeof evernoteCopyNoteContract>
