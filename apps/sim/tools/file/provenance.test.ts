/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { fileAppendTool } from '@/tools/file/append'
import { fileWriteTool } from '@/tools/file/write'

describe('workspace file mutation provenance', () => {
  it('delegates append content provenance to the authenticated file operation', () => {
    const select = fileAppendTool.operation.secretProvenance?.request
    expect(select).toBeDefined()
    expect(
      select?.({
        fileName: 'public-name.txt',
        content: 'causal-content',
        workspaceId: 'workspace-id',
      })
    ).toEqual([{ key: 'content', inputPaths: [['content']] }])
  })

  it('tracks file-write content without changing existing filename behavior', () => {
    const select = fileWriteTool.operation.secretProvenance?.request
    expect(select).toBeDefined()
    expect(
      select?.({
        fileName: 'Reports/public-name.txt',
        content: 'causal-content',
        workspaceId: 'workspace-id',
      })
    ).toEqual([{ key: 'content', inputPaths: [['content']] }])
  })
})
