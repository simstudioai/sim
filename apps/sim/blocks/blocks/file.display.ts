import { DocumentIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const FileBlockDisplay = {
  type: 'file',
  name: 'File (Legacy)',
  description: 'Read and parse multiple files',
  category: 'blocks',
  bgColor: '#40916C',
  icon: DocumentIcon,
  longDescription: `Integrate File into the workflow. Can upload a file manually or insert a file url.`,
  docsLink: 'https://docs.sim.ai/integrations/file',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const FileV2BlockDisplay = {
  ...FileBlockDisplay,
  type: 'file_v2',
  name: 'File (Legacy)',
  description: 'Read and parse multiple files',
  hideFromToolbar: true,
} satisfies BlockDisplay

export const FileV3BlockDisplay = {
  type: 'file_v3',
  name: 'File',
  description: 'Read and write workspace files',
  category: 'blocks',
  bgColor: '#40916C',
  icon: DocumentIcon,
  longDescription:
    'Read and parse files from uploads or URLs, write new workspace files, or append content to existing files.',
  docsLink: 'https://docs.sim.ai/integrations/file',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const FileV4BlockDisplay = {
  ...FileV3BlockDisplay,
  type: 'file_v4',
  name: 'File (Legacy)',
  description: 'Read, fetch, write, and append files',
  longDescription:
    'Read workspace files by picker or canonical ID, fetch and parse files from URLs with optional headers, write new workspace files, or append content to existing files.',
  hideFromToolbar: true,
} satisfies BlockDisplay

export const FileV5BlockDisplay = {
  ...FileV4BlockDisplay,
  type: 'file_v5',
  name: 'File',
  description:
    'Read, get content, fetch, write, append, compress, decompress, and manage sharing for files',
  longDescription:
    'Read workspace file objects, extract the text content of files, fetch and parse files from URLs with optional headers, write new workspace files, append content to existing files, compress files into a .zip archive, extract a .zip archive into the workspace, or manage the public share link for a file.',
  hideFromToolbar: false,
} satisfies BlockDisplay
