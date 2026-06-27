import { S3Icon } from '@/components/icons'
import { S3BlockDisplay } from '@/blocks/blocks/s3.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { S3Response } from '@/tools/s3/types'

export const S3Block: BlockConfig<S3Response> = {
  ...S3BlockDisplay,
  authMode: AuthMode.ApiKey,
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
      id: 'getObjectRegion',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'Used when S3 URL does not include region',
      condition: {
        field: 'operation',
        value: ['get_object'],
      },
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
      id: 'fileReference',
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
            // file is the canonical param from uploadFile (basic) or fileReference (advanced)
            // normalizeFileInput handles JSON stringified values from advanced mode
            const fileParam = normalizeFileInput(params.file, { single: true })

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
            return {
              accessKeyId: params.accessKeyId,
              secretAccessKey: params.secretAccessKey,
              region: params.getObjectRegion || params.region,
              s3Uri: params.s3Uri,
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
    file: { type: 'json', description: 'File to upload (canonical param)' },
    content: { type: 'string', description: 'Text content to upload' },
    contentType: { type: 'string', description: 'Content-Type header' },
    acl: { type: 'string', description: 'Access control list' },
    // Download inputs
    s3Uri: { type: 'string', description: 'S3 object URL' },
    getObjectRegion: { type: 'string', description: 'Optional AWS region override for downloads' },
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
    uri: {
      type: 'string',
      description: 'S3 URI (s3://bucket/key) for use with other AWS services',
    },
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    objects: { type: 'json', description: 'List of objects (for list operation)' },
    deleted: { type: 'boolean', description: 'Deletion status' },
    metadata: { type: 'json', description: 'Operation metadata' },
  },
}

export const S3BlockMeta = {
  tags: ['cloud', 'automation'],
  url: 'https://aws.amazon.com/s3',
  templates: [
    {
      icon: S3Icon,
      title: 'S3 report archiver',
      prompt:
        'Build a scheduled workflow that generates a daily report file, uploads it to an S3 bucket under a dated prefix, and posts the object link to Slack so the team always has the latest archived copy.',
      modules: ['scheduled', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: S3Icon,
      title: 'S3 document ingestion to knowledge base',
      prompt:
        'Create a workflow that lists objects in an S3 bucket, downloads each new document, and indexes it into a Sim knowledge base so agents can answer questions over files stored in S3.',
      modules: ['files', 'knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'sync'],
    },
    {
      icon: S3Icon,
      title: 'S3 incoming-file processor',
      prompt:
        'Build a workflow that downloads a newly uploaded S3 object, parses its contents, writes the extracted rows to a table, and deletes the source object once processing succeeds.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'enterprise'],
    },
    {
      icon: S3Icon,
      title: 'S3 backup retention sweeper',
      prompt:
        'Create a scheduled workflow that lists objects in an S3 backup bucket, identifies files older than the retention window, deletes the expired objects, and writes a deletion manifest to a table for audit.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'enterprise', 'monitoring'],
    },
    {
      icon: S3Icon,
      title: 'S3 export-to-customer flow',
      prompt:
        'Build a workflow that generates a per-customer data export file, uploads it to a customer-scoped S3 prefix, and emails the customer a download link once the upload completes.',
      modules: ['files', 'agent', 'workflows'],
      category: 'support',
      tags: ['automation', 'support'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: S3Icon,
      title: 'S3 bucket inventory dashboard',
      prompt:
        'Create a scheduled workflow that lists objects across an S3 bucket, aggregates object count and total size by prefix, and writes a daily inventory snapshot to a table for cost and growth tracking.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'monitoring', 'automation'],
    },
    {
      icon: S3Icon,
      title: 'S3 media-asset publisher',
      prompt:
        'Build a workflow that takes a generated image or document, uploads it to a public S3 bucket, retrieves the object URL, and writes the link back to the originating row in a table.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'automation'],
    },
  ],
  skills: [
    {
      name: 'upload-and-share-asset',
      description: 'Upload a generated file to an S3 bucket and return its object URL.',
      content:
        '# Upload And Share Asset\n\nPublish a file to S3 and hand back a usable link.\n\n## Steps\n1. Take the generated image or document as the object body.\n2. Run put_object with the bucket, key, and content type.\n3. Construct or capture the resulting object URL.\n4. Write the link back to the originating record (for example a table row).\n\n## Output\nReturn the object key and URL. Note the bucket and whether the object is publicly accessible.',
    },
    {
      name: 'fetch-object-contents',
      description: 'Download an object from S3 and pass its contents to downstream steps.',
      content:
        '# Fetch Object Contents\n\nRetrieve a file from S3 for processing.\n\n## Steps\n1. Identify the bucket and object key.\n2. Run get_object to download the file.\n3. Pass the contents downstream for parsing, summarizing, or transformation.\n\n## Output\nReturn the object contents (or a file reference) and confirm the source key.',
    },
    {
      name: 'list-bucket-objects',
      description: 'List objects in an S3 bucket under a prefix for inventory or cleanup.',
      content:
        '# List Bucket Objects\n\nEnumerate what lives under an S3 prefix.\n\n## Steps\n1. Run list_objects with the bucket and an optional prefix to scope the listing.\n2. Page through results if the listing is truncated.\n3. Filter the keys by name, date, or size as needed.\n\n## Output\nReturn the matching object keys with sizes and last-modified dates.',
    },
    {
      name: 'archive-object',
      description: 'Copy an S3 object to an archive location and delete the original.',
      content:
        '# Archive Object\n\nMove an object to an archive prefix or bucket.\n\n## Steps\n1. Run copy_object from the source key to the archive destination key.\n2. Verify the copy succeeded.\n3. Run delete_object on the original to complete the move.\n\n## Output\nConfirm the archived destination key and that the original was removed.',
    },
  ],
} as const satisfies BlockMeta
