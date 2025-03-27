import { EyeIcon } from '@/components/icons'
import { FileParserOutput } from '@/tools/file/parser'
import { BlockConfig } from '../types'

export const FileBlock: BlockConfig<FileParserOutput> = {
  type: 'file',
  name: 'File',
  description: 'Upload and parse files',
  longDescription:
    'Upload and parse a variety of file types including PDFs, spreadsheets (CSV, Excel), documents, images, and text files for further processing in your workflow.',
  category: 'tools',
  bgColor: '#5D5FEF',
  icon: EyeIcon,
  subBlocks: [
    {
      id: 'fileType',
      title: 'File Type',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Auto-detect', id: 'auto' },
        { label: 'Plain Text (TXT)', id: 'text/plain' },
        { label: 'CSV', id: 'text/csv' },
        { label: 'JSON', id: 'application/json' },
        { label: 'PDF', id: 'application/pdf' },
        { label: 'Excel (XLSX)', id: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        { label: 'Word (DOCX)', id: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { label: 'XML', id: 'application/xml' },
        { label: 'Markdown', id: 'text/markdown' },
        { label: 'HTML', id: 'text/html' },
        { label: 'Image', id: 'image/*' },
      ],
    },
    {
      id: 'file',
      title: 'Upload File',
      type: 'file-upload',
      layout: 'full',
      acceptedTypes: '.pdf,.csv,.txt,.json,.xml,.md,.html,.xlsx,.docx,.png,.jpg,.jpeg,.gif',
    }
  ],
  tools: {
    access: ['file_parser'],
    config: {
      tool: () => 'file_parser',
      params: (params) => {
        const { file, fileType } = params
        
        if (!file) {
          throw new Error('No file uploaded. Please upload a file first.')
        }
        
        // If auto-detect is selected, don't pass fileType parameter
        const selectedFileType = fileType === 'auto' ? undefined : fileType
        
        return {
          filePath: file.path,
          fileType: selectedFileType,
        }
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
        content: 'string',
        fileType: 'string',
        size: 'number',
        name: 'string',
        binary: 'boolean'
      },
    },
  },
} 