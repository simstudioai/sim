import type {
  MicrosoftGraphDriveItem,
  MicrosoftGraphIdentitySet,
  OneDriveIdentity,
  OneDriveParentReference,
  OneDriveToolParams,
} from '@/tools/onedrive/types'
import type { OutputProperty } from '@/tools/types'

/**
 * driveItem properties requested by the list, search, and get-item tools.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/resources/driveitem
 */
export const DRIVE_ITEM_SELECT =
  'id,name,file,folder,webUrl,size,createdDateTime,lastModifiedDateTime,parentReference,createdBy,lastModifiedBy,description,eTag,@microsoft.graph.downloadUrl'

/** Projects a Graph `identitySet` onto its acting identity (user, then application, then device). */
export function toIdentity(
  identitySet: MicrosoftGraphIdentitySet | undefined
): OneDriveIdentity | null {
  const identity = identitySet?.user ?? identitySet?.application ?? identitySet?.device
  if (!identity) return null
  return { id: identity.id ?? null, displayName: identity.displayName ?? null }
}

/** Projects a Graph `itemReference` onto its documented fields. */
export function toParentReference(
  reference: MicrosoftGraphDriveItem['parentReference']
): OneDriveParentReference | null {
  if (!reference) return null
  return {
    id: reference.id ?? null,
    driveId: reference.driveId ?? null,
    driveType: reference.driveType ?? null,
    name: reference.name ?? null,
    path: reference.path ?? null,
    siteId: reference.siteId ?? null,
  }
}

/**
 * driveItem metadata returned alongside the original file fields: folder facet,
 * description, eTag, and the creating and last-modifying identities.
 */
export function driveItemDetails(
  item: Pick<
    MicrosoftGraphDriveItem,
    'folder' | 'description' | 'eTag' | 'createdBy' | 'lastModifiedBy'
  >
) {
  return {
    isFolder: Boolean(item.folder),
    childCount: item.folder?.childCount ?? null,
    description: item.description ?? null,
    eTag: item.eTag ?? null,
    createdBy: toIdentity(item.createdBy),
    lastModifiedBy: toIdentity(item.lastModifiedBy),
  }
}

/** Projects a driveItem onto the file shape the list, search, and get-item tools return. */
export function toOneDriveFile(item: MicrosoftGraphDriveItem) {
  return {
    id: item.id,
    name: item.name,
    mimeType: item.file?.mimeType || (item.folder ? 'application/folder' : 'unknown'),
    webViewLink: item.webUrl,
    webContentLink: item['@microsoft.graph.downloadUrl'],
    size: item.size?.toString() || '0',
    createdTime: item.createdDateTime,
    modifiedTime: item.lastModifiedDateTime,
    parents: item.parentReference ? [item.parentReference.id] : [],
    ...driveItemDetails(item),
    parentReference: toParentReference(item.parentReference),
  }
}

/** Tool output properties for a file object returned by {@link toOneDriveFile}. */
export const ONEDRIVE_FILE_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'The drive item ID' },
  name: { type: 'string', description: 'The file or folder name' },
  mimeType: {
    type: 'string',
    description: 'The file MIME type ("application/folder" for folders)',
  },
  webViewLink: { type: 'string', description: 'Browser URL for the item', optional: true },
  webContentLink: {
    type: 'string',
    description: 'Short-lived pre-authenticated download URL (files only)',
    optional: true,
  },
  size: { type: 'string', description: 'Size in bytes', optional: true },
  createdTime: { type: 'string', description: 'ISO 8601 creation time', optional: true },
  modifiedTime: { type: 'string', description: 'ISO 8601 last modification time', optional: true },
  parents: { type: 'array', description: 'Parent folder IDs', optional: true },
  isFolder: { type: 'boolean', description: 'Whether the item is a folder', optional: true },
  childCount: {
    type: 'number',
    description: 'Number of direct children (folders only)',
    optional: true,
    nullable: true,
  },
  description: {
    type: 'string',
    description: 'User-visible description (OneDrive Personal only)',
    optional: true,
    nullable: true,
  },
  eTag: {
    type: 'string',
    description: 'eTag for the item (metadata and content)',
    optional: true,
    nullable: true,
  },
  parentReference: {
    type: 'object',
    description: 'Parent location (id, driveId, driveType, name, path, siteId)',
    optional: true,
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'Identity that created the item (id, displayName)',
    optional: true,
    nullable: true,
  },
  lastModifiedBy: {
    type: 'object',
    description: 'Identity that last modified the item (id, displayName)',
    optional: true,
    nullable: true,
  },
}

/**
 * Escapes a value for embedding in an OData string literal (e.g. search(q='...'),
 * $filter startswith(name,'...')). OData V4 escapes a literal single quote by doubling
 * it — encodeURIComponent does not touch `'`, so this must run before URL-encoding.
 */
export function escapeODataStringLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

export type ExcelCell = string | number | boolean | null
export type ExcelArrayValues = ExcelCell[][]
export type ExcelObjectValues = Array<Record<string, ExcelCell>>
export type NormalizedExcelValues = ExcelArrayValues | ExcelObjectValues

/**
 * Ensures Excel values are always represented as arrays before hitting downstream tooling.
 * Accepts JSON strings, array-of-arrays, or array-of-objects and normalizes them.
 */
export function normalizeExcelValues(values: unknown): NormalizedExcelValues | undefined {
  if (values === null || values === undefined) {
    return undefined
  }

  if (typeof values === 'string') {
    const trimmed = values.trim()
    if (!trimmed) {
      return undefined
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) {
        throw new Error('Excel values must be an array of rows or array of objects')
      }
      return parsed as NormalizedExcelValues
    } catch (_error) {
      throw new Error('Invalid JSON format for values')
    }
  }

  if (Array.isArray(values)) {
    return values as NormalizedExcelValues
  }

  throw new Error('Excel values must be an array of rows or array of objects')
}

/**
 * Convenience helper for contexts that expect the narrower ToolParams typing.
 */
export function normalizeExcelValuesForToolParams(
  values: unknown
): OneDriveToolParams['values'] | undefined {
  const normalized = normalizeExcelValues(values)
  return normalized as OneDriveToolParams['values'] | undefined
}
