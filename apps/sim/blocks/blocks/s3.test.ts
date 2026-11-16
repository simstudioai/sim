import { describe, expect, it } from 'vitest'
import { S3Block } from '@/blocks/blocks/s3'

const mapParams = S3Block.tools.config?.params
if (!mapParams) {
  throw new Error('S3 block must define tools.config.params')
}

const CONNECTION = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'secret',
  region: 'us-east-1',
}

/** Runs the mapper the way an agent tool call does: no `operation` in params, merged over them. */
function toolCall(args: Record<string, unknown>, operation: string) {
  return { ...args, ...mapParams?.(args, { operation }) }
}

/**
 * On an agent tool call the operation arrives only on `context` and the model's args use the
 * tool's param names (`keys`, `method`), not the block's field ids (`objectKeys`, `presignedMethod`).
 */
describe('S3 block agent tool calls', () => {
  it('deletes the keys the model sent', () => {
    const params = toolCall(
      { ...CONNECTION, bucketName: 'bucket', keys: ['a.txt', 'b.txt'] },
      'delete_objects'
    )

    expect(params.keys).toEqual(['a.txt', 'b.txt'])
  })

  it('presigns with the URL method the model sent', () => {
    const params = toolCall(
      { ...CONNECTION, bucketName: 'bucket', objectKey: 'a.txt', method: 'put', expiresIn: 600 },
      'presigned_url'
    )

    expect(params).toMatchObject({ method: 'put', expiresIn: 600, bucketName: 'bucket' })
  })
})
