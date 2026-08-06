import { describe, expect, it } from 'vitest'
import { traceSpansSchema } from '@/lib/api/contracts/logs'
import { v2ListLogsQuerySchema } from '@/lib/api/contracts/v2/logs'
import {
  v2DeleteFolderQuerySchema,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2NonRootFolderPathInputSchema,
  v2NonRootFolderPathSchema,
  v2RelocateFolderBodySchema,
} from '@/lib/api/contracts/v2/shared'

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
