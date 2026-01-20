import { TextractIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type SubBlockType } from '@/blocks/types'
import type { TextractParserOutput } from '@/tools/textract/types'

export const TextractBlock: BlockConfig<TextractParserOutput> = {
  type: 'textract',
  name: 'AWS Textract',
  description: 'Extract text, tables, and forms from documents',
  authMode: AuthMode.ApiKey,
  longDescription: `Integrate AWS Textract into your workflow to extract text, tables, forms, and key-value pairs from documents. Sync mode supports JPEG, PNG, and single-page PDF. Async mode supports multi-page PDF and TIFF via S3.`,
  docsLink: 'https://docs.sim.ai/tools/textract',
  category: 'tools',
  bgColor: 'linear-gradient(135deg, #055F4E 0%, #56C0A7 100%)',
  icon: TextractIcon,
  subBlocks: [
    {
      id: 'processingMode',
      title: 'Document Type',
      type: 'dropdown' as SubBlockType,
      options: [
        { id: 'sync', label: 'Single Page' },
        { id: 'async', label: 'Multi-Page' },
      ],
    },
    {
      id: 'inputMethod',
      title: 'Select Input Method',
      type: 'dropdown' as SubBlockType,
      options: [
        { id: 'url', label: 'Document URL' },
        { id: 'upload', label: 'Upload Document' },
      ],
      condition: {
        field: 'processingMode',
        value: 'async',
        not: true,
      },
    },
    {
      id: 'asyncInputMethod',
      title: 'Select Input Method',
      type: 'dropdown' as SubBlockType,
      options: [
        { id: 's3', label: 'S3 URI' },
        { id: 'upload', label: 'Upload Document' },
      ],
      condition: {
        field: 'processingMode',
        value: 'async',
      },
    },
    {
      id: 'filePath',
      title: 'Document URL',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter full URL to a document (JPEG, PNG, or single-page PDF)',
      condition: {
        field: 'inputMethod',
        value: 'url',
        and: {
          field: 'processingMode',
          value: 'async',
          not: true,
        },
      },
    },
    {
      id: 's3Uri',
      title: 'S3 URI',
      type: 'short-input' as SubBlockType,
      placeholder: 's3://bucket-name/path/to/document.pdf',
      condition: {
        field: 'asyncInputMethod',
        value: 's3',
        and: {
          field: 'processingMode',
          value: 'async',
        },
      },
    },
    {
      id: 'fileUpload',
      title: 'Upload Document',
      type: 'file-upload' as SubBlockType,
      acceptedTypes: 'application/pdf,image/jpeg,image/png,image/tiff',
      condition: {
        field: 'inputMethod',
        value: 'upload',
        and: {
          field: 'processingMode',
          value: 'async',
          not: true,
        },
      },
      maxSize: 10,
    },
    {
      id: 'asyncFileUpload',
      title: 'Upload Document',
      type: 'file-upload' as SubBlockType,
      acceptedTypes: 'application/pdf,image/jpeg,image/png,image/tiff',
      condition: {
        field: 'asyncInputMethod',
        value: 'upload',
        and: {
          field: 'processingMode',
          value: 'async',
        },
      },
      maxSize: 50,
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input' as SubBlockType,
      placeholder: 'e.g., us-east-1',
      required: true,
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your AWS Access Key ID',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your AWS Secret Access Key',
      password: true,
      required: true,
    },
    {
      id: 'extractTables',
      title: 'Extract Tables',
      type: 'switch' as SubBlockType,
    },
    {
      id: 'extractForms',
      title: 'Extract Forms (Key-Value Pairs)',
      type: 'switch' as SubBlockType,
    },
    {
      id: 'detectSignatures',
      title: 'Detect Signatures',
      type: 'switch' as SubBlockType,
    },
    {
      id: 'analyzeLayout',
      title: 'Analyze Document Layout',
      type: 'switch' as SubBlockType,
    },
  ],
  tools: {
    access: ['textract_parser'],
    config: {
      tool: () => 'textract_parser',
      params: (params) => {
        if (!params.accessKeyId || params.accessKeyId.trim() === '') {
          throw new Error('AWS Access Key ID is required')
        }
        if (!params.secretAccessKey || params.secretAccessKey.trim() === '') {
          throw new Error('AWS Secret Access Key is required')
        }
        if (!params.region || params.region.trim() === '') {
          throw new Error('AWS Region is required')
        }

        const processingMode = params.processingMode || 'sync'
        const parameters: Record<string, unknown> = {
          accessKeyId: params.accessKeyId.trim(),
          secretAccessKey: params.secretAccessKey.trim(),
          region: params.region.trim(),
          processingMode,
        }

        if (processingMode === 'async') {
          const asyncInputMethod = params.asyncInputMethod || 's3'
          if (asyncInputMethod === 's3') {
            if (!params.s3Uri || params.s3Uri.trim() === '') {
              throw new Error('S3 URI is required for async processing')
            }
            parameters.s3Uri = params.s3Uri.trim()
          } else if (asyncInputMethod === 'upload') {
            if (!params.asyncFileUpload) {
              throw new Error('Please upload a document')
            }
            parameters.fileUpload = params.asyncFileUpload
          }
        } else {
          const inputMethod = params.inputMethod || 'url'
          if (inputMethod === 'url') {
            if (!params.filePath || params.filePath.trim() === '') {
              throw new Error('Document URL is required')
            }
            parameters.filePath = params.filePath.trim()
          } else if (inputMethod === 'upload') {
            if (!params.fileUpload) {
              throw new Error('Please upload a document')
            }
            parameters.fileUpload = params.fileUpload
          }
        }

        const featureTypes: string[] = []
        if (params.extractTables) featureTypes.push('TABLES')
        if (params.extractForms) featureTypes.push('FORMS')
        if (params.detectSignatures) featureTypes.push('SIGNATURES')
        if (params.analyzeLayout) featureTypes.push('LAYOUT')

        if (featureTypes.length > 0) {
          parameters.featureTypes = featureTypes
        }

        return parameters
      },
    },
  },
  inputs: {
    processingMode: { type: 'string', description: 'Document type: single-page or multi-page' },
    inputMethod: { type: 'string', description: 'Input method selection for sync mode' },
    asyncInputMethod: { type: 'string', description: 'Input method selection for async mode' },
    filePath: { type: 'string', description: 'Document URL' },
    s3Uri: { type: 'string', description: 'S3 URI for async processing (s3://bucket/key)' },
    fileUpload: { type: 'json', description: 'Uploaded document file for sync mode' },
    asyncFileUpload: { type: 'json', description: 'Uploaded document file for async mode' },
    extractTables: { type: 'boolean', description: 'Extract tables from document' },
    extractForms: { type: 'boolean', description: 'Extract form key-value pairs' },
    detectSignatures: { type: 'boolean', description: 'Detect signatures' },
    analyzeLayout: { type: 'boolean', description: 'Analyze document layout' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS Access Key ID' },
    secretAccessKey: { type: 'string', description: 'AWS Secret Access Key' },
  },
  outputs: {
    blocks: {
      type: 'json',
      description: 'Array of detected blocks (PAGE, LINE, WORD, TABLE, CELL, KEY_VALUE_SET, etc.)',
    },
    documentMetadata: {
      type: 'json',
      description: 'Document metadata containing pages count',
    },
    modelVersion: {
      type: 'string',
      description: 'Version of the Textract model used for processing',
    },
  },
}
