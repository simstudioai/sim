/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { hydrateUserFilesWithBase64 } from '@/lib/uploads/utils/user-file-base64.server'
import type { UserFile } from '@/executor/types'

describe('hydrateUserFilesWithBase64', () => {
  it('strips existing base64 when it exceeds maxBytes', async () => {
    const file: UserFile = {
      id: 'file-1',
      name: 'large.txt',
      key: 'execution/workspace/workflow/execution/large.txt',
      url: 'https://example.com/large.txt',
      size: 5,
      type: 'text/plain',
      context: 'execution',
      base64: Buffer.from('hello').toString('base64'),
    }

    const hydrated = await hydrateUserFilesWithBase64({ file }, { maxBytes: 1 })

    expect(hydrated.file).not.toHaveProperty('base64')
  })

  it('keeps existing base64 when it is within maxBytes', async () => {
    const base64 = Buffer.from('hello').toString('base64')
    const file: UserFile = {
      id: 'file-1',
      name: 'small.txt',
      key: 'execution/workspace/workflow/execution/small.txt',
      url: 'https://example.com/small.txt',
      size: 5,
      type: 'text/plain',
      context: 'execution',
      base64,
    }

    const hydrated = await hydrateUserFilesWithBase64({ file }, { maxBytes: 10 })

    expect(hydrated.file.base64).toBe(base64)
  })
})
