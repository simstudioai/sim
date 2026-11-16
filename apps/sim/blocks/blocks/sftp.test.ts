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
