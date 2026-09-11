import { describe, expect, it } from 'vitest'
import { SftpBlock, SftpV2Block } from '@/blocks/blocks/sftp'

describe('SFTP block versions', () => {
  it('preserves legacy blocks and offers v2 for new blocks', () => {
    expect(SftpBlock.hideFromToolbar).toBe(true)
    expect(SftpBlock.sunset).toEqual({ status: 'legacy', replacedBy: 'sftp_v2' })
    expect(SftpV2Block.hideFromToolbar).toBe(false)
    expect(SftpV2Block.sunset).toBeUndefined()
    expect(SftpV2Block.name).toBe('SFTP')
    expect(SftpV2Block.canvasPresentation).toBe(SftpBlock.canvasPresentation)
  })

  it.each(SftpBlock.tools.access)('versions only the download operation: %s', (operation) => {
    const currentId = operation === 'sftp_download' ? 'sftp_download_v2' : operation
    expect(SftpBlock.tools.config.tool({ operation })).toBe(operation)
    expect(SftpV2Block.tools.config?.tool({ operation })).toBe(currentId)
    expect(SftpV2Block.tools.access).toContain(currentId)
  })

  it('preserves defaults and the create-file alias', () => {
    expect(SftpV2Block.tools.config?.tool({})).toBe('sftp_upload')
    expect(SftpV2Block.tools.config?.tool({ operation: 'sftp_create' })).toBe('sftp_upload')
  })

  it('removes download encoding and inline content from v2', () => {
    expect(SftpBlock.subBlocks.some((subBlock) => subBlock.id === 'encoding')).toBe(true)
    expect(SftpV2Block.subBlocks.some((subBlock) => subBlock.id === 'encoding')).toBe(false)
    expect(SftpV2Block.inputs).not.toHaveProperty('encoding')
    expect(SftpV2Block.outputs).not.toHaveProperty('content')
    expect(SftpV2Block.outputs).not.toHaveProperty('fileName')
    expect(SftpV2Block.outputs).not.toHaveProperty('size')
    for (const key of ['success', 'message']) {
      expect(SftpV2Block.outputs[key].condition).toEqual({
        field: 'operation',
        value: 'sftp_download',
        not: true,
      })
    }
    expect(SftpV2Block.outputs.file.type).toBe('file')
    const params = {
      operation: 'sftp_download',
      host: 'sftp.example.com',
      port: '22',
      username: 'user',
      password: 'test-password',
      remotePath: '/file.txt',
      encoding: 'base64',
    }
    expect(SftpBlock.tools.config.params(params)).toHaveProperty('encoding', 'base64')
    expect(SftpV2Block.tools.config?.params?.(params)).toEqual({
      host: 'sftp.example.com',
      port: 22,
      username: 'user',
      password: 'test-password',
      remotePath: '/file.txt',
    })
  })
})
