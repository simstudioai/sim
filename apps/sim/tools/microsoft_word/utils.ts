import { validatePathSegment } from '@/lib/core/security/input-validation'
import { GRAPH_ID_PATTERN } from '@/tools/microsoft_excel/utils'

export const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'

/**
 * Returns the Graph drive base path for a Word document.
 * With a `driveId` it targets `/drives/{driveId}` (SharePoint or a shared drive);
 * without one it targets `/me/drive` (the signed-in user's OneDrive).
 */
export function getDriveBasePath(driveId?: string): string {
  const trimmed = driveId?.trim()
  if (!trimmed) return `${GRAPH_BASE_URL}/me/drive`

  const validation = validatePathSegment(trimmed, {
    paramName: 'driveId',
    customPattern: GRAPH_ID_PATTERN,
  })
  if (!validation.isValid) {
    throw new Error(validation.error)
  }
  return `${GRAPH_BASE_URL}/drives/${trimmed}`
}

/**
 * Returns the Graph item path for a drive item, validating both identifiers.
 * `itemLabel` names the field in any validation error, so a bad folder id does
 * not surface as a complaint about a document id.
 */
export function getItemBasePath(
  itemId: string,
  driveId?: string,
  itemLabel = 'documentId'
): string {
  const trimmed = itemId?.trim()
  if (!trimmed) {
    throw new Error(`${itemLabel} is required`)
  }

  const validation = validatePathSegment(trimmed, {
    paramName: itemLabel,
    customPattern: GRAPH_ID_PATTERN,
  })
  if (!validation.isValid) {
    throw new Error(validation.error)
  }

  return `${getDriveBasePath(driveId)}/items/${trimmed}`
}

/** Returns the Graph item path for a Word document. */
export function getDocumentBasePath(documentId: string, driveId?: string): string {
  return getItemBasePath(documentId, driveId, 'documentId')
}

/** Returns the Graph item path for a folder that holds Word documents. */
export function getFolderBasePath(folderId: string, driveId?: string): string {
  return getItemBasePath(folderId, driveId, 'folderId')
}

/**
 * Ensures a document name ends in `.docx`. Graph derives a drive item's type
 * from its filename, so a missing extension would produce a file Word refuses
 * to open even though its bytes are a valid WordprocessingML package.
 */
export function ensureDocxExtension(name: string): string {
  const trimmed = name.trim()
  return trimmed.toLowerCase().endsWith('.docx') ? trimmed : `${trimmed}.docx`
}
