import { DocumentIcon } from '@/components/icons'
import { FileParserOutput } from '@/tools/file/parser'
import { BlockConfig } from '../types'

export const FileBlock: BlockConfig<FileParserOutput> = {
  type: 'file',
  name: 'File',
  description: 'Read and parse multiple files',
  longDescription:
    'Upload and extract contents from structured file formats including PDFs, CSV spreadsheets, and Word documents (DOCX). Specialized parsers extract text and metadata from each format. You can upload multiple files at once and access them individually or as a combined document.',
  category: 'tools',
  bgColor: '#40916C',
  icon: DocumentIcon,
  subBlocks: [
    {
      id: 'file',
      title: 'Upload Files',
      type: 'file-upload',
      layout: 'full',
      acceptedTypes: '.pdf,.csv,.docx',
      multiple: true,
      maxSize: 100,
    },
  ],
  tools: {
    access: ['file_parser'],
    config: {
      tool: () => 'file_parser',
      params: (params) => {
        console.log('File block params:', params)

        // Handle case where 'file' is an array (multiple files)
        if (params.file && Array.isArray(params.file) && params.file.length > 0) {
          // Process all files by sending array of paths
          const filePaths = params.file.map((file) => file.path)
          return {
            filePath: filePaths.length === 1 ? filePaths[0] : filePaths,
            fileType: params.fileType || 'auto',
          }
        }

        // Handle case where 'file' is a single file object
        if (params.file && params.file.path) {
          return {
            filePath: params.file.path,
            fileType: params.fileType || 'auto',
          }
        }

        // If no files, return empty params
        return { filePath: '', fileType: params.fileType || 'auto' }
      },
    },
  },
  inputs: {
    fileType: { type: 'string', required: false },
    file: { type: 'json', required: true },
  },
  outputs: {
    response: {
      type: {
        files: 'json',
        combinedContent: 'string',
      },
    },
  },
}
