import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { traceSpansSchema } from '@/lib/api/contracts/logs'
import { v2ListLogsQuerySchema } from '@/lib/api/contracts/v2/logs'
import {
  V2_FALSE_VALUES,
  V2_TRUE_VALUES,
  v2DeleteFolderQuerySchema,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2NonRootFolderPathInputSchema,
  v2NonRootFolderPathSchema,
  v2RelocateFolderBodySchema,
} from '@/lib/api/contracts/v2/shared'
import { MAX_FOLDER_PATH_BYTES, MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

describe('v2 folder path contracts', () => {
  it('accepts slashless paths and normalizes them to the canonical form', () => {
    expect(v2FolderPathInputSchema.parse('Reports/Q1')).toBe('/Reports/Q1')
    expect(v2FolderPathInputSchema.parse('/Reports/Q1')).toBe('/Reports/Q1')
    expect(v2NonRootFolderPathInputSchema.parse('Reports')).toBe('/Reports')
  })

  it('does not treat an empty path as the workspace root', () => {
    expect(v2FolderPathInputSchema.safeParse('').success).toBe(false)
    expect(v2NonRootFolderPathInputSchema.safeParse('/').success).toBe(false)
  })

  it('still rejects noncanonical path syntax after adding the leading slash', () => {
    expect(v2FolderPathInputSchema.safeParse('Reports/').success).toBe(false)
    expect(v2FolderPathInputSchema.safeParse('Reports//Q1').success).toBe(false)
    expect(v2FolderPathInputSchema.safeParse('Reports/%71').success).toBe(false)
  })

  it('keeps response paths strict and fail-fast', () => {
    expect(v2FolderPathSchema.safeParse('Reports').success).toBe(false)
    expect(v2NonRootFolderPathSchema.safeParse('Reports').success).toBe(false)
  })

  it('compares normalized paths in cross-field validation', () => {
    expect(
      v2RelocateFolderBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        path: 'Reports',
        destinationPath: '/Reports',
      }).success
    ).toBe(false)
  })

  /**
   * The published `enum` is a restatement of `z.stringbool()`'s internal
   * vocabulary, which contributes nothing to JSON Schema. Parsing every listed
   * spelling here is what keeps the restatement honest through a Zod upgrade —
   * and this is a destructive switch, so a spelling the spec advertises but the
   * server rejects is worse than an undocumented one — and on a destructive
   * switch so is the reverse: a spelling the server honours but the spec does
   * not list is a recursive delete a generated client would have refused to
   * send. `recursive` is therefore case-SENSITIVE, accepting exactly the twelve
   * published spellings and nothing else.
   */
  it('accepts every spelling of `recursive` it publishes, and only those', () => {
    const published = z.toJSONSchema(v2DeleteFolderQuerySchema, {
      io: 'input',
      unrepresentable: 'any',
    })
    const declared = (published.properties as Record<string, { enum?: string[] }>).recursive.enum

    expect(declared).toEqual([...V2_TRUE_VALUES, ...V2_FALSE_VALUES])
    for (const value of V2_TRUE_VALUES) {
      expect(
        v2DeleteFolderQuerySchema.parse({ workspaceId: WORKSPACE_ID, path: '/R', recursive: value })
          .recursive
      ).toBe(true)
    }
    for (const value of V2_FALSE_VALUES) {
      expect(
        v2DeleteFolderQuerySchema.parse({ workspaceId: WORKSPACE_ID, path: '/R', recursive: value })
          .recursive
      ).toBe(false)
    }
    for (const value of ['True', 'TRUE', 'YES', 'On', 'Y', 'ENABLED', 'maybe']) {
      expect(
        v2DeleteFolderQuerySchema.safeParse({
          workspaceId: WORKSPACE_ID,
          path: '/R',
          recursive: value,
        }).success
      ).toBe(false)
    }
  })

  /**
   * The canonical-path rule is enforced in a `superRefine`, which publishes
   * nothing, so it lived only in the implementation until it was written onto
   * these two components. Pinning the published text against the constants that
   * enforce the caps keeps the prose from outliving a bound change.
   */
  it('publishes the canonical-path rule and the byte cap on every path schema', () => {
    for (const schema of [
      v2FolderPathSchema,
      v2NonRootFolderPathSchema,
      v2FolderPathInputSchema,
      v2NonRootFolderPathInputSchema,
    ]) {
      const published = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
      expect(published.maxLength).toBe(MAX_FOLDER_PATH_BYTES)
      expect(published.description).toContain('percent-encoded')
      expect(published.description).toContain(String(MAX_FOLDER_PATH_SEGMENTS))
      expect(published.description).toContain(String(MAX_FOLDER_PATH_BYTES))
    }
  })

  it('defaults folder deletion to non-recursive', () => {
    expect(v2DeleteFolderQuerySchema.parse({ workspaceId: WORKSPACE_ID, path: 'Reports' })).toEqual(
      { workspaceId: WORKSPACE_ID, path: '/Reports', recursive: false }
    )
  })

  it('normalizes every folder path in the logs filter', () => {
    const query = v2ListLogsQuerySchema.parse({
      workspaceId: WORKSPACE_ID,
      folderPaths: 'Reports/Q1,/Archive',
    })

    expect(query.folderPaths).toBe('/Reports/Q1,/Archive')
  })

  it('declares persisted trace cost and error metadata', () => {
    const [span] = traceSpansSchema.parse([
      {
        id: 'span-1',
        name: 'Agent',
        type: 'agent',
        errorHandled: true,
        errorType: 'RateLimitError',
        errorMessage: 'Rate limited',
        cost: { input: 0.001, output: 0.002, toolCost: 0.01, total: 0.013 },
      },
    ])

    expect(span).toMatchObject({
      errorHandled: true,
      errorType: 'RateLimitError',
      errorMessage: 'Rate limited',
      cost: { input: 0.001, output: 0.002, toolCost: 0.01, total: 0.013 },
    })
  })
})
