import { S3Icon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { S3Response } from '@/tools/s3/types'

export const S3Block: BlockConfig<S3Response> = {
  type: 's3',
  name: 'S3',
  description: 'Upload, download, list, and manage S3 files',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate S3 into the workflow. Upload files, download objects, list bucket contents, delete objects, and copy objects between buckets. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/tools/s3',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: S3Icon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Download File', id: 'get_object' },
        { label: 'Upload File', id: 'put_object' },
        { label: 'List Objects', id: 'list_objects' },
        { label: 'Delete Object', id: 'delete_object' },
        { label: 'Copy Object', id: 'copy_object' },
      ],
      value: () => 'get_object',
    },
    // AWS Credentials
    {
      id: 'accessKeyId',
      title: 'Access Key ID',
      type: 'short-input',
      placeholder: 'Enter your AWS Access Key ID',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'Secret Access Key',
      type: 'short-input',
      placeholder: 'Enter your AWS Secret Access Key',
      password: true,
      required: true,
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'e.g., us-east-1, us-west-2',
      condition: {
        field: 'operation',
        value: ['put_object', 'list_objects', 'delete_object', 'copy_object'],
      },
      required: true,
    },
    {
      id: 'bucketName',
      title: 'Bucket Name',
      type: 'short-input',
      placeholder: 'Enter S3 bucket name',
      condition: { field: 'operation', value: ['put_object', 'list_objects', 'delete_object'] },
      required: true,
    },

    // ===== UPLOAD (PUT OBJECT) FIELDS =====
    {
      id: 'objectKey',
      title: 'Object Key/Path',
      type: 'short-input',
      placeholder: 'e.g., myfile.pdf or documents/report.pdf',
      condition: { field: 'operation', value: 'put_object' },
      required: true,
    },
    {
      id: 'uploadFile',
      title: 'File to Upload',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a file',
      condition: { field: 'operation', value: 'put_object' },
      mode: 'basic',
      multiple: false,
    },
    {
      id: 'file',
      title: 'File Reference',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a file from previous blocks',
      condition: { field: 'operation', value: 'put_object' },
      mode: 'advanced',
    },
    {
      id: 'content',
      title: 'Text Content',
      type: 'long-input',
      placeholder: 'Or enter text content to upload',
      condition: { field: 'operation', value: 'put_object' },
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'short-input',
      placeholder: 'e.g., text/plain, application/json (auto-detected if not provided)',
      condition: { field: 'operation', value: 'put_object' },
      mode: 'advanced',
    },
    {
      id: 'acl',
      title: 'Access Control',
      type: 'dropdown',
      options: [
        { label: 'Private', id: 'private' },
        { label: 'Public Read', id: 'public-read' },
        { label: 'Public Read/Write', id: 'public-read-write' },
        { label: 'Authenticated Read', id: 'authenticated-read' },
      ],
      placeholder: 'Select ACL (default: private)',
      condition: { field: 'operation', value: 'put_object' },
      mode: 'advanced',
    },

    // ===== DOWNLOAD (GET OBJECT) FIELDS =====
    {
      id: 's3Uri',
      title: 'S3 Object URL',
      type: 'short-input',
      placeholder: 'e.g., https://bucket-name.s3.region.amazonaws.com/path/to/file',
      condition: { field: 'operation', value: 'get_object' },
      required: true,
    },

    // ===== LIST OBJECTS FIELDS =====
    {
      id: 'prefix',
      title: 'Prefix/Folder',
      type: 'short-input',
      placeholder: 'Filter by prefix (e.g., folder/ or leave empty for all)',
      condition: { field: 'operation', value: 'list_objects' },
    },
    {
      id: 'maxKeys',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Maximum number of objects to return (default: 1000)',
      condition: { field: 'operation', value: 'list_objects' },
      mode: 'advanced',
    },
    {
      id: 'continuationToken',
      title: 'Continuation Token',
      type: 'short-input',
      placeholder: 'Token for pagination (from previous response)',
      condition: { field: 'operation', value: 'list_objects' },
      mode: 'advanced',
    },

    // ===== DELETE OBJECT FIELDS =====
    {
      id: 'objectKey',
      title: 'Object Key/Path',
      type: 'short-input',
      placeholder: 'e.g., myfile.pdf or documents/report.pdf',
      condition: { field: 'operation', value: 'delete_object' },
      required: true,
    },

    // ===== COPY OBJECT FIELDS =====
    {
      id: 'sourceBucket',
      title: 'Source Bucket',
      type: 'short-input',
      placeholder: 'Source bucket name',
      condition: { field: 'operation', value: 'copy_object' },
      required: true,
    },
    {
      id: 'sourceKey',
      title: 'Source Object Key',
      type: 'short-input',
      placeholder: 'e.g., oldfile.pdf or folder/file.pdf',
      condition: { field: 'operation', value: 'copy_object' },
      required: true,
    },
    {
      id: 'destinationBucket',
      title: 'Destination Bucket',
      type: 'short-input',
      placeholder: 'Destination bucket name (can be same as source)',
      condition: { field: 'operation', value: 'copy_object' },
      required: true,
    },
    {
      id: 'destinationKey',
      title: 'Destination Object Key',
      type: 'short-input',
      placeholder: 'e.g., newfile.pdf or backup/file.pdf',
      condition: { field: 'operation', value: 'copy_object' },
      required: true,
    },
    {
      id: 'copyAcl',
      title: 'Access Control',
      type: 'dropdown',
      options: [
        { label: 'Private', id: 'private' },
        { label: 'Public Read', id: 'public-read' },
        { label: 'Public Read/Write', id: 'public-read-write' },
        { label: 'Authenticated Read', id: 'authenticated-read' },
      ],
      placeholder: 'Select ACL for copied object (default: private)',
      condition: { field: 'operation', value: 'copy_object' },
      mode: 'advanced',
      canonicalParamId: 'acl',
    },
  ],
  tools: {
    access: [
      's3_put_object',
      's3_get_object',
      's3_list_objects',
      's3_delete_object',
      's3_copy_object',
    ],
    config: {
      tool: (params) => {
        // Default to get_object for backward compatibility with existing workflows
        const operation = params.operation || 'get_object'

        switch (operation) {
          case 'put_object':
            return 's3_put_object'
          case 'get_object':
            return 's3_get_object'
          case 'list_objects':
            return 's3_list_objects'
          case 'delete_object':
            return 's3_delete_object'
          case 'copy_object':
            return 's3_copy_object'
          default:
            throw new Error(`Invalid S3 operation: ${operation}`)
        }
      },
      params: (params) => {
        // Validate required fields (common to all operations)
        if (!params.accessKeyId) {
          throw new Error('Access Key ID is required')
        }
        if (!params.secretAccessKey) {
          throw new Error('Secret Access Key is required')
        }

        // Default to get_object for backward compatibility with existing workflows
        const operation = params.operation || 'get_object'

        // Operation-specific parameters
        switch (operation) {
          case 'put_object': {
            if (!params.region) {
              throw new Error('AWS Region is required')
            }
            if (!params.bucketName) {
              throw new Error('Bucket Name is required')
            }
            if (!params.objectKey) {
              throw new Error('Object Key is required for upload')
            }
            // Use file from uploadFile if in basic mode, otherwise use file reference
            const fileParam = params.uploadFile || params.file

            return {
              accessKeyId: params.accessKeyId,
              secretAccessKey: params.secretAccessKey,
              region: params.region,
              bucketName: params.bucketName,
              objectKey: params.objectKey,
              file: fileParam,
              content: params.content,
              contentType: params.contentType,
              acl: params.acl,
            }
          }

          case 'get_object': {
            if (!params.s3Uri) {
              throw new Error('S3 Object URL is required')
            }

            // Parse S3 URI for get_object
            try {
              const url = new URL(params.s3Uri)
              const hostname = url.hostname
              const bucketName = hostname.split('.')[0]
              const regionMatch = hostname.match(/s3[.-]([^.]+)\.amazonaws\.com/)
              const region = regionMatch ? regionMatch[1] : params.region
              const objectKey = url.pathname.startsWith('/')
                ? url.pathname.substring(1)
                : url.pathname

              if (!bucketName || !objectKey) {
                throw new Error('Could not parse S3 URL')
              }

              return {
                accessKeyId: params.accessKeyId,
                secretAccessKey: params.secretAccessKey,
                region,
                bucketName,
                objectKey,
                s3Uri: params.s3Uri,
              }
            } catch (_error) {
              throw new Error(
                'Invalid S3 Object URL format. Expected: https://bucket-name.s3.region.amazonaws.com/path/to/file'
              )
            }
          }

          case 'list_objects':
            if (!params.region) {
              throw new Error('AWS Region is required')
            }
            if (!params.bucketName) {
              throw new Error('Bucket Name is required')
            }
            return {
              accessKeyId: params.accessKeyId,
              secretAccessKey: params.secretAccessKey,
              region: params.region,
              bucketName: params.bucketName,
              prefix: params.prefix,
              maxKeys: params.maxKeys ? Number.parseInt(params.maxKeys as string, 10) : undefined,
              continuationToken: params.continuationToken,
            }

          case 'delete_object':
            if (!params.region) {
              throw new Error('AWS Region is required')
            }
            if (!params.bucketName) {
              throw new Error('Bucket Name is required')
            }
            if (!params.objectKey) {
              throw new Error('Object Key is required for deletion')
            }
            return {
              accessKeyId: params.accessKeyId,
              secretAccessKey: params.secretAccessKey,
              region: params.region,
              bucketName: params.bucketName,
              objectKey: params.objectKey,
            }

          case 'copy_object': {
            if (!params.region) {
              throw new Error('AWS Region is required')
            }
            if (!params.sourceBucket || !params.sourceKey) {
              throw new Error('Source bucket and key are required')
            }
            if (!params.destinationBucket || !params.destinationKey) {
              throw new Error('Destination bucket and key are required')
            }
            // Use copyAcl if provided, map to acl parameter
            const acl = params.copyAcl || params.acl
            return {
              accessKeyId: params.accessKeyId,
              secretAccessKey: params.secretAccessKey,
              region: params.region,
              sourceBucket: params.sourceBucket,
              sourceKey: params.sourceKey,
              destinationBucket: params.destinationBucket,
              destinationKey: params.destinationKey,
              acl: acl,
            }
          }

          default:
            throw new Error(`Unknown operation: ${operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    region: { type: 'string', description: 'AWS region' },
    bucketName: { type: 'string', description: 'S3 bucket name' },
    // Upload inputs
    objectKey: { type: 'string', description: 'Object key/path in S3' },
    uploadFile: { type: 'json', description: 'File to upload (UI)' },
    file: { type: 'json', description: 'File to upload (reference)' },
    content: { type: 'string', description: 'Text content to upload' },
    contentType: { type: 'string', description: 'Content-Type header' },
    acl: { type: 'string', description: 'Access control list' },
    // Download inputs
    s3Uri: { type: 'string', description: 'S3 object URL' },
    // List inputs
    prefix: { type: 'string', description: 'Prefix filter' },
    maxKeys: { type: 'number', description: 'Maximum results' },
    continuationToken: { type: 'string', description: 'Pagination token' },
    // Copy inputs
    sourceBucket: { type: 'string', description: 'Source bucket name' },
    sourceKey: { type: 'string', description: 'Source object key' },
    destinationBucket: { type: 'string', description: 'Destination bucket name' },
    destinationKey: { type: 'string', description: 'Destination object key' },
    copyAcl: { type: 'string', description: 'ACL for copied object' },
  },
  outputs: {
    url: { type: 'string', description: 'URL of S3 object' },
    objects: { type: 'json', description: 'List of objects (for list operation)' },
    deleted: { type: 'boolean', description: 'Deletion status' },
    metadata: { type: 'json', description: 'Operation metadata' },
  },
}
