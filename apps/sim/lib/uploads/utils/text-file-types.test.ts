/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import {
  findTextFileTypeByExtension,
  findTextFileTypeById,
  resolveTextFileType,
  SELECTABLE_TEXT_FILE_TYPES,
  SELECTABLE_TEXT_MIME_TYPES,
  type TextFileType,
  withFileTypeExtension,
} from '@/lib/uploads/utils/text-file-types'
import { resolveFileCategory } from '@/app/workspace/[workspaceId]/files/components/file-viewer/file-category'

function typeById(id: string): TextFileType {
  const type = findTextFileTypeById(id)
  if (!type) throw new Error(`Unknown test fixture type: ${id}`)
  return type
}

describe('SELECTABLE_TEXT_FILE_TYPES invariants', () => {
  it('gives every entry a unique extension', () => {
    const extensions = SELECTABLE_TEXT_FILE_TYPES.map((type) => type.extension)
    expect(new Set(extensions).size).toBe(extensions.length)
  })

  it('gives every entry a unique id', () => {
    const ids = SELECTABLE_TEXT_FILE_TYPES.map((type) => type.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(SELECTABLE_TEXT_FILE_TYPES)(
    'resolves $label to the shared extension-to-MIME map',
    (type) => {
      expect(getMimeTypeFromExtension(type.extension)).toBe(type.mimeType)
    }
  )

  it.each(SELECTABLE_TEXT_FILE_TYPES)('opens $label in the text editor', (type) => {
    expect(resolveFileCategory(type.mimeType, `example.${type.extension}`)).toBe('text-editable')
  })

  it('exposes every entry MIME in the allowlist', () => {
    for (const type of SELECTABLE_TEXT_FILE_TYPES) {
      expect(SELECTABLE_TEXT_MIME_TYPES).toContain(type.mimeType)
    }
  })

  it('deduplicates MIMEs shared by several entries in the allowlist', () => {
    expect(new Set(SELECTABLE_TEXT_MIME_TYPES).size).toBe(SELECTABLE_TEXT_MIME_TYPES.length)
  })
})

describe('withFileTypeExtension', () => {
  it('swaps a simple extension', () => {
    expect(withFileTypeExtension('notes.md', typeById('json'))).toBe('notes.json')
  })

  it('swaps only the last segment of a multi-dot name', () => {
    expect(withFileTypeExtension('report.final.md', typeById('csv'))).toBe('report.final.csv')
  })

  it('appends to a name with no extension', () => {
    expect(withFileTypeExtension('notes', typeById('json'))).toBe('notes.json')
  })

  it('appends to a leading-dot name rather than consuming it', () => {
    expect(withFileTypeExtension('.gitignore', typeById('text'))).toBe('.gitignore.txt')
  })

  it('appends to a trailing-dot name rather than producing a double dot', () => {
    expect(withFileTypeExtension('notes.', typeById('markdown'))).toBe('notes..md')
  })

  it('preserves the base name case while writing a lowercase extension', () => {
    expect(withFileTypeExtension('NOTES.MD', typeById('json'))).toBe('NOTES.json')
  })

  it('is a no-op in effect when the type is unchanged', () => {
    expect(withFileTypeExtension('notes.md', typeById('markdown'))).toBe('notes.md')
  })
})

describe('resolveTextFileType', () => {
  it('resolves from the extension', () => {
    expect(resolveTextFileType('text/markdown', 'notes.md')?.id).toBe('markdown')
  })

  it('prefers the extension over a MIME shared by several types', () => {
    expect(resolveTextFileType('text/typescript', 'component.tsx')?.id).toBe('tsx')
    expect(resolveTextFileType('text/typescript', 'client.ts')?.id).toBe('typescript')
  })

  it('prefers the extension when a stale MIME disagrees with it', () => {
    expect(resolveTextFileType('text/markdown', 'data.csv')?.id).toBe('csv')
  })

  it('falls back to the MIME when the extension is unknown', () => {
    expect(resolveTextFileType('application/json', 'payload.unknownext')?.id).toBe('json')
  })

  it('falls back to the MIME when the name has no extension', () => {
    expect(resolveTextFileType('text/plain', 'README')?.id).toBe('text')
  })

  it('is case-insensitive on the extension', () => {
    expect(resolveTextFileType(null, 'NOTES.MD')?.id).toBe('markdown')
  })

  it('returns null for a type outside the registry', () => {
    expect(resolveTextFileType('application/pdf', 'report.pdf')).toBeNull()
    expect(resolveTextFileType(null, 'photo.png')).toBeNull()
    expect(resolveTextFileType(null, 'README')).toBeNull()
  })
})

describe('findTextFileTypeByExtension', () => {
  it('resolves a known extension', () => {
    expect(findTextFileTypeByExtension('yaml')?.mimeType).toBe('application/x-yaml')
  })

  it('is case-insensitive', () => {
    expect(findTextFileTypeByExtension('JSON')?.id).toBe('json')
  })

  it('returns null for an alias the registry never writes', () => {
    expect(findTextFileTypeByExtension('yml')).toBeNull()
  })

  it('returns null for an unknown extension', () => {
    expect(findTextFileTypeByExtension('pdf')).toBeNull()
    expect(findTextFileTypeByExtension('')).toBeNull()
  })
})
