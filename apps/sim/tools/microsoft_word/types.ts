import type { MicrosoftGraphIdentitySet, OneDriveIdentity } from '@/tools/onedrive/types'
import type { ToolResponse } from '@/tools/types'

/**
 * Projection of the Microsoft Graph `driveItem` fields Sim surfaces for a Word
 * document.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/resources/driveitem
 */
export interface MicrosoftWordDocumentMetadata {
  documentId: string
  name: string | null
  mimeType: string | null
  webViewLink: string | null
  size: number | null
  createdTime: string | null
  modifiedTime: string | null
  /** Drive holding the document; pass it as `driveId` to address a SharePoint document. */
  driveId?: string | null
  parentFolderId?: string | null
  createdBy?: OneDriveIdentity | null
  lastModifiedBy?: OneDriveIdentity | null
}

/**
 * Microsoft Graph `driveItem` fields the Word tools project.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/resources/driveitem
 */
export interface MicrosoftWordGraphDriveItem {
  id?: string
  name?: string
  size?: number
  webUrl?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  /** An eTag for the item's content, unchanged when only metadata changes. */
  cTag?: string
  /** An eTag for the whole item, metadata included. */
  eTag?: string
  file?: { mimeType?: string }
  folder?: Record<string, unknown>
  parentReference?: { id?: string; driveId?: string }
  createdBy?: MicrosoftGraphIdentitySet
  lastModifiedBy?: MicrosoftGraphIdentitySet
}

export interface MicrosoftWordToolParams {
  accessToken: string
  documentId?: string
  driveId?: string
  folderId?: string
  name?: string
  content?: string
  query?: string
  pageSize?: number
  pageToken?: string
  fileName?: string
  templateDocumentId?: string
  replacements?: unknown
  findText?: string
  replaceText?: string
  matchCase?: boolean
}

export interface MicrosoftWordCreateResponse extends ToolResponse {
  output: {
    metadata: MicrosoftWordDocumentMetadata
  }
}

export interface MicrosoftWordReadResponse extends ToolResponse {
  output: {
    content: string
    metadata: MicrosoftWordDocumentMetadata
  }
}

export interface MicrosoftWordUpdateResponse extends ToolResponse {
  output: {
    updatedContent: boolean
    metadata: MicrosoftWordDocumentMetadata
  }
}

export interface MicrosoftWordListResponse extends ToolResponse {
  output: {
    documents: MicrosoftWordDocumentMetadata[]
    nextPageToken?: string
  }
}

export interface MicrosoftWordCreateFromTemplateResponse extends ToolResponse {
  output: {
    occurrencesChanged: number
    metadata: MicrosoftWordDocumentMetadata
  }
}

export interface MicrosoftWordReplaceTextResponse extends ToolResponse {
  output: {
    occurrencesChanged: number
    metadata: MicrosoftWordDocumentMetadata
  }
}

export interface MicrosoftWordExportPdfResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: string
      size: number
    }
  }
}
