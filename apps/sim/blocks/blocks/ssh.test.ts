import { describe, expect, it } from 'vitest'
import { SSHBlock, SSHV2Block } from '@/blocks/blocks/ssh'

describe('SSH block versions', () => {
  it('preserves legacy blocks and offers v2 for new blocks', () => {
    expect(SSHBlock.hideFromToolbar).toBe(true)
    expect(SSHBlock.sunset).toEqual({ status: 'legacy', replacedBy: 'ssh_v2' })
    expect(SSHV2Block.hideFromToolbar).toBe(false)
    expect(SSHV2Block.sunset).toBeUndefined()
    expect(SSHV2Block.name).toBe('SSH')
    expect(SSHV2Block.subBlocks).toBe(SSHBlock.subBlocks)
    expect(SSHV2Block.tools.config?.params).toBe(SSHBlock.tools.config.params)
    expect(SSHV2Block.canvasPresentation).toBe(SSHBlock.canvasPresentation)
  })

  it.each(SSHBlock.tools.access)('versions only the download operation: %s', (operation) => {
    const currentId = operation === 'ssh_download_file' ? 'ssh_download_file_v2' : operation
    expect(SSHBlock.tools.config.tool({ operation })).toBe(operation)
    expect(SSHV2Block.tools.config?.tool({ operation })).toBe(currentId)
    expect(SSHV2Block.tools.access).toContain(currentId)
  })

  it('preserves the command default and explicit read-content operation', () => {
    expect(SSHV2Block.tools.config?.tool({})).toBe('ssh_execute_command')
    expect(SSHV2Block.outputs).not.toHaveProperty('fileContent')
    expect(SSHV2Block.outputs.file.type).toBe('file')
    expect(SSHV2Block.outputs.content.condition).toEqual({
      field: 'operation',
      value: 'ssh_read_file_content',
    })
  })
})
