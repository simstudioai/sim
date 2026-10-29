import { type SQL, type SQLWrapper, sql } from 'drizzle-orm'
import {
  EXTENSION_TO_MIME,
  GENERIC_MIME_TYPES,
  MIME_TYPE_MAPPING,
  resolveEffectiveMimeType,
} from '@/lib/uploads/utils/file'
import { SUPPORTED_DOCUMENT_EXTENSIONS } from '@/lib/uploads/utils/validation'
import {
  FILE_BROWSER_MIME_LABELS,
  FILE_BROWSER_SIZE_BOUNDARIES,
  type FileBrowserSize,
  type FileBrowserType,
} from '@/lib/workspace-files/browser'

/**
 * The SQL the file browsers classify, label, and bucket files with — one spelling of the rules
 * `resolveEffectiveMimeType`, `fileBrowserTypeLabel`, and the browsers' filters apply, so the
 * Files page and the Project files page cannot drift apart.
 */

/** Each known extension's own MIME type: what a file declaring no format resolves to. */
const EFFECTIVE_EXTENSION_MIMES = JSON.stringify(
  Object.fromEntries(
    Object.keys(EXTENSION_TO_MIME).map((extension) => [
      extension,
      resolveEffectiveMimeType(null, `file.${extension}`),
    ])
  )
)
const LABELS = JSON.stringify(FILE_BROWSER_MIME_LABELS)
const GENERIC_MIME = resolveEffectiveMimeType(null, 'file')

function mimesOfKind(kind: 'audio' | 'video'): string[] {
  return Object.keys(MIME_TYPE_MAPPING).filter((mime) => MIME_TYPE_MAPPING[mime] === kind)
}

function list(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )
}

/** The extension `getFileExtension` reads: after the last `.`, lowercased; `''` without one. */
export function fileExtensionSql(name: SQLWrapper): SQL<string> {
  return sql<string>`(case when strpos(${name}, '.') > 0 then lower(regexp_replace(${name}, '^.*[.]', '')) else '' end)`
}

/**
 * The effective MIME type: `declared` when it names a format, else the extension's own. The
 * caller decides how `declared` is normalized — the Files page trims the stored type, as
 * `resolveEffectiveMimeType` does; the Project browser also lowercases it and drops parameters.
 */
export function effectiveMimeSql(declared: SQL, extension: SQL): SQL<string> {
  return sql<string>`(case when ${declared} not in ('', ${list([...GENERIC_MIME_TYPES])}) then ${declared}
    else coalesce(${EFFECTIVE_EXTENSION_MIMES}::jsonb ->> ${extension}, ${GENERIC_MIME}) end)`
}

/** The Type column label for a file of effective MIME type `mime` (see `fileBrowserTypeLabel`). */
export function fileTypeLabelSql(mime: SQL, extension: SQL, contentType: SQLWrapper): SQL<string> {
  return sql<string>`coalesce(${LABELS}::jsonb ->> ${mime},
    case when ${mime} like 'audio/%' then 'Audio' when ${mime} like 'video/%' then 'Video'
      when ${mime} like 'image/%' then 'Image' when ${extension} <> '' then upper(${extension})
      else coalesce(${contentType}, 'File') end)`
}

/** Whether a file of effective MIME type `mime` is of `kind`. */
export function fileKindSql(kind: FileBrowserType, mime: SQL, extension: SQL): SQL {
  if (kind === 'document') return sql`${extension} in (${list(SUPPORTED_DOCUMENT_EXTENSIONS)})`
  if (kind === 'image') return sql`${mime} like 'image/%'`
  return sql`lower(${mime}) in (${list(mimesOfKind(kind))})`
}

/** Whether a file of `size` bytes is in `bucket`. */
export function fileSizeBucketSql(bucket: FileBrowserSize, size: SQL): SQL {
  if (bucket === 'small') return sql`${size} < ${FILE_BROWSER_SIZE_BOUNDARIES.small}`
  if (bucket === 'medium') {
    return sql`${size} >= ${FILE_BROWSER_SIZE_BOUNDARIES.small} and ${size} <= ${FILE_BROWSER_SIZE_BOUNDARIES.medium}`
  }
  return sql`${size} > ${FILE_BROWSER_SIZE_BOUNDARIES.medium}`
}
