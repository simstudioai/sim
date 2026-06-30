import { S3Icon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const s3ConnectorMeta: ConnectorMeta = {
  id: 's3',
  name: 'Amazon S3',
  description:
    'Sync text-based objects from Amazon S3 or any S3-compatible store (Cloudflare R2, MinIO) into your knowledge base',
  version: '1.1.0',
  icon: S3Icon,

  auth: {
    mode: 'apiKey',
    label: 'Secret Access Key',
    placeholder: 'Enter your AWS Secret Access Key',
  },

  configFields: [
    {
      id: 'accessKeyId',
      title: 'Access Key ID',
      type: 'short-input',
      placeholder: 'e.g. AKIAIOSFODNN7EXAMPLE',
      required: true,
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      placeholder: 'e.g. us-east-1 (use auto for Cloudflare R2)',
      required: true,
      description:
        'AWS region for the bucket. For Cloudflare R2 use "auto"; for MinIO use the region the server is configured with (commonly us-east-1).',
    },
    {
      id: 'bucket',
      title: 'Bucket',
      type: 'short-input',
      placeholder: 'e.g. my-bucket',
      required: true,
    },
    {
      id: 'endpoint',
      title: 'Custom Endpoint',
      type: 'short-input',
      placeholder: 'https://accountid.r2.cloudflarestorage.com (optional — leave empty for AWS S3)',
      required: false,
      description:
        'S3-compatible endpoint for Cloudflare R2, MinIO, etc. Leave empty for AWS S3. Uses path-style addressing. Plain http:// is only allowed for localhost.',
    },
    {
      id: 'prefix',
      title: 'Prefix',
      type: 'short-input',
      placeholder: 'e.g. docs/ (optional)',
      required: false,
      description: 'Only sync objects whose key starts with this prefix',
    },
    {
      id: 'extensions',
      title: 'File Extensions',
      type: 'short-input',
      placeholder: 'e.g. txt, md, csv (optional)',
      required: false,
      description:
        'Comma-separated list of file extensions to sync. Leave blank to use the built-in text formats.',
    },
    {
      id: 'maxObjects',
      title: 'Max Objects',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
      description: 'Stop syncing after this many objects',
    },
  ],

  tagDefinitions: [
    { id: 'prefix', displayName: 'Folder', fieldType: 'text' },
    { id: 'fileSize', displayName: 'Size (bytes)', fieldType: 'number' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
