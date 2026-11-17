import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseWorkspaceBase } from '../base'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'
import { type FileDecl, fileCodec, fileKeyConflicts } from './files'

const SHA = 'a'.repeat(64)

const segment = fc
  .stringMatching(/^[A-Za-z0-9 _()-][A-Za-z0-9 ._()-]{0,20}$/)
  .filter((value) => !/[ .]$/.test(value) && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(value))
const key = fc.array(segment, { minLength: 1, maxLength: 4 }).map((parts) => parts.join('/'))
const decl: fc.Arbitrary<FileDecl> = fc.record({
  sha256: fc.stringMatching(/^[0-9a-f]{64}$/),
  size: fc.integer({ min: 0, max: WORKSPACE_SOURCE_LIMITS.maxBlobBytes }),
})

function grouped(paths: string[]) {
  const result = fileCodec.group(paths)
  return {
    keys: [...result.groups.keys()],
    codes: result.diagnostics.map((finding) => finding.code),
  }
}

describe('fileCodec', () => {
  it('reads back every file it prints', () => {
    fc.assert(
      fc.property(key, decl, (path, file) => {
        const printed = fileCodec.print(path, file)
        const blobPaths = printed.blobs.map((blob) => blob.path)
        expect(grouped(blobPaths)).toEqual({ keys: [path], codes: [] })
        const parsed = fileCodec.parse(path, printed.text, printed.blobs)
        expect(parsed.diagnostics).toEqual([])
        expect(parsed.decl).toEqual(file)
      }),
      { numRuns: 300 }
    )
  })

  it.each([
    ['a dot-dot segment', 'files/../etc/passwd'],
    ['a dot segment', 'files/./a.txt'],
    ['an empty segment (absolute below files/)', 'files//etc/passwd'],
    ['a hidden name', 'files/.env'],
    ['NUL', 'files/a\u0000b.txt'],
    ['a control character', 'files/a\u0007.txt'],
    ['a backslash', 'files/a\\b.txt'],
    ['a reserved character', 'files/a:b.txt'],
    ['a reserved device name', 'files/docs/CON'],
    ['a reserved device name with an extension', 'files/nul.txt'],
    ['a trailing space', 'files/a.txt '],
    ['a trailing dot', 'files/notes.'],
    ['a name over 255 bytes', `files/${'é'.repeat(128)}.txt`],
  ])('refuses %s', (_, path) => {
    expect(grouped([path])).toEqual({ keys: [], codes: ['E_FILE_PATH'] })
  })

  it('refuses paths a case-insensitive disk holds as one file, and a file that is also a folder', () => {
    expect(grouped(['files/Report.pdf', 'files/report.PDF'])).toEqual({
      keys: ['Report.pdf'],
      codes: ['E_FILE_PATH_COLLISION'],
    })
    expect(grouped(['files/a.txt', 'files/a.txt'])).toEqual({
      keys: ['a.txt'],
      codes: ['E_FILE_PATH_COLLISION'],
    })
    expect(grouped(['files/docs', 'files/Docs/a.txt'])).toEqual({
      keys: ['docs'],
      codes: ['E_FILE_PATH_COLLISION'],
    })
  })

  it('refuses folders a case-insensitive disk holds as one folder', () => {
    expect(grouped(['files/Docs/a.txt', 'files/docs/b.txt'])).toEqual({
      keys: ['Docs/a.txt'],
      codes: ['E_FILE_PATH_COLLISION'],
    })
    expect(grouped(['files/a/Reports/x.pdf', 'files/a/reports/2024/y.pdf'])).toEqual({
      keys: ['a/Reports/x.pdf'],
      codes: ['E_FILE_PATH_COLLISION'],
    })
    expect(grouped(['files/Docs/a.txt', 'files/Docs/b.txt'])).toEqual({
      keys: ['Docs/a.txt', 'Docs/b.txt'],
      codes: [],
    })
  })

  it('names the file that already holds a path, whichever comes first', () => {
    expect(fileKeyConflicts(['docs/a.txt', 'Docs'])).toEqual(
      new Map([['Docs', expect.stringContaining('files/docs is a folder')]])
    )
    expect(fileKeyConflicts(['Docs', 'docs/a.txt'])).toEqual(
      new Map([['docs/a.txt', expect.stringContaining('files/Docs is a file')]])
    )
    expect(fileKeyConflicts(['Docs/a.txt', 'docs/b.txt'])).toEqual(
      new Map([['docs/b.txt', expect.stringContaining('files/Docs')]])
    )
  })

  it('refuses more files than one directory may hold', () => {
    const paths = Array.from(
      { length: WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind + 1 },
      (_, index) => `files/f${index}.txt`
    )
    expect(grouped(paths).codes).toEqual(['E_LIMIT_EXCEEDED'])
  })

  it('refuses a file sent as text, a malformed hash, and a file over the blob cap', () => {
    const path = 'files/a.txt'
    const codes = (text: Record<string, string>, blobs: Parameters<typeof fileCodec.parse>[2]) =>
      fileCodec.parse('a.txt', text, blobs).diagnostics.map((finding) => finding.code)
    expect(codes({ [path]: 'hello' }, [{ path, sha256: SHA, size: 5 }])).toEqual(['E_FILE_CONTENT'])
    expect(codes({}, [{ path, sha256: 'ABC', size: 1 }])).toEqual(['E_FILE_CONTENT'])
    expect(codes({}, [{ path, sha256: SHA, size: -1 }])).toEqual(['E_FILE_CONTENT'])
    expect(
      codes({}, [{ path, sha256: SHA, size: WORKSPACE_SOURCE_LIMITS.maxBlobBytes + 1 }])
    ).toEqual(['E_FILE_TOO_LARGE'])
  })

  it('fingerprints the bytes only', () => {
    expect(fileCodec.canonical({ sha256: SHA, size: 1 })).toEqual({ sha256: SHA })
  })
})

describe('a file in the base', () => {
  const entry = { id: 'wf_1', fingerprint: `rf1:${SHA}` }

  it('is addressed by its path', () => {
    const parsed = parseWorkspaceBase({
      version: 1,
      workspaceId: 'ws',
      resources: { 'file:reports/q1 summary.pdf': entry },
    })
    expect(parsed.base?.resources).toEqual({ 'file:reports/q1 summary.pdf': entry })
  })

  it.each(['file:../secrets', 'file:.sim/base.json', 'file:a\\b'])(
    'refuses the unsafe address %s',
    (address) => {
      const parsed = parseWorkspaceBase({
        version: 1,
        workspaceId: 'ws',
        resources: { [address]: entry },
      })
      expect(parsed.diagnostics?.map((finding) => finding.code)).toEqual(['E_BASE_SHAPE'])
    }
  )
})
