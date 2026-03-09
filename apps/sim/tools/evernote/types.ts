import type { ToolResponse } from '@/tools/types'

export interface EvernoteBaseParams {
  apiKey: string
}

export interface EvernoteCreateNoteParams extends EvernoteBaseParams {
  title: string
  content: string
  notebookGuid?: string
  tagNames?: string
}

export interface EvernoteGetNoteParams extends EvernoteBaseParams {
  noteGuid: string
  withContent?: boolean
}

export interface EvernoteUpdateNoteParams extends EvernoteBaseParams {
  noteGuid: string
  title?: string
  content?: string
  notebookGuid?: string
  tagNames?: string
}

export interface EvernoteDeleteNoteParams extends EvernoteBaseParams {
  noteGuid: string
}

export interface EvernoteSearchNotesParams extends EvernoteBaseParams {
  query: string
  notebookGuid?: string
  offset?: number
  maxNotes?: number
}

export interface EvernoteListNotebooksParams extends EvernoteBaseParams {}

export interface EvernoteGetNotebookParams extends EvernoteBaseParams {
  notebookGuid: string
}

export interface EvernoteCreateNotebookParams extends EvernoteBaseParams {
  name: string
  stack?: string
}

export interface EvernoteListTagsParams extends EvernoteBaseParams {}

export interface EvernoteCreateTagParams extends EvernoteBaseParams {
  name: string
  parentGuid?: string
}

export interface EvernoteCopyNoteParams extends EvernoteBaseParams {
  noteGuid: string
  toNotebookGuid: string
}

export interface EvernoteNoteOutput {
  guid: string
  title: string
  content: string | null
  contentLength: number | null
  created: number | null
  updated: number | null
  active: boolean
  notebookGuid: string | null
  tagGuids: string[]
  tagNames: string[]
}

export interface EvernoteNotebookOutput {
  guid: string
  name: string
  defaultNotebook: boolean
  serviceCreated: number | null
  serviceUpdated: number | null
  stack: string | null
}

export interface EvernoteNoteMetadataOutput {
  guid: string
  title: string | null
  contentLength: number | null
  created: number | null
  updated: number | null
  notebookGuid: string | null
  tagGuids: string[]
}

export interface EvernoteTagOutput {
  guid: string
  name: string
  parentGuid: string | null
  updateSequenceNum: number | null
}

export interface EvernoteCreateNoteResponse extends ToolResponse {
  output: {
    note: EvernoteNoteOutput
  }
}

export interface EvernoteGetNoteResponse extends ToolResponse {
  output: {
    note: EvernoteNoteOutput
  }
}

export interface EvernoteUpdateNoteResponse extends ToolResponse {
  output: {
    note: EvernoteNoteOutput
  }
}

export interface EvernoteDeleteNoteResponse extends ToolResponse {
  output: {
    success: boolean
    noteGuid: string
  }
}

export interface EvernoteSearchNotesResponse extends ToolResponse {
  output: {
    totalNotes: number
    notes: EvernoteNoteMetadataOutput[]
  }
}

export interface EvernoteListNotebooksResponse extends ToolResponse {
  output: {
    notebooks: EvernoteNotebookOutput[]
  }
}

export interface EvernoteGetNotebookResponse extends ToolResponse {
  output: {
    notebook: EvernoteNotebookOutput
  }
}

export interface EvernoteCreateNotebookResponse extends ToolResponse {
  output: {
    notebook: EvernoteNotebookOutput
  }
}

export interface EvernoteListTagsResponse extends ToolResponse {
  output: {
    tags: EvernoteTagOutput[]
  }
}

export interface EvernoteCreateTagResponse extends ToolResponse {
  output: {
    tag: EvernoteTagOutput
  }
}

export interface EvernoteCopyNoteResponse extends ToolResponse {
  output: {
    note: EvernoteNoteOutput
  }
}
