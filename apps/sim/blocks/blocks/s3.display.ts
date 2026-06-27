import { S3Icon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const S3BlockDisplay = {
  type: 's3',
  name: 'S3',
  description: 'Upload, download, list, and manage S3 files',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #1B660F 0%, #6CAE3E 100%)',
  icon: S3Icon,
  longDescription:
    'Integrate S3 into the workflow. Upload files, download objects, list bucket contents, delete objects, and copy objects between buckets. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/s3',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

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
