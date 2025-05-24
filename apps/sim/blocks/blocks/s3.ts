import { S3Icon } from '@/components/icons'
import { S3Response } from '@/tools/s3/types'
import { BlockConfig } from '../types'

export const S3Block: BlockConfig<S3Response> = {
  type: 's3',
  name: 'S3',
  description: 'View S3 files',
  longDescription: 'Retrieve and view files from Amazon S3 buckets using presigned URLs.',
  docsLink: 'https://docs.simstudio.ai/tools/s3',
  category: 'tools',
  bgColor: '#E0E0E0',
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
      id: 's3Uri',
      title: 'S3 Object URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., https://bucket-name.s3.region.amazonaws.com/path/to/file',
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
        if (!params.s3Uri) {
          throw new Error('S3 Object URL is required')
        }

        // Parse S3 URI
        try {
          const url = new URL(params.s3Uri)
          const hostname = url.hostname

          // Extract bucket name from hostname
          const bucketName = hostname.split('.')[0]

          // Extract region from hostname
          const regionMatch = hostname.match(/s3[.-]([^.]+)\.amazonaws\.com/)
          const region = regionMatch ? regionMatch[1] : 'us-east-1'

          // Extract object key from pathname (remove leading slash)
          const objectKey = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname

          if (!bucketName) {
            throw new Error('Could not extract bucket name from URL')
          }

          if (!objectKey) {
            throw new Error('No object key found in URL')
          }

          return {
            accessKeyId: params.accessKeyId,
            secretAccessKey: params.secretAccessKey,
            region,
            bucketName,
            objectKey,
          }
        } catch (error) {
          throw new Error(
            'Invalid S3 Object URL format. Expected format: https://bucket-name.s3.region.amazonaws.com/path/to/file'
          )
        }
      },
    },
  },
  inputs: {
    accessKeyId: { type: 'string', required: true },
    secretAccessKey: { type: 'string', required: true },
    s3Uri: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        url: 'string',
        metadata: 'json',
      },
    },
  },
}
