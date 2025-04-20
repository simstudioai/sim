import { S3Icon } from '@/components/icons'
import { BlockConfig } from '../types'
import { S3Response } from '@/tools/s3buckets/types'

export const S3Block: BlockConfig<S3Response> = {
  type: 's3buckets',
  name: 'S3',
  description: 'Amazon S3 bucket operations',
  longDescription:
    'Retrieve objects from Amazon S3 buckets. Connect to your S3 storage for file operations without requiring AWS SDK installation.',
  bgColor: '#232F3E', // AWS brand color
  icon: S3Icon,
  category: 'tools',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Object', id: 'get' },
      ],
    },
    {
      id: 'accessKeyId',
      title: 'Access Key ID',
      type: 'short-input',
      placeholder: 'Enter your AWS Access Key ID',
    },
    {
      id: 'secretAccessKey',
      title: 'Secret Access Key',
      type: 'short-input',
      placeholder: 'Enter your AWS Secret Access Key',
      password: true,
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      placeholder: 'e.g. us-east-1',
    },
    {
      id: 'bucketName',
      title: 'Bucket Name',
      type: 'short-input',
      placeholder: 'Enter your S3 bucket name',
    },
    {
      id: 'key',
      title: 'Object Key',
      type: 'short-input',
      placeholder: 'Path to the file in the bucket (e.g., folder/filename.txt)',
      condition: {
        field: 'operation',
        value: ['get']
      },
    },
  ],
  tools: {
    access: [
      's3buckets_download',
    ],
    config: {
      tool: (params: Record<string, any>) => {
        const operation = params.operation || 'get'
        switch (operation) {
          case 'get':
            return 's3buckets_download'
          default:
            return 's3buckets_download'
        }
      },
      params: async (params: Record<string, any>) => {
        // Create detailed error information for any missing required fields
        const errors: string[] = []
        
        // Validate required fields for all operations
        if (!params.accessKeyId) {
          errors.push("Access Key ID is required")
        }
        
        if (!params.secretAccessKey) {
          errors.push("Secret Access Key is required")
        }
        
        if (!params.bucketName) {
          errors.push("Bucket Name is required")
        }
        
        if (!params.region) {
          errors.push("Region is required")
        }
        
        if (!params.key) {
          errors.push("Object Key is required")
        }
        
        // Throw error if any required fields are missing
        if (errors.length > 0) {
          throw new Error(`S3 Block Error: ${errors.join(', ')}`)
        }
        
        // Prepare the result object with common parameters
        const result: Record<string, any> = {
          accessKeyId: params.accessKeyId,
          secretAccessKey: params.secretAccessKey,
          region: params.region,
          bucketName: params.bucketName,
          key: params.key
        }
        
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    accessKeyId: { type: 'string', required: true },
    secretAccessKey: { type: 'string', required: true },
    region: { type: 'string', required: true },
    bucketName: { type: 'string', required: true },
    key: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        etag: 'any',
        location: 'any',
        content: 'any',
        contentType: 'any',
        error: 'any'
      }
    }
  },
}
