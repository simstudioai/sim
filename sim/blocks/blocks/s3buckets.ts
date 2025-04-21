import { S3Icon } from '@/components/icons'
import { S3Response } from '@/tools/s3buckets/types'
import { BlockConfig } from '../types'

export const S3FileViewerBlock: BlockConfig<S3Response> = {
  type: 's3_file_viewer',
  name: 'S3 File Viewer',
  description: 'View S3 files',
  longDescription:
    'Retrieve and view files from Amazon S3 buckets. Support for various file types including images, text, JSON, and binary formats.',
  category: 'tools',
  bgColor: '#FF9900', // AWS Orange
  icon: S3Icon,
  subBlocks: [
    {
      id: 'accessKeyId',
      title: 'Access Key ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your AWS Access Key ID',
      password: true,
    },
    {
      id: 'secretAccessKey',
      title: 'Secret Access Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your AWS Secret Access Key',
      password: true,
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., us-east-1',
      value: () => 'us-east-1',
    },
    {
      id: 'bucketName',
      title: 'Bucket Name',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter S3 bucket name',
    },
    {
      id: 'objectKey',
      title: 'Object Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Path to the file in S3 (e.g., folder/file.txt)',
    },
  ],
  tools: {
    access: ['s3_get_object'],
    config: {
      tool: () => 's3_get_object',
      params: (params) => {
        // Validate required fields
        if (!params.accessKeyId) {
          throw new Error('Access Key ID is required')
        }
        if (!params.secretAccessKey) {
          throw new Error('Secret Access Key is required')
        }
        if (!params.bucketName) {
          throw new Error('Bucket Name is required')
        }
        if (!params.objectKey) {
          throw new Error('Object Key is required')
        }

        return {
          accessKeyId: params.accessKeyId,
          secretAccessKey: params.secretAccessKey,
          region: params.region || 'us-east-1',
          bucketName: params.bucketName,
          objectKey: params.objectKey,
        }
      },
    },
  },
  inputs: {
    accessKeyId: { type: 'string', required: true },
    secretAccessKey: { type: 'string', required: true },
    region: { type: 'string', required: true },
    bucketName: { type: 'string', required: true },
    objectKey: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        content: 'string', // Text content for text files, URL for binary files
        data: 'string',    // Base64-encoded file data
        metadata: 'json',  // File metadata (name, type, size, etc.)
      },
    },
  },
}