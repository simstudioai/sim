/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { fileManageAppendBodySchema } from '@/lib/api/contracts/tools/file'
import { fileAppendTool } from '@/tools/file/append'

describe('fileAppendTool', () => {
  it('preserves a shallow folder scope at the operation boundary', () => {
    expect(
      fileAppendTool.operation.input({
        fileName: 'notes.md',
        folderPath: '/Reports',
        includeSubfolders: false,
        content: 'more',
      })
    ).toMatchObject({
      operation: 'append',
      folderPath: '/Reports',
      includeSubfolders: false,
    })
  })

  it('preserves a multi-folder scope at the operation boundary', () => {
    expect(
      fileAppendTool.operation.input({
        fileName: 'notes.md',
        folderPaths: ['/Reports', '/Archive'],
        content: 'more',
      })
    ).toMatchObject({
      operation: 'append',
      folderPaths: ['/Reports', '/Archive'],
    })
  })

  it('accepts one folder representation and rejects contradictory scopes', () => {
    expect(
      fileManageAppendBodySchema.safeParse({
        operation: 'append',
        fileName: 'notes.md',
        folderPaths: ['/Reports', '/Archive'],
        content: 'more',
      }).success
    ).toBe(true)
    expect(
      fileManageAppendBodySchema.safeParse({
        operation: 'append',
        fileName: 'notes.md',
        folderPath: '/Reports',
        folderPaths: ['/Archive'],
        content: 'more',
      }).success
    ).toBe(false)
  })
})
