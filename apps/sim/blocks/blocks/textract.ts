import { TextractIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type SubBlockType } from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { TextractParserOutput } from '@/tools/textract/types'

export const TextractBlock: BlockConfig<TextractParserOutput> = {
  type: 'textract',
  name: 'AWS Textract',
  description: 'Extract text, tables, and forms from documents',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  longDescription: `Integrate AWS Textract into your workflow to extract text, tables, forms, and key-value pairs from documents. Single-page mode supports JPEG, PNG, and single-page PDF. Multi-page mode supports multi-page PDF and TIFF.`,
  docsLink: 'https://docs.sim.ai/tools/textract',
  category: 'tools',
  bgColor: 'linear-gradient(135deg, #055F4E 0%, #56C0A7 100%)',
  icon: TextractIcon,
  subBlocks: [
    {
      id: 'processingMode',
      title: 'Processing Mode',
      type: 'dropdown' as SubBlockType,
      options: [
        { id: 'sync', label: 'Single Page (JPEG, PNG, 1-page PDF)' },
        { id: 'async', label: 'Multi-Page (PDF, TIFF via S3)' },
      ],
      tooltip:
        'Single Page uses synchronous API for JPEG, PNG, or single-page PDF. Multi-Page uses async API for multi-page PDF/TIFF stored in S3.',
    },
    {
      id: 'fileUpload',
      title: 'Document',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'document',
      acceptedTypes: 'image/jpeg,image/png,application/pdf',
      placeholder: 'Upload JPEG, PNG, or single-page PDF (max 10MB)',
      condition: {
        field: 'processingMode',
        value: 'async',
        not: true,
      },
      mode: 'basic',
      maxSize: 10,
    },
    {
      id: 'filePath',
      title: 'Document',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'document',
      placeholder: 'URL to JPEG, PNG, or single-page PDF',
      condition: {
        field: 'processingMode',
        value: 'async',
        not: true,
      },
      mode: 'advanced',
    },
    {
      id: 's3Uri',
      title: 'S3 URI',
      type: 'short-input' as SubBlockType,
      placeholder: 's3://bucket-name/path/to/document.pdf',
      condition: {
        field: 'processingMode',
        value: 'async',
      },
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
          if (!params.s3Uri || params.s3Uri.trim() === '') {
            throw new Error('S3 URI is required for multi-page processing')
          }
          parameters.s3Uri = params.s3Uri.trim()
        } else {
          // document is the canonical param for both basic (fileUpload) and advanced (filePath) modes
          const documentInput = params.document
          if (!documentInput) {
            throw new Error('Document is required')
          }
          if (typeof documentInput === 'object') {
            parameters.file = documentInput
          } else if (typeof documentInput === 'string') {
            parameters.filePath = documentInput.trim()
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
    document: { type: 'json', description: 'Document input (file upload or URL reference)' },
    s3Uri: { type: 'string', description: 'S3 URI for multi-page processing (s3://bucket/key)' },
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

const textractV2Inputs = TextractBlock.inputs ? { ...TextractBlock.inputs } : {}
const textractV2SubBlocks = (TextractBlock.subBlocks || []).flatMap((subBlock) => {
  if (subBlock.id === 'filePath') {
    return [] // Remove the old filePath subblock
  }
  if (subBlock.id === 'fileUpload') {
    // Insert fileReference right after fileUpload
    return [
      subBlock,
      {
        id: 'fileReference',
        title: 'Document',
        type: 'short-input' as SubBlockType,
        canonicalParamId: 'document',
        placeholder: 'File reference',
        condition: {
          field: 'processingMode',
          value: 'async',
          not: true,
        },
        mode: 'advanced' as const,
      },
    ]
  }
  return [subBlock]
})

export const TextractV2Block: BlockConfig<TextractParserOutput> = {
  ...TextractBlock,
  type: 'textract_v2',
  name: 'AWS Textract',
  hideFromToolbar: false,
  subBlocks: textractV2SubBlocks,
  tools: {
    access: ['textract_parser_v2'],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: () => 'textract_parser',
        suffix: '_v2',
        fallbackToolId: 'textract_parser_v2',
      }),
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
          if (!params.s3Uri || params.s3Uri.trim() === '') {
            throw new Error('S3 URI is required for multi-page processing')
          }
          parameters.s3Uri = params.s3Uri.trim()
        } else {
          // document is the canonical param for both basic (fileUpload) and advanced (fileReference) modes
          const file = normalizeFileInput(params.document, { single: true })
          if (!file) {
            throw new Error('Document file is required')
          }
          parameters.file = file
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
  inputs: textractV2Inputs,
}
