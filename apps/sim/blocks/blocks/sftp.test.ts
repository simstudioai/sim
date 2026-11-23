import { describe, expect, it } from 'vitest'
import { SftpV2Block } from '@/blocks/blocks/sftp'

/**
 * On an agent tool call the operation arrives only on `context`, and the create-directory tool row
 * has no Create Parent Directories field, so the mapper applies the switch's default.
 */
describe('SftpV2Block agent tool calls', () => {
  it('creates parent directories by default on a create-directory call', () => {
    const merged = { host: 'h', username: 'u', password: 'p', remotePath: '/a/b' }
    expect({
      ...merged,
      ...SftpV2Block.tools.config?.params?.(merged, { operation: 'sftp_mkdir' }),
    }).toMatchObject({ recursive: true })
  })
  it('keeps recursive: false the model supplied on a create-directory call', () => {
    const merged = {
      host: 'h',
      username: 'u',
      password: 'p',
      remotePath: '/a/b',
      recursive: false,
    }
    expect({
      ...merged,
      ...SftpV2Block.tools.config?.params?.(merged, { operation: 'sftp_mkdir' }),
    }).toMatchObject({ recursive: false })
  })
})

/** The executor sends `{ ...storedInputs, ...mapped }`, so a value stored for another operation must not leak in. */
describe('SftpV2Block canvas runs', () => {
  const stored = {
    host: 'h',
    username: 'u',
    password: 'p',
    remotePath: '/upload',
    files: [{ name: 'report.csv', key: 'k', url: 'u', size: 1, type: 'text/csv' }],
    fileContent: 'stale content',
    fileName: 'stale.txt',
  }
  const run = (operation: string) => {
    const inputs = { ...stored, operation }
    return { ...inputs, ...SftpV2Block.tools.config?.params?.(inputs) }
  }

  it('does not write the Create File content on an Upload Files run', () => {
    expect(run('sftp_upload')).toMatchObject({ fileContent: undefined, fileName: undefined })
  })

  it('does not upload the Upload Files files on a Create File run', () => {
    expect(run('sftp_create')).toMatchObject({ files: undefined, fileName: 'stale.txt' })
  })

  it('keeps direct content the model sends on an upload tool call', () => {
    const args = { host: 'h', username: 'u', password: 'p', remotePath: '/a' }
    expect(
      SftpV2Block.tools.config?.params?.(
        { ...args, fileContent: 'hi', fileName: 'a.txt' },
        { operation: 'sftp_upload' }
      )
    ).toMatchObject({ fileContent: 'hi', fileName: 'a.txt' })
  })

  it('does not send a stored private key once the block is switched to password auth', () => {
    const inputs = {
      ...stored,
      operation: 'sftp_list',
      authMethod: 'password',
      privateKey: 'stale key',
    }
    expect({ ...inputs, ...SftpV2Block.tools.config?.params?.(inputs) }).toMatchObject({
      password: 'p',
      privateKey: undefined,
    })
  })
})
