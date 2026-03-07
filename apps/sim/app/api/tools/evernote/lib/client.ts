/**
 * Evernote API client using Thrift binary protocol over HTTP.
 * Implements only the NoteStore methods needed for the integration.
 */

import {
  ThriftReader,
  ThriftWriter,
  TYPE_BOOL,
  TYPE_I32,
  TYPE_I64,
  TYPE_LIST,
  TYPE_STRING,
  TYPE_STRUCT,
} from './thrift'

export interface EvernoteNotebook {
  guid: string
  name: string
  defaultNotebook: boolean
  serviceCreated: number | null
  serviceUpdated: number | null
  stack: string | null
}

export interface EvernoteNote {
  guid: string
  title: string
  content: string | null
  contentLength: number | null
  created: number | null
  updated: number | null
  deleted: number | null
  active: boolean
  notebookGuid: string | null
  tagGuids: string[]
  tagNames: string[]
}

export interface EvernoteNoteMetadata {
  guid: string
  title: string | null
  contentLength: number | null
  created: number | null
  updated: number | null
  notebookGuid: string | null
  tagGuids: string[]
}

export interface EvernoteTag {
  guid: string
  name: string
  parentGuid: string | null
  updateSequenceNum: number | null
}

export interface EvernoteSearchResult {
  startIndex: number
  totalNotes: number
  notes: EvernoteNoteMetadata[]
}

/** Extract shard ID from an Evernote developer token */
function extractShardId(token: string): string {
  const match = token.match(/S=s(\d+)/)
  if (!match) {
    throw new Error('Invalid Evernote token format: cannot extract shard ID')
  }
  return `s${match[1]}`
}

/** Get the NoteStore URL for the given token */
function getNoteStoreUrl(token: string): string {
  const shardId = extractShardId(token)
  const host = token.includes(':Sandbox') ? 'sandbox.evernote.com' : 'www.evernote.com'
  return `https://${host}/shard/${shardId}/notestore`
}

/** Make a Thrift RPC call to the NoteStore */
async function callNoteStore(token: string, writer: ThriftWriter): Promise<ThriftReader> {
  const url = getNoteStoreUrl(token)
  const body = writer.toBuffer()

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-thrift',
      Accept: 'application/x-thrift',
    },
    body: new Uint8Array(body),
  })

  if (!response.ok) {
    throw new Error(`Evernote API HTTP error: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const reader = new ThriftReader(arrayBuffer)
  const msg = reader.readMessageBegin()

  if (reader.isException(msg.type)) {
    const ex = reader.readException()
    throw new Error(`Evernote API error: ${ex.message}`)
  }

  return reader
}

/** Check for Evernote-specific exceptions in the response struct. Returns true if handled. */
function checkEvernoteException(reader: ThriftReader, fieldId: number, fieldType: number): boolean {
  if (fieldId === 1 && fieldType === TYPE_STRUCT) {
    let message = ''
    let errorCode = 0
    reader.readStruct((r, fid, ftype) => {
      if (fid === 1 && ftype === TYPE_I32) {
        errorCode = r.readI32()
      } else if (fid === 2 && ftype === TYPE_STRING) {
        message = r.readString()
      } else {
        r.skip(ftype)
      }
    })
    throw new Error(`Evernote error (${errorCode}): ${message}`)
  }
  if (fieldId === 2 && fieldType === TYPE_STRUCT) {
    let message = ''
    let errorCode = 0
    reader.readStruct((r, fid, ftype) => {
      if (fid === 1 && ftype === TYPE_I32) {
        errorCode = r.readI32()
      } else if (fid === 2 && ftype === TYPE_STRING) {
        message = r.readString()
      } else {
        r.skip(ftype)
      }
    })
    throw new Error(`Evernote system error (${errorCode}): ${message}`)
  }
  if (fieldId === 3 && fieldType === TYPE_STRUCT) {
    let identifier = ''
    let key = ''
    reader.readStruct((r, fid, ftype) => {
      if (fid === 1 && ftype === TYPE_STRING) {
        identifier = r.readString()
      } else if (fid === 2 && ftype === TYPE_STRING) {
        key = r.readString()
      } else {
        r.skip(ftype)
      }
    })
    throw new Error(`Evernote not found: ${identifier}${key ? ` (${key})` : ''}`)
  }
  return false
}

function readNotebook(reader: ThriftReader): EvernoteNotebook {
  const notebook: EvernoteNotebook = {
    guid: '',
    name: '',
    defaultNotebook: false,
    serviceCreated: null,
    serviceUpdated: null,
    stack: null,
  }

  reader.readStruct((r, fieldId, fieldType) => {
    switch (fieldId) {
      case 1:
        if (fieldType === TYPE_STRING) notebook.guid = r.readString()
        else r.skip(fieldType)
        break
      case 2:
        if (fieldType === TYPE_STRING) notebook.name = r.readString()
        else r.skip(fieldType)
        break
      case 4:
        if (fieldType === TYPE_BOOL) notebook.defaultNotebook = r.readBool()
        else r.skip(fieldType)
        break
      case 5:
        if (fieldType === TYPE_I64) notebook.serviceCreated = Number(r.readI64())
        else r.skip(fieldType)
        break
      case 6:
        if (fieldType === TYPE_I64) notebook.serviceUpdated = Number(r.readI64())
        else r.skip(fieldType)
        break
      case 9:
        if (fieldType === TYPE_STRING) notebook.stack = r.readString()
        else r.skip(fieldType)
        break
      default:
        r.skip(fieldType)
    }
  })

  return notebook
}

function readNote(reader: ThriftReader): EvernoteNote {
  const note: EvernoteNote = {
    guid: '',
    title: '',
    content: null,
    contentLength: null,
    created: null,
    updated: null,
    deleted: null,
    active: true,
    notebookGuid: null,
    tagGuids: [],
    tagNames: [],
  }

  reader.readStruct((r, fieldId, fieldType) => {
    switch (fieldId) {
      case 1:
        if (fieldType === TYPE_STRING) note.guid = r.readString()
        else r.skip(fieldType)
        break
      case 2:
        if (fieldType === TYPE_STRING) note.title = r.readString()
        else r.skip(fieldType)
        break
      case 3:
        if (fieldType === TYPE_STRING) note.content = r.readString()
        else r.skip(fieldType)
        break
      case 5:
        if (fieldType === TYPE_I32) note.contentLength = r.readI32()
        else r.skip(fieldType)
        break
      case 6:
        if (fieldType === TYPE_I64) note.created = Number(r.readI64())
        else r.skip(fieldType)
        break
      case 7:
        if (fieldType === TYPE_I64) note.updated = Number(r.readI64())
        else r.skip(fieldType)
        break
      case 8:
        if (fieldType === TYPE_I64) note.deleted = Number(r.readI64())
        else r.skip(fieldType)
        break
      case 9:
        if (fieldType === TYPE_BOOL) note.active = r.readBool()
        else r.skip(fieldType)
        break
      case 11:
        if (fieldType === TYPE_STRING) note.notebookGuid = r.readString()
        else r.skip(fieldType)
        break
      case 12:
        if (fieldType === TYPE_LIST) {
          const { size } = r.readListBegin()
          for (let i = 0; i < size; i++) {
            note.tagGuids.push(r.readString())
          }
        } else {
          r.skip(fieldType)
        }
        break
      case 15:
        if (fieldType === TYPE_LIST) {
          const { size } = r.readListBegin()
          for (let i = 0; i < size; i++) {
            note.tagNames.push(r.readString())
          }
        } else {
          r.skip(fieldType)
        }
        break
      default:
        r.skip(fieldType)
    }
  })

  return note
}

function readTag(reader: ThriftReader): EvernoteTag {
  const tag: EvernoteTag = {
    guid: '',
    name: '',
    parentGuid: null,
    updateSequenceNum: null,
  }

  reader.readStruct((r, fieldId, fieldType) => {
    switch (fieldId) {
      case 1:
        if (fieldType === TYPE_STRING) tag.guid = r.readString()
        else r.skip(fieldType)
        break
      case 2:
        if (fieldType === TYPE_STRING) tag.name = r.readString()
        else r.skip(fieldType)
        break
      case 3:
        if (fieldType === TYPE_STRING) tag.parentGuid = r.readString()
        else r.skip(fieldType)
        break
      case 4:
        if (fieldType === TYPE_I32) tag.updateSequenceNum = r.readI32()
        else r.skip(fieldType)
        break
      default:
        r.skip(fieldType)
    }
  })

  return tag
}

function readNoteMetadata(reader: ThriftReader): EvernoteNoteMetadata {
  const meta: EvernoteNoteMetadata = {
    guid: '',
    title: null,
    contentLength: null,
    created: null,
    updated: null,
    notebookGuid: null,
    tagGuids: [],
  }

  reader.readStruct((r, fieldId, fieldType) => {
    switch (fieldId) {
      case 1:
        if (fieldType === TYPE_STRING) meta.guid = r.readString()
        else r.skip(fieldType)
        break
      case 2:
        if (fieldType === TYPE_STRING) meta.title = r.readString()
        else r.skip(fieldType)
        break
      case 5:
        if (fieldType === TYPE_I32) meta.contentLength = r.readI32()
        else r.skip(fieldType)
        break
      case 6:
        if (fieldType === TYPE_I64) meta.created = Number(r.readI64())
        else r.skip(fieldType)
        break
      case 7:
        if (fieldType === TYPE_I64) meta.updated = Number(r.readI64())
        else r.skip(fieldType)
        break
      case 11:
        if (fieldType === TYPE_STRING) meta.notebookGuid = r.readString()
        else r.skip(fieldType)
        break
      case 12:
        if (fieldType === TYPE_LIST) {
          const { size } = r.readListBegin()
          for (let i = 0; i < size; i++) {
            meta.tagGuids.push(r.readString())
          }
        } else {
          r.skip(fieldType)
        }
        break
      default:
        r.skip(fieldType)
    }
  })

  return meta
}

export async function listNotebooks(token: string): Promise<EvernoteNotebook[]> {
  const writer = new ThriftWriter()
  writer.writeMessageBegin('listNotebooks', 0)
  writer.writeStringField(1, token)
  writer.writeFieldStop()

  const reader = await callNoteStore(token, writer)
  const notebooks: EvernoteNotebook[] = []

  reader.readStruct((r, fieldId, fieldType) => {
    if (fieldId === 0 && fieldType === TYPE_LIST) {
      const { size } = r.readListBegin()
      for (let i = 0; i < size; i++) {
        notebooks.push(readNotebook(r))
      }
    } else {
      if (!checkEvernoteException(r, fieldId, fieldType)) {
        r.skip(fieldType)
      }
    }
  })

  return notebooks
}

export async function getNote(
  token: string,
  guid: string,
  withContent = true
): Promise<EvernoteNote> {
  const writer = new ThriftWriter()
  writer.writeMessageBegin('getNote', 0)
  writer.writeStringField(1, token)
  writer.writeStringField(2, guid)
  writer.writeBoolField(3, withContent)
  writer.writeBoolField(4, false)
  writer.writeBoolField(5, false)
  writer.writeBoolField(6, false)
  writer.writeFieldStop()

  const reader = await callNoteStore(token, writer)
  let note: EvernoteNote | null = null

  reader.readStruct((r, fieldId, fieldType) => {
    if (fieldId === 0 && fieldType === TYPE_STRUCT) {
      note = readNote(r)
    } else {
      if (!checkEvernoteException(r, fieldId, fieldType)) {
        r.skip(fieldType)
      }
    }
  })

  if (!note) {
    throw new Error('No note returned from Evernote API')
  }

  return note
}

/** Wrap content in ENML if it's not already */
function wrapInEnml(content: string): string {
  if (content.includes('<!DOCTYPE en-note')) {
    return content
  }
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${escaped}</en-note>`
}

export async function createNote(
  token: string,
  title: string,
  content: string,
  notebookGuid?: string,
  tagNames?: string[]
): Promise<EvernoteNote> {
  const writer = new ThriftWriter()
  writer.writeMessageBegin('createNote', 0)
  writer.writeStringField(1, token)

  writer.writeFieldBegin(TYPE_STRUCT, 2)
  writer.writeStringField(2, title)
  writer.writeStringField(3, wrapInEnml(content))
  if (notebookGuid) {
    writer.writeStringField(11, notebookGuid)
  }
  if (tagNames && tagNames.length > 0) {
    writer.writeStringListField(15, tagNames)
  }
  writer.writeFieldStop()

  writer.writeFieldStop()

  const reader = await callNoteStore(token, writer)
  let note: EvernoteNote | null = null

  reader.readStruct((r, fieldId, fieldType) => {
    if (fieldId === 0 && fieldType === TYPE_STRUCT) {
      note = readNote(r)
    } else {
      if (!checkEvernoteException(r, fieldId, fieldType)) {
        r.skip(fieldType)
      }
    }
  })

  if (!note) {
    throw new Error('No note returned from Evernote API')
  }

  return note
}

export async function updateNote(
  token: string,
  guid: string,
  title?: string,
  content?: string,
  notebookGuid?: string,
  tagNames?: string[]
): Promise<EvernoteNote> {
  const writer = new ThriftWriter()
  writer.writeMessageBegin('updateNote', 0)
  writer.writeStringField(1, token)

  writer.writeFieldBegin(TYPE_STRUCT, 2)
  writer.writeStringField(1, guid)
  if (title !== undefined) {
    writer.writeStringField(2, title)
  }
  if (content !== undefined) {
    writer.writeStringField(3, wrapInEnml(content))
  }
  if (notebookGuid !== undefined) {
    writer.writeStringField(11, notebookGuid)
  }
  if (tagNames !== undefined) {
    writer.writeStringListField(15, tagNames)
  }
  writer.writeFieldStop()

  writer.writeFieldStop()

  const reader = await callNoteStore(token, writer)
  let note: EvernoteNote | null = null

  reader.readStruct((r, fieldId, fieldType) => {
    if (fieldId === 0 && fieldType === TYPE_STRUCT) {
      note = readNote(r)
    } else {
      if (!checkEvernoteException(r, fieldId, fieldType)) {
        r.skip(fieldType)
      }
    }
  })

  if (!note) {
    throw new Error('No note returned from Evernote API')
  }

  return note
}

export async function deleteNote(token: string, guid: string): Promise<number> {
  const writer = new ThriftWriter()
  writer.writeMessageBegin('deleteNote', 0)
  writer.writeStringField(1, token)
  writer.writeStringField(2, guid)
  writer.writeFieldStop()

  const reader = await callNoteStore(token, writer)
  let usn = 0

  reader.readStruct((r, fieldId, fieldType) => {
    if (fieldId === 0 && fieldType === TYPE_I32) {
      usn = r.readI32()
    } else {
      if (!checkEvernoteException(r, fieldId, fieldType)) {
        r.skip(fieldType)
      }
    }
  })

  return usn
}

export async function searchNotes(
  token: string,
  query: string,
  notebookGuid?: string,
  offset = 0,
  maxNotes = 25
): Promise<EvernoteSearchResult> {
  const writer = new ThriftWriter()
  writer.writeMessageBegin('findNotesMetadata', 0)
  writer.writeStringField(1, token)

  // NoteFilter (field 2)
  writer.writeFieldBegin(TYPE_STRUCT, 2)
  if (query) {
    writer.writeStringField(3, query)
  }
  if (notebookGuid) {
    writer.writeStringField(4, notebookGuid)
  }
  writer.writeFieldStop()

  // offset (field 3)
  writer.writeI32Field(3, offset)
  // maxNotes (field 4)
  writer.writeI32Field(4, maxNotes)

  // NotesMetadataResultSpec (field 5)
  writer.writeFieldBegin(TYPE_STRUCT, 5)
  writer.writeBoolField(2, true) // includeTitle
  writer.writeBoolField(5, true) // includeContentLength
  writer.writeBoolField(6, true) // includeCreated
  writer.writeBoolField(7, true) // includeUpdated
  writer.writeBoolField(11, true) // includeNotebookGuid
  writer.writeBoolField(12, true) // includeTagGuids
  writer.writeFieldStop()

  writer.writeFieldStop()

  const reader = await callNoteStore(token, writer)
  const result: EvernoteSearchResult = {
    startIndex: 0,
    totalNotes: 0,
    notes: [],
  }

  reader.readStruct((r, fieldId, fieldType) => {
    if (fieldId === 0 && fieldType === TYPE_STRUCT) {
      r.readStruct((r2, fid2, ftype2) => {
        switch (fid2) {
          case 1:
            if (ftype2 === TYPE_I32) result.startIndex = r2.readI32()
            else r2.skip(ftype2)
            break
          case 2:
            if (ftype2 === TYPE_I32) result.totalNotes = r2.readI32()
            else r2.skip(ftype2)
            break
          case 3:
            if (ftype2 === TYPE_LIST) {
              const { size } = r2.readListBegin()
              for (let i = 0; i < size; i++) {
                result.notes.push(readNoteMetadata(r2))
              }
            } else {
              r2.skip(ftype2)
            }
            break
          default:
            r2.skip(ftype2)
        }
      })
    } else {
      if (!checkEvernoteException(r, fieldId, fieldType)) {
        r.skip(fieldType)
      }
    }
  })

  return result
}

export async function getNotebook(token: string, guid: string): Promise<EvernoteNotebook> {
  const writer = new ThriftWriter()
  writer.writeMessageBegin('getNotebook', 0)
  writer.writeStringField(1, token)
  writer.writeStringField(2, guid)
  writer.writeFieldStop()

  const reader = await callNoteStore(token, writer)
  let notebook: EvernoteNotebook | null = null

  reader.readStruct((r, fieldId, fieldType) => {
    if (fieldId === 0 && fieldType === TYPE_STRUCT) {
      notebook = readNotebook(r)
    } else {
      if (!checkEvernoteException(r, fieldId, fieldType)) {
        r.skip(fieldType)
      }
    }
  })

  if (!notebook) {
    throw new Error('No notebook returned from Evernote API')
  }

  return notebook
}

export async function createNotebook(
  token: string,
  name: string,
  stack?: string
): Promise<EvernoteNotebook> {
  const writer = new ThriftWriter()
  writer.writeMessageBegin('createNotebook', 0)
  writer.writeStringField(1, token)

  writer.writeFieldBegin(TYPE_STRUCT, 2)
  writer.writeStringField(2, name)
  if (stack) {
    writer.writeStringField(9, stack)
  }
  writer.writeFieldStop()

  writer.writeFieldStop()

  const reader = await callNoteStore(token, writer)
  let notebook: EvernoteNotebook | null = null

  reader.readStruct((r, fieldId, fieldType) => {
    if (fieldId === 0 && fieldType === TYPE_STRUCT) {
      notebook = readNotebook(r)
    } else {
      if (!checkEvernoteException(r, fieldId, fieldType)) {
        r.skip(fieldType)
      }
    }
  })

  if (!notebook) {
    throw new Error('No notebook returned from Evernote API')
  }

  return notebook
}

export async function listTags(token: string): Promise<EvernoteTag[]> {
  const writer = new ThriftWriter()
  writer.writeMessageBegin('listTags', 0)
  writer.writeStringField(1, token)
  writer.writeFieldStop()

  const reader = await callNoteStore(token, writer)
  const tags: EvernoteTag[] = []

  reader.readStruct((r, fieldId, fieldType) => {
    if (fieldId === 0 && fieldType === TYPE_LIST) {
      const { size } = r.readListBegin()
      for (let i = 0; i < size; i++) {
        tags.push(readTag(r))
      }
    } else {
      if (!checkEvernoteException(r, fieldId, fieldType)) {
        r.skip(fieldType)
      }
    }
  })

  return tags
}

export async function createTag(
  token: string,
  name: string,
  parentGuid?: string
): Promise<EvernoteTag> {
  const writer = new ThriftWriter()
  writer.writeMessageBegin('createTag', 0)
  writer.writeStringField(1, token)

  writer.writeFieldBegin(TYPE_STRUCT, 2)
  writer.writeStringField(2, name)
  if (parentGuid) {
    writer.writeStringField(3, parentGuid)
  }
  writer.writeFieldStop()

  writer.writeFieldStop()

  const reader = await callNoteStore(token, writer)
  let tag: EvernoteTag | null = null

  reader.readStruct((r, fieldId, fieldType) => {
    if (fieldId === 0 && fieldType === TYPE_STRUCT) {
      tag = readTag(r)
    } else {
      if (!checkEvernoteException(r, fieldId, fieldType)) {
        r.skip(fieldType)
      }
    }
  })

  if (!tag) {
    throw new Error('No tag returned from Evernote API')
  }

  return tag
}

export async function copyNote(
  token: string,
  noteGuid: string,
  toNotebookGuid: string
): Promise<EvernoteNote> {
  const writer = new ThriftWriter()
  writer.writeMessageBegin('copyNote', 0)
  writer.writeStringField(1, token)
  writer.writeStringField(2, noteGuid)
  writer.writeStringField(3, toNotebookGuid)
  writer.writeFieldStop()

  const reader = await callNoteStore(token, writer)
  let note: EvernoteNote | null = null

  reader.readStruct((r, fieldId, fieldType) => {
    if (fieldId === 0 && fieldType === TYPE_STRUCT) {
      note = readNote(r)
    } else {
      if (!checkEvernoteException(r, fieldId, fieldType)) {
        r.skip(fieldType)
      }
    }
  })

  if (!note) {
    throw new Error('No note returned from Evernote API')
  }

  return note
}
