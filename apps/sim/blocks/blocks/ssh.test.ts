import { describe, expect, it } from 'vitest'
import { SSHBlock } from '@/blocks/blocks/ssh'

const CONNECTION = { host: 'example.com', port: 22, username: 'deploy', password: 'pw' }

/**
 * On an agent tool call the operation arrives only on `context` and the model sends the tool's
 * `path`, which the block collects under a per-operation field (`listPath`, `readPath`, ...).
 */
describe('SSH block agent tool calls', () => {
  it('keeps the model path and coerces maxSize when reading a file', () => {
    const merged = { ...CONNECTION, path: '/etc/hosts', maxSize: '5' }
    const mapped = SSHBlock.tools.config.params(merged, { operation: 'ssh_read_file_content' })
    expect({ ...merged, ...mapped }).toMatchObject({ path: '/etc/hosts', maxSize: 5 })
  })
})

/** The executor sends `{ ...storedInputs, ...mapped }`, so a value stored for another operation must not leak in. */
describe('SSH block canvas runs', () => {
  it('does not apply the upload permissions to Create Directory', () => {
    const stored = {
      ...CONNECTION,
      operation: 'ssh_create_directory',
      createPath: '/srv/app',
      permissions: '0644',
    }
    expect({ ...stored, ...SSHBlock.tools.config.params(stored) }.permissions).toBeUndefined()
  })

  it('does not apply the Move/Rename overwrite switch to Upload File', () => {
    const stored = {
      ...CONNECTION,
      operation: 'ssh_upload_file',
      fileContent: 'aGk=',
      fileName: 'a.txt',
      remotePath: '/srv/a.txt',
      overwrite: false,
    }
    expect({ ...stored, ...SSHBlock.tools.config.params(stored) }.overwrite).toBeUndefined()
  })

  it('keeps the model permissions and overwrite on an agent tool call', () => {
    const args = { ...CONNECTION, path: '/srv/app', permissions: '0700', overwrite: false }
    expect(
      SSHBlock.tools.config.params(args, { operation: 'ssh_create_directory' }).permissions
    ).toBe('0700')
    expect(SSHBlock.tools.config.params(args, { operation: 'ssh_upload_file' }).overwrite).toBe(
      false
    )
  })

  it('does not send a stored private key once the block is switched to password auth', () => {
    const stored = {
      ...CONNECTION,
      operation: 'ssh_get_system_info',
      authMethod: 'password',
      privateKey: 'stale key',
      passphrase: 'stale passphrase',
    }
    expect({ ...stored, ...SSHBlock.tools.config.params(stored) }).toMatchObject({
      password: 'pw',
      privateKey: undefined,
      passphrase: undefined,
    })
  })

  it('does not send a stored password once the block is switched to private key auth', () => {
    const stored = {
      ...CONNECTION,
      operation: 'ssh_get_system_info',
      authMethod: 'privateKey',
      privateKey: 'key',
    }
    expect({ ...stored, ...SSHBlock.tools.config.params(stored) }).toMatchObject({
      privateKey: 'key',
      password: undefined,
    })
  })
})
