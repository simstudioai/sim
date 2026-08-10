import { getFileExtension } from '@/lib/uploads/utils/file-utils'

/**
 * A file type the user can switch a workspace file to from the file-detail header.
 *
 * Every entry is text-editable — see `resolveFileCategory` — so switching between them only
 * rewrites the name's extension and the stored `contentType`. The bytes are never touched and no
 * binary format is selectable, which is what keeps a "change type" action from being a lossy
 * format conversion in disguise.
 */
export interface TextFileType {
  /** Stable key, and the value the header's radio group selects on. */
  id: string
  /** Shown in the type picker, and used as the label in the file list's Type column. */
  label: string
  /** Canonical extension, no leading dot. Unique across the registry. */
  extension: string
  /** Not unique — `ts` and `tsx` are both `text/typescript`. See {@link resolveTextFileType}. */
  mimeType: string
  /** Which submenu group the type is offered in. */
  group: 'document' | 'code'
}

/**
 * The selectable types, in menu order. Every `mimeType` here is taken from `EXTENSION_TO_MIME` in
 * `file-utils.ts` rather than invented, so a retype produces a name and type the shared upload
 * helpers already agree on.
 *
 * Code extensions that `EXTENSION_TO_MIME` does not know (`fish`, `graphql`, `dockerfile`,
 * `makefile`, `mdx`, …) are deliberately absent: they resolve to `application/octet-stream`, which
 * would store a file the viewer then refuses to open.
 */
export const SELECTABLE_TEXT_FILE_TYPES = [
  {
    id: 'markdown',
    label: 'Markdown',
    extension: 'md',
    mimeType: 'text/markdown',
    group: 'document',
  },
  { id: 'text', label: 'Text', extension: 'txt', mimeType: 'text/plain', group: 'document' },
  { id: 'csv', label: 'CSV', extension: 'csv', mimeType: 'text/csv', group: 'document' },
  { id: 'json', label: 'JSON', extension: 'json', mimeType: 'application/json', group: 'document' },
  {
    id: 'yaml',
    label: 'YAML',
    extension: 'yaml',
    mimeType: 'application/x-yaml',
    group: 'document',
  },
  { id: 'html', label: 'HTML', extension: 'html', mimeType: 'text/html', group: 'document' },
  { id: 'xml', label: 'XML', extension: 'xml', mimeType: 'application/xml', group: 'document' },
  {
    id: 'mermaid',
    label: 'Mermaid',
    extension: 'mmd',
    mimeType: 'text/x-mermaid',
    group: 'document',
  },
  { id: 'svg', label: 'SVG', extension: 'svg', mimeType: 'image/svg+xml', group: 'document' },

  {
    id: 'typescript',
    label: 'TypeScript',
    extension: 'ts',
    mimeType: 'text/typescript',
    group: 'code',
  },
  { id: 'tsx', label: 'TSX', extension: 'tsx', mimeType: 'text/typescript', group: 'code' },
  {
    id: 'javascript',
    label: 'JavaScript',
    extension: 'js',
    mimeType: 'text/javascript',
    group: 'code',
  },
  { id: 'jsx', label: 'JSX', extension: 'jsx', mimeType: 'text/javascript', group: 'code' },
  { id: 'python', label: 'Python', extension: 'py', mimeType: 'text/x-python', group: 'code' },
  { id: 'go', label: 'Go', extension: 'go', mimeType: 'text/x-go', group: 'code' },
  { id: 'rust', label: 'Rust', extension: 'rs', mimeType: 'text/x-rust', group: 'code' },
  { id: 'java', label: 'Java', extension: 'java', mimeType: 'text/x-java', group: 'code' },
  { id: 'kotlin', label: 'Kotlin', extension: 'kt', mimeType: 'text/x-kotlin', group: 'code' },
  { id: 'swift', label: 'Swift', extension: 'swift', mimeType: 'text/x-swift', group: 'code' },
  { id: 'c', label: 'C', extension: 'c', mimeType: 'text/x-c', group: 'code' },
  { id: 'cpp', label: 'C++', extension: 'cpp', mimeType: 'text/x-c++', group: 'code' },
  { id: 'csharp', label: 'C#', extension: 'cs', mimeType: 'text/x-csharp', group: 'code' },
  { id: 'ruby', label: 'Ruby', extension: 'rb', mimeType: 'text/x-ruby', group: 'code' },
  { id: 'php', label: 'PHP', extension: 'php', mimeType: 'text/x-php', group: 'code' },
  { id: 'shell', label: 'Shell', extension: 'sh', mimeType: 'text/x-shellscript', group: 'code' },
  { id: 'sql', label: 'SQL', extension: 'sql', mimeType: 'text/x-sql', group: 'code' },
  { id: 'toml', label: 'TOML', extension: 'toml', mimeType: 'text/x-toml', group: 'code' },
  { id: 'css', label: 'CSS', extension: 'css', mimeType: 'text/css', group: 'code' },
  { id: 'scss', label: 'SCSS', extension: 'scss', mimeType: 'text/x-scss', group: 'code' },
] as const satisfies readonly TextFileType[]

/** Every MIME a retype may store. The allowlist the rename contract validates against. */
export const SELECTABLE_TEXT_MIME_TYPES: readonly string[] = Array.from(
  new Set(SELECTABLE_TEXT_FILE_TYPES.map((type) => type.mimeType))
)

const TYPE_BY_ID = new Map<string, TextFileType>(
  SELECTABLE_TEXT_FILE_TYPES.map((type) => [type.id, type])
)

const TYPE_BY_EXTENSION = new Map<string, TextFileType>(
  SELECTABLE_TEXT_FILE_TYPES.map((type) => [type.extension, type])
)

/** First entry wins, so the MIME fallback resolves to the type listed first for a shared MIME. */
const TYPE_BY_MIME = new Map<string, TextFileType>()
for (const type of SELECTABLE_TEXT_FILE_TYPES) {
  if (!TYPE_BY_MIME.has(type.mimeType)) TYPE_BY_MIME.set(type.mimeType, type)
}

export function findTextFileTypeById(id: string): TextFileType | null {
  return TYPE_BY_ID.get(id) ?? null
}

export function findTextFileTypeByExtension(extension: string): TextFileType | null {
  return TYPE_BY_EXTENSION.get(extension.toLowerCase()) ?? null
}

/**
 * The registry entry a file currently is, or null when it is not one of the selectable types.
 *
 * Extension first, MIME second — the inverse of `resolveFileCategory`, and deliberately so. The
 * extension is the registry's unique key and always resolves a single entry; the MIME does not
 * (`ts` and `tsx` are both `text/typescript`, and `sh` stands in for `bash`/`zsh`). Since the
 * server keeps name and `contentType` in agreement on every write, the two orders can only differ
 * for older rows where a rename left them diverged — and there the extension is the one the user
 * can actually see.
 */
export function resolveTextFileType(
  mimeType: string | null | undefined,
  filename: string
): TextFileType | null {
  const byExtension = findTextFileTypeByExtension(getFileExtension(filename))
  if (byExtension) return byExtension
  return mimeType ? (TYPE_BY_MIME.get(mimeType) ?? null) : null
}

/**
 * Swaps a file name's extension for `type`'s.
 *
 * The last dot wins, matching `withCopySuffix` in the workspace file manager, so
 * `report.final.md` becomes `report.final.json` rather than `report.json`. A name with no
 * extension, a leading-dot name, or a trailing-dot name gains the extension instead of losing a
 * segment: `notes` becomes `notes.json`, and `.gitignore` becomes `.gitignore.json`.
 */
export function withFileTypeExtension(name: string, type: TextFileType): string {
  const lastDot = name.lastIndexOf('.')
  const hasExtension = lastDot > 0 && lastDot < name.length - 1
  return `${hasExtension ? name.slice(0, lastDot) : name}.${type.extension}`
}
