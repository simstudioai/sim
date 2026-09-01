import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsS3CopyObjectContract } from '@/lib/api/contracts/tools/aws/s3-copy-object'
import { awsS3CreateBucketContract } from '@/lib/api/contracts/tools/aws/s3-create-bucket'
import { awsS3DeleteBucketContract } from '@/lib/api/contracts/tools/aws/s3-delete-bucket'
import { awsS3DeleteObjectContract } from '@/lib/api/contracts/tools/aws/s3-delete-object'
import { awsS3DeleteObjectsContract } from '@/lib/api/contracts/tools/aws/s3-delete-objects'
import { awsS3HeadObjectContract } from '@/lib/api/contracts/tools/aws/s3-head-object'
import { awsS3ListBucketsContract } from '@/lib/api/contracts/tools/aws/s3-list-buckets'
import { awsS3ListObjectsContract } from '@/lib/api/contracts/tools/aws/s3-list-objects'
import { awsS3PresignedUrlContract } from '@/lib/api/contracts/tools/aws/s3-presigned-url'
import { awsS3PutObjectContract } from '@/lib/api/contracts/tools/aws/s3-put-object'
import { S3OperationError } from '@/lib/internal/s3/errors'
import {
  executeS3CopyObject,
  executeS3CreateBucket,
  executeS3DeleteBucket,
  executeS3DeleteObject,
  executeS3DeleteObjects,
  executeS3HeadObject,
  executeS3ListBuckets,
  executeS3ListObjects,
  executeS3PresignedUrl,
  executeS3PutObject,
  type S3OperationContext,
} from '@/lib/internal/s3/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>) => Promise<unknown>,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    const status = error instanceof S3OperationError ? error.status : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status }
    )
  }
}

export const executeS3Tool: InternalToolOperationHandler = async (request) => {
  const { toolId, input, context, headers, requestId, signal } = request
  const operationContext: S3OperationContext = {
    headers,
    requestId,
    signal,
    userId: context.userId,
  }
  switch (toolId) {
    case 's3_copy_object':
      return executeOperation(
        awsS3CopyObjectContract,
        input,
        (input) => executeS3CopyObject(input, signal),
        signal
      )
    case 's3_create_bucket':
      return executeOperation(
        awsS3CreateBucketContract,
        input,
        (input) => executeS3CreateBucket(input, signal),
        signal
      )
    case 's3_delete_bucket':
      return executeOperation(
        awsS3DeleteBucketContract,
        input,
        (input) => executeS3DeleteBucket(input, signal),
        signal
      )
    case 's3_delete_object':
      return executeOperation(
        awsS3DeleteObjectContract,
        input,
        (input) => executeS3DeleteObject(input, signal),
        signal
      )
    case 's3_delete_objects':
      return executeOperation(
        awsS3DeleteObjectsContract,
        input,
        (input) => executeS3DeleteObjects(input, signal),
        signal
      )
    case 's3_head_object':
      return executeOperation(
        awsS3HeadObjectContract,
        input,
        (input) => executeS3HeadObject(input, signal),
        signal
      )
    case 's3_list_buckets':
      return executeOperation(
        awsS3ListBucketsContract,
        input,
        (input) => executeS3ListBuckets(input, signal),
        signal
      )
    case 's3_list_objects':
      return executeOperation(
        awsS3ListObjectsContract,
        input,
        (input) => executeS3ListObjects(input, signal),
        signal
      )
    case 's3_presigned_url':
      return executeOperation(
        awsS3PresignedUrlContract,
        input,
        (input) => executeS3PresignedUrl(input, signal),
        signal
      )
    case 's3_put_object':
      return executeOperation(
        awsS3PutObjectContract,
        input,
        (input) => executeS3PutObject(input, operationContext),
        signal
      )
    default:
      return Response.json(
        { success: false, error: `Unsupported S3 tool: ${toolId}` },
        { status: 500 }
      )
  }
}
