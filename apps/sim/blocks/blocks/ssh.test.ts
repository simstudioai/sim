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
