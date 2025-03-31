import { DocumentIcon } from '@/components/icons'
import { FileParserOutput } from '@/tools/file/parser'
import { BlockConfig } from '../types'

export const FileBlock: BlockConfig<FileParserOutput> = {
  type: 'file',
  name: 'File',
  description: 'Read and parse files',
  longDescription:
    'Upload and extract contents from structured file formats including PDFs, CSV spreadsheets, and Word documents (DOCX). Specialized parsers extract text and metadata from each format.',
  category: 'tools',
  bgColor: '#40916C',
  icon: DocumentIcon,
  subBlocks: [
    {
      id: 'file',
      title: 'Upload File',
      type: 'file-upload',
      layout: 'full',
      acceptedTypes: '.pdf,.csv,.docx',
    }
  ],
  tools: {
    access: ['file_parser'],
    config: {
      tool: () => 'file_parser',
      params: (params) => params,
    },
  },
  inputs: {
    fileType: { type: 'string', required: false },
    file: { type: 'json', required: true },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        fileType: 'string',
        size: 'number',
        name: 'string',
        binary: 'boolean',
        metadata: 'any'
      },
    },
  },
} 