/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { fileManageEditBodySchema } from '@/lib/api/contracts/tools/file'
import { fileEditTool } from '@/tools/file/edit'

describe('fileEditTool', () => {
  it('sends exact replacement and multi-folder scope in one operation', () => {
    const input = fileEditTool.operation.input({
      fileName: 'notes.md',
      folderPaths: ['/Reports', '/Archive'],
      includeSubfolders: false,
      mode: 'search_replace',
      search: 'old',
      content: 'new',
      replaceAll: true,
    })

    expect(fileManageEditBodySchema.parse(input)).toMatchObject({
      operation: 'edit',
      folderPaths: ['/Reports', '/Archive'],
      includeSubfolders: false,
      mode: 'search_replace',
      search: 'old',
      content: 'new',
      replaceAll: true,
    })
  })

  it('sends anchored replacement with occurrence in one operation', () => {
    const input = fileEditTool.operation.input({
      fileName: 'notes.md',
      folderPath: '/Reports',
      mode: 'replace_between',
      beforeAnchor: '## Start',
      afterAnchor: '## End',
      content: 'replacement',
      occurrence: 2,
    })

    expect(fileManageEditBodySchema.parse(input)).toMatchObject({
      mode: 'replace_between',
      beforeAnchor: '## Start',
      afterAnchor: '## End',
      content: 'replacement',
      occurrence: 2,
    })
  })

  it('omits content from an anchored deletion', () => {
    const input = fileEditTool.operation.input({
      fileName: 'notes.md',
      mode: 'delete_between',
      startAnchor: '<!-- start -->',
      endAnchor: '<!-- end -->',
    })

    expect(input).not.toHaveProperty('content')
    expect(fileManageEditBodySchema.safeParse(input).success).toBe(true)
  })
})
