import { createLogger } from '@sim/logger'
import { EvernoteIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import {
  ThriftReader,
  ThriftWriter,
  TYPE_I32,
  TYPE_I64,
  TYPE_LIST,
  TYPE_STRING,
  TYPE_STRUCT,
} from '@/app/api/tools/evernote/lib/thrift'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('EvernoteConnector')

const NOTES_PER_PAGE = 50

/**
 * Extracts the shard ID from an Evernote developer token.
 * Token format: "S=s1:U=12345:..." where s1 is the shard.
 */
function extractShardId(token: string): string {
  const match = token.match(/S=s(\d+)/)
  if (!match) {
    throw new Error('Invalid Evernote token format: cannot extract shard ID')
  }
  return `s${match[1]}`
}

/**
 * Extracts the user ID from an Evernote developer token.
 * Token format: "S=s1:U=12345:..." where 12345 is the user ID.
 */
function extractUserId(token: string): string {
  const match = token.match(/:U=(\d+)/)
  if (!match) {
    throw new Error('Invalid Evernote token format: cannot extract user ID')
  }
  return match[1]
}

/**
 * Returns the Evernote API host based on the token type.
 * Sandbox tokens contain `:Sandbox` and route to sandbox.evernote.com.
 */
function getHost(token: string): string {
  return token.includes(':Sandbox') ? 'sandbox.evernote.com' : 'www.evernote.com'
}

/**
 * Derives the NoteStore URL from a developer token.
 */
function getNoteStoreUrl(token: string): string {
  const shardId = extractShardId(token)
  return `https://${getHost(token)}/shard/${shardId}/notestore`
}

/**
 * Sends a Thrift RPC call to the Evernote NoteStore via HTTP POST.
 */
async function callNoteStore(
  token: string,
  writer: ThriftWriter,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<ThriftReader> {
  const url = getNoteStoreUrl(token)

  const response = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-thrift',
        Accept: 'application/x-thrift',
      },
      body: new Uint8Array(writer.toBuffer()),
    },
    retryOptions
  )

  if (!response.ok) {
    throw new Error(`Evernote HTTP ${response.status}: ${response.statusText}`)
  }

  const reader = new ThriftReader(await response.arrayBuffer())
  const msg = reader.readMessageBegin()

  if (reader.isException(msg.type)) {
    const ex = reader.readException()
    throw new Error(`Evernote API error: ${ex.message}`)
  }

  return reader
}

/**
 * Checks for Evernote-specific exceptions in response struct fields 1-3.
 */
function checkException(r: ThriftReader, fieldId: number, fieldType: number): boolean {
  if ((fieldId === 1 || fieldId === 2) && fieldType === TYPE_STRUCT) {
    let errorCode = 0
    let message = ''
    r.readStruct((r2, fid, ftype) => {
      if (fid === 1 && ftype === TYPE_I32) errorCode = r2.readI32()
      else if (fid === 2 && ftype === TYPE_STRING) message = r2.readString()
      else r2.skip(ftype)
    })
    throw new Error(`Evernote error (${errorCode}): ${message}`)
  }
  if (fieldId === 3 && fieldType === TYPE_STRUCT) {
    let identifier = ''
    r.readStruct((r2, fid, ftype) => {
      if (fid === 1 && ftype === TYPE_STRING) identifier = r2.readString()
      else r2.skip(ftype)
    })
    throw new Error(`Evernote not found: ${identifier}`)
  }
  return false
}

interface Notebook {
  guid: string
  name: string
}

interface Tag {
  guid: string
  name: string
}

interface NoteMetadata {
  guid: string
  title: string
  created: number
  updated: number
  notebookGuid: string
  tagGuids: string[]
}

interface Note {
  guid: string
  title: string
  content: string
  created: number
  updated: number
  notebookGuid: string
  tagGuids: string[]
}

async function apiListNotebooks(
  token: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Notebook[]> {
  const w = new ThriftWriter()
  w.writeMessageBegin('listNotebooks', 0)
  w.writeStringField(1, token)
  w.writeFieldStop()

  const r = await callNoteStore(token, w, retryOptions)
  const notebooks: Notebook[] = []

  r.readStruct((r2, fid, ftype) => {
    if (fid === 0 && ftype === TYPE_LIST) {
      const { size } = r2.readListBegin()
      for (let i = 0; i < size; i++) {
        let guid = ''
        let name = ''
        r2.readStruct((r3, fid3, ftype3) => {
          if (fid3 === 1 && ftype3 === TYPE_STRING) guid = r3.readString()
          else if (fid3 === 2 && ftype3 === TYPE_STRING) name = r3.readString()
          else r3.skip(ftype3)
        })
        notebooks.push({ guid, name })
      }
    } else if (!checkException(r2, fid, ftype)) {
      r2.skip(ftype)
    }
  })

  return notebooks
}

async function apiListTags(
  token: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Tag[]> {
  const w = new ThriftWriter()
  w.writeMessageBegin('listTags', 0)
  w.writeStringField(1, token)
  w.writeFieldStop()

  const r = await callNoteStore(token, w, retryOptions)
  const tags: Tag[] = []

  r.readStruct((r2, fid, ftype) => {
    if (fid === 0 && ftype === TYPE_LIST) {
      const { size } = r2.readListBegin()
      for (let i = 0; i < size; i++) {
        let guid = ''
        let name = ''
        r2.readStruct((r3, fid3, ftype3) => {
          if (fid3 === 1 && ftype3 === TYPE_STRING) guid = r3.readString()
          else if (fid3 === 2 && ftype3 === TYPE_STRING) name = r3.readString()
          else r3.skip(ftype3)
        })
        tags.push({ guid, name })
      }
    } else if (!checkException(r2, fid, ftype)) {
      r2.skip(ftype)
    }
  })

  return tags
}

/**
 * Calls NoteStore.findNotesMetadata with offset-based pagination.
 *
 * Thrift field numbers (from NoteStore.thrift):
 *   findNotesMetadata(1:token, 2:NoteFilter, 3:offset, 4:maxNotes, 5:ResultSpec)
 *   NoteFilter: 4:notebookGuid
 *   NotesMetadataResultSpec: 2:includeTitle, 6:includeCreated, 7:includeUpdated,
 *                            11:includeNotebookGuid, 12:includeTagGuids
 *   NotesMetadataList: 1:startIndex, 2:totalNotes, 3:list<NoteMetadata>
 *   NoteMetadata: 1:guid, 2:title, 6:created(i64), 7:updated(i64),
 *                 11:notebookGuid, 12:list<tagGuids>
 */
async function apiFindNotesMetadata(
  token: string,
  offset: number,
  maxNotes: number,
  notebookGuid?: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<{ totalNotes: number; notes: NoteMetadata[] }> {
  const w = new ThriftWriter()
  w.writeMessageBegin('findNotesMetadata', 0)
  w.writeStringField(1, token)

  w.writeFieldBegin(TYPE_STRUCT, 2) // NoteFilter
  if (notebookGuid) {
    w.writeStringField(4, notebookGuid)
  }
  w.writeFieldStop()

  w.writeI32Field(3, offset)
  w.writeI32Field(4, maxNotes)

  w.writeFieldBegin(TYPE_STRUCT, 5) // NotesMetadataResultSpec
  w.writeBoolField(2, true) // includeTitle
  w.writeBoolField(6, true) // includeCreated
  w.writeBoolField(7, true) // includeUpdated
  w.writeBoolField(11, true) // includeNotebookGuid
  w.writeBoolField(12, true) // includeTagGuids
  w.writeFieldStop()

  w.writeFieldStop()

  const r = await callNoteStore(token, w, retryOptions)

  let totalNotes = 0
  const notes: NoteMetadata[] = []

  r.readStruct((r2, fid, ftype) => {
    if (fid === 0 && ftype === TYPE_STRUCT) {
      r2.readStruct((r3, fid3, ftype3) => {
        if (fid3 === 1 && ftype3 === TYPE_I32) {
          r3.readI32()
        } else if (fid3 === 2 && ftype3 === TYPE_I32) {
          totalNotes = r3.readI32()
        } else if (fid3 === 3 && ftype3 === TYPE_LIST) {
          const { size } = r3.readListBegin()
          for (let i = 0; i < size; i++) {
            let guid = ''
            let title = ''
            let created = 0
            let updated = 0
            let nbGuid = ''
            const tagGuids: string[] = []

            r3.readStruct((r4, fid4, ftype4) => {
              if (fid4 === 1 && ftype4 === TYPE_STRING) guid = r4.readString()
              else if (fid4 === 2 && ftype4 === TYPE_STRING) title = r4.readString()
              else if (fid4 === 6 && ftype4 === TYPE_I64) created = Number(r4.readI64())
              else if (fid4 === 7 && ftype4 === TYPE_I64) updated = Number(r4.readI64())
              else if (fid4 === 11 && ftype4 === TYPE_STRING) nbGuid = r4.readString()
              else if (fid4 === 12 && ftype4 === TYPE_LIST) {
                const { size: tagCount } = r4.readListBegin()
                for (let t = 0; t < tagCount; t++) tagGuids.push(r4.readString())
              } else {
                r4.skip(ftype4)
              }
            })
            notes.push({ guid, title, created, updated, notebookGuid: nbGuid, tagGuids })
          }
        } else {
          r3.skip(ftype3)
        }
      })
    } else if (!checkException(r2, fid, ftype)) {
      r2.skip(ftype)
    }
  })

  return { totalNotes, notes }
}

/**
 * Calls NoteStore.getNote to fetch a single note with content.
 *
 * Thrift: getNote(1:token, 2:guid, 3:withContent, 4:withResourcesData,
 *                 5:withResourcesRecognition, 6:withResourcesAlternateData)
 * Note: 1:guid, 2:title, 3:content, 6:created, 7:updated, 11:notebookGuid, 12:tagGuids
 */
async function apiGetNote(
  token: string,
  guid: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Note> {
  const w = new ThriftWriter()
  w.writeMessageBegin('getNote', 0)
  w.writeStringField(1, token)
  w.writeStringField(2, guid)
  w.writeBoolField(3, true) // withContent
  w.writeBoolField(4, false) // withResourcesData
  w.writeBoolField(5, false) // withResourcesRecognition
  w.writeBoolField(6, false) // withResourcesAlternateData
  w.writeFieldStop()

  const r = await callNoteStore(token, w, retryOptions)

  let noteGuid = ''
  let title = ''
  let content = ''
  let created = 0
  let updated = 0
  let notebookGuid = ''
  const tagGuids: string[] = []

  r.readStruct((r2, fid, ftype) => {
    if (fid === 0 && ftype === TYPE_STRUCT) {
      r2.readStruct((r3, fid3, ftype3) => {
        if (fid3 === 1 && ftype3 === TYPE_STRING) noteGuid = r3.readString()
        else if (fid3 === 2 && ftype3 === TYPE_STRING) title = r3.readString()
        else if (fid3 === 3 && ftype3 === TYPE_STRING) content = r3.readString()
        else if (fid3 === 6 && ftype3 === TYPE_I64) created = Number(r3.readI64())
        else if (fid3 === 7 && ftype3 === TYPE_I64) updated = Number(r3.readI64())
        else if (fid3 === 11 && ftype3 === TYPE_STRING) notebookGuid = r3.readString()
        else if (fid3 === 12 && ftype3 === TYPE_LIST) {
          const { size } = r3.readListBegin()
          for (let t = 0; t < size; t++) tagGuids.push(r3.readString())
        } else {
          r3.skip(ftype3)
        }
      })
    } else if (!checkException(r2, fid, ftype)) {
      r2.skip(ftype)
    }
  })

  return { guid: noteGuid || guid, title, content, created, updated, notebookGuid, tagGuids }
}

export const evernoteConnector: ConnectorConfig = {
  id: 'evernote',
  name: 'Evernote',
  description: 'Sync notes from Evernote into your knowledge base',
  version: '1.0.0',
  icon: EvernoteIcon,

  auth: {
    mode: 'apiKey',
    label: 'Developer Token',
    placeholder: 'Enter your Evernote developer token (starts with S=)',
  },

  configFields: [
    {
      id: 'notebookGuid',
      title: 'Notebook GUID',
      type: 'short-input',
      placeholder: 'Leave empty to sync all notebooks',
      required: false,
      description: 'Sync only notes from this notebook (optional)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const notebookGuid = (sourceConfig.notebookGuid as string) || undefined
    const retryOptions = { maxRetries: 3, initialDelayMs: 500 }

    if (syncContext && !syncContext.tagMap) {
      const tags = await apiListTags(accessToken, retryOptions)
      syncContext.tagMap = Object.fromEntries(tags.map((t) => [t.guid, t.name]))
    }
    if (syncContext && !syncContext.notebookMap) {
      const notebooks = await apiListNotebooks(accessToken, retryOptions)
      syncContext.notebookMap = Object.fromEntries(notebooks.map((nb) => [nb.guid, nb.name]))
    }

    const tagMap = (syncContext?.tagMap as Record<string, string>) || {}
    const notebookMap = (syncContext?.notebookMap as Record<string, string>) || {}
    const offset = cursor ? Number(cursor) : 0
    const shardId = extractShardId(accessToken)
    const userId = extractUserId(accessToken)
    const host = getHost(accessToken)

    logger.info('Listing Evernote notes', { offset, maxNotes: NOTES_PER_PAGE })

    const result = await apiFindNotesMetadata(
      accessToken,
      offset,
      NOTES_PER_PAGE,
      notebookGuid,
      retryOptions
    )

    const documents: ExternalDocument[] = result.notes.map((meta) => {
      const tagNames = meta.tagGuids.map((g) => tagMap[g]).filter(Boolean)

      return {
        externalId: meta.guid,
        title: meta.title || 'Untitled',
        content: '',
        contentDeferred: true,
        mimeType: 'text/plain',
        sourceUrl: `https://${host}/shard/${shardId}/nl/${userId}/${meta.guid}/`,
        contentHash: `evernote:${meta.guid}:${meta.updated}`,
        metadata: {
          tags: tagNames,
          notebook: notebookMap[meta.notebookGuid] || '',
          createdAt: meta.created ? new Date(meta.created).toISOString() : undefined,
          updatedAt: meta.updated ? new Date(meta.updated).toISOString() : undefined,
        },
      }
    })

    const nextOffset = offset + result.notes.length
    const hasMore = nextOffset < result.totalNotes

    return {
      documents,
      nextCursor: hasMore ? String(nextOffset) : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    try {
      const retryOptions = { maxRetries: 3, initialDelayMs: 500 }
      const note = await apiGetNote(accessToken, externalId, retryOptions)
      const plainText = htmlToPlainText(note.content)
      if (!plainText.trim()) return null

      const shardId = extractShardId(accessToken)
      const userId = extractUserId(accessToken)
      const host = getHost(accessToken)

      if (syncContext && !syncContext.tagMap) {
        const tags = await apiListTags(accessToken, retryOptions)
        syncContext.tagMap = Object.fromEntries(tags.map((t) => [t.guid, t.name]))
      }
      if (syncContext && !syncContext.notebookMap) {
        const notebooks = await apiListNotebooks(accessToken, retryOptions)
        syncContext.notebookMap = Object.fromEntries(notebooks.map((nb) => [nb.guid, nb.name]))
      }

      let tagMap: Record<string, string>
      let notebookMap: Record<string, string>
      if (syncContext) {
        tagMap = syncContext.tagMap as Record<string, string>
        notebookMap = syncContext.notebookMap as Record<string, string>
      } else {
        const tags = await apiListTags(accessToken, retryOptions)
        tagMap = Object.fromEntries(tags.map((t) => [t.guid, t.name]))
        const notebooks = await apiListNotebooks(accessToken, retryOptions)
        notebookMap = Object.fromEntries(notebooks.map((nb) => [nb.guid, nb.name]))
      }

      const tagNames = note.tagGuids.map((g) => tagMap[g]).filter(Boolean)
      const notebookName = notebookMap[note.notebookGuid] || ''

      return {
        externalId,
        title: note.title || 'Untitled',
        content: plainText,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: `https://${host}/shard/${shardId}/nl/${userId}/${externalId}/`,
        contentHash: `evernote:${note.guid}:${note.updated}`,
        metadata: {
          tags: tagNames,
          notebook: notebookName,
          createdAt: note.created ? new Date(note.created).toISOString() : undefined,
          updatedAt: note.updated ? new Date(note.updated).toISOString() : undefined,
        },
      }
    } catch (error) {
      logger.warn('Failed to get Evernote note', {
        externalId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    try {
      extractShardId(accessToken)
    } catch {
      return { valid: false, error: 'Invalid developer token format — must start with S=s{number}' }
    }

    try {
      const notebooks = await apiListNotebooks(accessToken, VALIDATE_RETRY_OPTIONS)

      const notebookGuid = (sourceConfig.notebookGuid as string) || ''
      if (notebookGuid.trim()) {
        const found = notebooks.some((nb) => nb.guid === notebookGuid.trim())
        if (!found) {
          return { valid: false, error: `Notebook with GUID "${notebookGuid}" not found` }
        }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect to Evernote'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'notebook', displayName: 'Notebook', fieldType: 'text' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
    { id: 'createdAt', displayName: 'Created', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const tags = joinTagArray(metadata.tags)
    if (tags) result.tags = tags

    if (typeof metadata.notebook === 'string' && metadata.notebook) {
      result.notebook = metadata.notebook
    }

    const updatedAt = parseTagDate(metadata.updatedAt)
    if (updatedAt) result.updatedAt = updatedAt

    const createdAt = parseTagDate(metadata.createdAt)
    if (createdAt) result.createdAt = createdAt

    return result
  },
}
