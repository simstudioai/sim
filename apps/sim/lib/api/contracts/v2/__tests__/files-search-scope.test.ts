/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseFolderPathList, v2SearchFileContentQuerySchema } from '@/lib/api/contracts/v2/files'

const WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'

function parseQuery(folderPaths?: string) {
  return v2SearchFileContentQuerySchema.safeParse({
    workspaceId: WORKSPACE_ID,
    query: 'commitment',
    ...(folderPaths === undefined ? {} : { folderPaths }),
  })
}

describe('the search folder scope on the wire', () => {
  /*
   * The value stays a comma-separated STRING through parsing on purpose: the
   * client serializes the PARSED query, and repeat-appends a scalar array,
   * which v2 rejects as duplicate parameters. An array here would make every
   * multi-folder search a 400 no matter how the caller spelled it.
   */
  it('parses to a single string, not an array', () => {
    const parsed = parseQuery('/memory/user-a,/memory/user-b')

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.folderPaths).toBe('/memory/user-a,/memory/user-b')
  })

  it('accepts a single folder', () => {
    expect(parseQuery('/memory/user-a').success).toBe(true)
  })

  it('accepts the slash-omitted form the path schema normalizes', () => {
    expect(parseQuery('memory/user-a').success).toBe(true)
  })

  it('rejects a malformed entry among valid ones', () => {
    expect(parseQuery('/memory/user-a,//bad').success).toBe(false)
  })

  it('rejects a list that is only separators', () => {
    expect(parseQuery(',,').success).toBe(false)
  })

  it('rejects more than 64 entries', () => {
    const many = Array.from({ length: 65 }, (_, i) => `/f${i}`).join(',')

    expect(parseQuery(many).success).toBe(false)
  })

  it('leaves the scope absent when the parameter is omitted', () => {
    const parsed = parseQuery()

    expect(parsed.success && parsed.data.folderPaths).toBeUndefined()
  })
})

describe('parseFolderPathList', () => {
  /*
   * The regression this exists for: validating with the path schema and then
   * keeping the raw string discarded the normalization, so `Reports` reached
   * folder resolution unnormalized and matched nothing.
   */
  it('normalizes a slash-omitted entry', () => {
    expect(parseFolderPathList('memory/user-a')).toEqual(['/memory/user-a'])
  })

  it('leaves an already-canonical entry alone', () => {
    expect(parseFolderPathList('/memory/user-a')).toEqual(['/memory/user-a'])
  })

  it('normalizes every entry of a list, and trims around the separators', () => {
    expect(parseFolderPathList('memory/user-a, /memory/user-b ')).toEqual([
      '/memory/user-a',
      '/memory/user-b',
    ])
  })

  it('does not split a percent-encoded comma inside a folder name', () => {
    expect(parseFolderPathList('/Finance%2CLegal,/Reports')).toEqual([
      '/Finance%2CLegal',
      '/Reports',
    ])
  })

  it('drops empty entries rather than emitting a blank scope', () => {
    expect(parseFolderPathList('/a,,/b')).toEqual(['/a', '/b'])
  })
})
