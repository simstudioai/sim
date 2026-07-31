/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { servedFolderResourceTypeSchema } from '@/lib/api/contracts/folders'

/**
 * These three cases together ARE the rolling-deploy contract for the folder engine, so they
 * are pinned rather than left implicit in `.default()`.
 */
describe('servedFolderResourceTypeSchema', () => {
  it('defaults an omitted value to workflow, so a client that predates the field still works', () => {
    expect(servedFolderResourceTypeSchema.parse(undefined)).toBe('workflow')
  })

  it('rejects a present-but-unrecognized value rather than coercing it to workflow', () => {
    // Coercing would file a knowledge-base folder into the workflow tree, where the
    // Knowledge page can never see it again. A 400 is the only safe answer.
    expect(servedFolderResourceTypeSchema.safeParse('bogus').success).toBe(false)
    expect(servedFolderResourceTypeSchema.safeParse('').success).toBe(false)
  })

  it('accepts every tree the engine serves', () => {
    for (const value of ['workflow', 'knowledge_base', 'table'] as const) {
      expect(servedFolderResourceTypeSchema.parse(value)).toBe(value)
    }
  })

  it('does not serve file folders, which keep their own locked routes', () => {
    // File folders live in `folder` after the cutover, but Files serializes every mutation
    // behind an advisory lock and forbids `/` in names because a name is a path segment.
    // Serving them here would be a second writer with neither property.
    expect(servedFolderResourceTypeSchema.safeParse('file').success).toBe(false)
  })
})
