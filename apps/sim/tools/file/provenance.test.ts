/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { fileAppendTool } from '@/tools/file/append'
import { fileEditTool } from '@/tools/file/edit'
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

  it('tracks replacement content but gives a content-free deletion no provenance selection', () => {
    const select = fileEditTool.operation.secretProvenance?.request
    expect(select).toBeDefined()
    expect(
      select?.({
        fileName: 'self.md',
        mode: 'replace_between',
        beforeAnchor: 'before',
        afterAnchor: 'after',
        content: 'private replacement',
      })
    ).toEqual([{ key: 'content', inputPaths: [['content']] }])
    expect(
      select?.({
        fileName: 'self.md',
        mode: 'delete_between',
        startAnchor: 'start',
        endAnchor: 'end',
      })
    ).toEqual([])
  })
})
