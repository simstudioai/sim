import { toError } from '@sim/utils/errors'
import { MistralIcon } from '@/components/icons'
import {
  AuthMode,
  type BlockConfig,
  type BlockMeta,
  IntegrationType,
  type SubBlockType,
} from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { MistralParserOutput } from '@/tools/mistral/types'

export const MistralParseBlock: BlockConfig<MistralParserOutput> = {
  type: 'mistral_parse',
  name: 'Mistral Parser (Legacy)',
  description: 'Extract text from PDF documents',
  hideFromToolbar: true,
  deprecated: { replacedBy: 'mistral_parse_v3' },
  authMode: AuthMode.ApiKey,
  longDescription: `Integrate Mistral Parse into the workflow. Can extract text from uploaded PDF documents, or from a URL.`,
  docsLink: 'https://docs.sim.ai/integrations/mistral_parse',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#000000',
  icon: MistralIcon,
  subBlocks: [
    {
      id: 'inputMethod',
      title: 'Select Input Method',
      type: 'dropdown' as SubBlockType,
      options: [
        { id: 'url', label: 'PDF Document URL' },
        { id: 'upload', label: 'Upload PDF Document' },
      ],
    },
    {
      id: 'filePath',
      title: 'PDF Document URL',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter full URL to a PDF document (https://example.com/document.pdf)',
      condition: {
        field: 'inputMethod',
        value: 'url',
      },
    },
    {
      id: 'fileUpload',
      title: 'Upload PDF',
      type: 'file-upload' as SubBlockType,
      acceptedTypes: 'application/pdf',
      condition: {
        field: 'inputMethod',
        value: 'upload',
      },
      maxSize: 50,
    },
    {
      id: 'resultType',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { id: 'markdown', label: 'Markdown (Formatted)' },
        { id: 'text', label: 'Plain Text' },
        { id: 'json', label: 'JSON (Raw)' },
      ],
    },
    {
      id: 'pages',
      title: 'Specific Pages',
      type: 'short-input',
      placeholder: 'e.g. 0,1,2 (leave empty for all pages)',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Mistral API key',
      password: true,
      required: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['mistral_parser'],
    config: {
      tool: () => 'mistral_parser',
      params: (params) => {
        const parameters: Record<string, unknown> = {
          resultType: params.resultType || 'markdown',
        }

        if (params.apiKey?.trim()) {
          parameters.apiKey = params.apiKey.trim()
        }

        const inputMethod = params.inputMethod || 'url'
        if (inputMethod === 'url') {
          if (!params.filePath || params.filePath.trim() === '') {
            throw new Error('PDF Document URL is required')
          }
          parameters.filePath = params.filePath.trim()
        } else if (inputMethod === 'upload') {
          if (!params.fileUpload) {
            throw new Error('Please upload a PDF document')
          }
          parameters.file = params.fileUpload
        }

        let pagesArray: number[] | undefined
        if (params.pages && params.pages.trim() !== '') {
          try {
            pagesArray = params.pages
              .split(',')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
              .map((p: string) => {
                const num = Number.parseInt(p, 10)
                if (Number.isNaN(num) || num < 0) {
                  throw new Error(`Invalid page number: ${p}`)
                }
                return num
              })

            if (pagesArray && pagesArray.length === 0) {
              pagesArray = undefined
            }
          } catch (error: unknown) {
            const errorMessage = toError(error).message
            throw new Error(`Page number format error: ${errorMessage}`)
          }
        }

        if (pagesArray && pagesArray.length > 0) {
          parameters.pages = pagesArray
        }

        return parameters
      },
    },
  },
  inputs: {
    inputMethod: { type: 'string', description: 'Input method selection' },
    filePath: { type: 'string', description: 'PDF document URL' },
    fileUpload: { type: 'json', description: 'Uploaded PDF file' },
    apiKey: { type: 'string', description: 'Mistral API key' },
    resultType: { type: 'string', description: 'Output format type' },
    pages: { type: 'string', description: 'Page selection' },
  },
  outputs: {
    content: { type: 'string', description: 'Extracted content' },
    metadata: { type: 'json', description: 'Processing metadata' },
  },
}

/**
 * V2 Block - Restored from main branch for backwards compatibility
 * Hidden from toolbar, uses filePath subblock ID for advanced mode
 */
export const MistralParseV2Block: BlockConfig<MistralParserOutput> = {
  ...MistralParseBlock,
  type: 'mistral_parse_v2',
  name: 'Mistral Parser',
  description: 'Extract text from PDF documents',
  hideFromToolbar: true,
  deprecated: { replacedBy: 'mistral_parse_v3' },
  subBlocks: [
    {
      id: 'fileUpload',
      title: 'PDF Document',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'document',
      acceptedTypes: 'application/pdf',
      placeholder: 'Upload a PDF document',
      mode: 'basic',
      maxSize: 50,
    },
    {
      id: 'filePath',
      title: 'PDF Document',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'document',
      placeholder: 'Document URL',
      mode: 'advanced',
    },
    {
      id: 'resultType',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { id: 'markdown', label: 'Markdown' },
        { id: 'text', label: 'Plain Text' },
        { id: 'json', label: 'JSON' },
      ],
    },
    {
      id: 'pages',
      title: 'Specific Pages',
      type: 'short-input',
      placeholder: 'e.g. 0,1,2 (leave empty for all pages)',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Mistral API key',
      password: true,
      required: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['mistral_parser_v2'],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: () => 'mistral_parser',
        suffix: '_v2',
        fallbackToolId: 'mistral_parser_v2',
      }),
      params: (params) => {
        const parameters: Record<string, unknown> = {
          resultType: params.resultType || 'markdown',
        }

        if (params.apiKey?.trim()) {
          parameters.apiKey = params.apiKey.trim()
        }

        // Use canonical document param directly
        const documentInput = params.document
        if (!documentInput) {
          throw new Error('PDF document is required')
        }
        // Smart handling: object → fileUpload param, string → filePath param
        if (typeof documentInput === 'object') {
          parameters.fileUpload = documentInput
        } else if (typeof documentInput === 'string') {
          parameters.filePath = documentInput.trim()
        }

        let pagesArray: number[] | undefined
        if (params.pages && params.pages.trim() !== '') {
          try {
            pagesArray = params.pages
              .split(',')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
              .map((p: string) => {
                const num = Number.parseInt(p, 10)
                if (Number.isNaN(num) || num < 0) {
                  throw new Error(`Invalid page number: ${p}`)
                }
                return num
              })

            if (pagesArray && pagesArray.length === 0) {
              pagesArray = undefined
            }
          } catch (error: unknown) {
            const errorMessage = toError(error).message
            throw new Error(`Page number format error: ${errorMessage}`)
          }
        }

        if (pagesArray && pagesArray.length > 0) {
          parameters.pages = pagesArray
        }

        return parameters
      },
    },
  },
  inputs: {
    document: { type: 'json', description: 'Document input (file upload or URL reference)' },
    apiKey: { type: 'string', description: 'Mistral API key' },
    resultType: { type: 'string', description: 'Output format type' },
    pages: { type: 'string', description: 'Page selection' },
  },
  outputs: {
    pages: { type: 'array', description: 'Array of page objects from Mistral OCR' },
    model: { type: 'string', description: 'Mistral OCR model identifier' },
    usage_info: { type: 'json', description: 'Usage statistics from the API' },
    document_annotation: { type: 'string', description: 'Structured annotation data' },
  },
}

/**
 * V3 Block - New file handling pattern with UserFile normalization
 * Uses fileReference subblock ID with canonicalParamId for proper file handling
 */
export const MistralParseV3Block: BlockConfig<MistralParserOutput> = {
  ...MistralParseBlock,
  deprecated: undefined,
  type: 'mistral_parse_v3',
  name: 'Mistral Parser',
  description: 'Extract text from PDF documents',
  hideFromToolbar: false,
  subBlocks: [
    {
      id: 'fileUpload',
      title: 'PDF Document',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'document',
      acceptedTypes: 'application/pdf',
      placeholder: 'Upload a PDF document',
      mode: 'basic',
      maxSize: 50,
      required: true,
    },
    {
      id: 'fileReference',
      title: 'File Reference',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'document',
      placeholder: 'File reference from previous block',
      mode: 'advanced',
      required: true,
    },
    {
      id: 'resultType',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { id: 'markdown', label: 'Markdown' },
        { id: 'text', label: 'Plain Text' },
        { id: 'json', label: 'JSON' },
      ],
    },
    {
      id: 'pages',
      title: 'Specific Pages',
      type: 'short-input',
      placeholder: 'e.g. 0,1,2 (leave empty for all pages)',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Mistral API key',
      password: true,
      required: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['mistral_parser_v3'],
    config: {
      tool: () => 'mistral_parser_v3',
      params: (params) => {
        const parameters: Record<string, unknown> = {
          resultType: params.resultType || 'markdown',
        }

        if (params.apiKey?.trim()) {
          parameters.apiKey = params.apiKey.trim()
        }

        // V3 pattern: use canonical document param directly
        const documentInput = normalizeFileInput(params.document, { single: true })
        if (!documentInput) {
          throw new Error('PDF document is required')
        }
        parameters.file = documentInput

        let pagesArray: number[] | undefined
        if (params.pages && params.pages.trim() !== '') {
          try {
            pagesArray = params.pages
              .split(',')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
              .map((p: string) => {
                const num = Number.parseInt(p, 10)
                if (Number.isNaN(num) || num < 0) {
                  throw new Error(`Invalid page number: ${p}`)
                }
                return num
              })

            if (pagesArray && pagesArray.length === 0) {
              pagesArray = undefined
            }
          } catch (error: unknown) {
            const errorMessage = toError(error).message
            throw new Error(`Page number format error: ${errorMessage}`)
          }
        }

        if (pagesArray && pagesArray.length > 0) {
          parameters.pages = pagesArray
        }

        return parameters
      },
    },
  },
  inputs: {
    document: { type: 'json', description: 'Document input (file upload or file reference)' },
    apiKey: { type: 'string', description: 'Mistral API key' },
    resultType: { type: 'string', description: 'Output format type' },
    pages: { type: 'string', description: 'Page selection' },
  },
  outputs: {
    pages: { type: 'array', description: 'Array of page objects from Mistral OCR' },
    model: { type: 'string', description: 'Mistral OCR model identifier' },
    usage_info: { type: 'json', description: 'Usage statistics from the API' },
    document_annotation: { type: 'string', description: 'Structured annotation data' },
  },
}

export const MistralParseBlockMeta = {
  tags: ['document-processing', 'ocr'],
  url: 'https://mistral.ai',
  templates: [
    {
      icon: MistralIcon,
      title: 'Mistral Parser for complex PDFs',
      prompt:
        'Create a workflow that uses Mistral Parser to convert dense research PDFs into clean Markdown, saves the Markdown to files, and indexes them into a knowledge base for downstream agents.',
      modules: ['knowledge-base', 'files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'automation'],
    },
    {
      icon: MistralIcon,
      title: 'Mistral Parser bank statement reader',
      prompt:
        'Create a workflow that uses Mistral Parser to extract structured transactions from uploaded bank statement PDFs, writes each transaction to a finance table, and classifies expense category.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: MistralIcon,
      title: 'Mistral Parser research-paper digester',
      prompt:
        'Build a scheduled workflow that watches a research-paper folder, parses each PDF with Mistral Parser, and writes clean Markdown summaries for the knowledge base.',
      modules: ['knowledge-base', 'files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: MistralIcon,
      title: 'Mistral Parser legal-doc summarizer',
      prompt:
        'Create a workflow that processes legal documents with Mistral Parser, extracts the key clauses and obligations into a table, and writes a one-pager summary file.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'analysis'],
    },
    {
      icon: MistralIcon,
      title: 'Mistral Parser invoice intake',
      prompt:
        'Build a workflow that runs each incoming invoice PDF through Mistral Parser, extracts vendor, line items, totals, and due date into an accounts-payable table, and flags any invoice missing a PO number for the finance team in Slack.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MistralIcon,
      title: 'Mistral Parser scanned-contract indexer',
      prompt:
        'Create a workflow that parses scanned, image-only contracts with Mistral Parser OCR, converts them to searchable Markdown, and indexes the result into a knowledge base so legal can search obligations across every signed agreement.',
      modules: ['knowledge-base', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'ocr', 'research'],
    },
    {
      icon: MistralIcon,
      title: 'Mistral Parser resume screener',
      prompt:
        'Build a workflow that parses uploaded resume PDFs with Mistral Parser, extracts candidate skills, experience, and contact details into a hiring table, and posts a shortlist summary to the recruiting channel in Slack.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hiring', 'automation', 'analysis'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'pdf-to-markdown',
      description: 'Convert a PDF document into clean structured Markdown using Mistral OCR.',
      content:
        '# PDF to Markdown\n\nUse Mistral Parser to turn a PDF, including scanned image-only pages, into clean Markdown.\n\n## Steps\n1. Provide the PDF as a URL or uploaded file to the parser.\n2. Run the parse to extract text, headings, tables, and layout into Markdown.\n3. Review the Markdown for page-break artifacts and stray headers or footers and clean them.\n\n## Output\nReturn the full Markdown. Note the page count and flag any pages where OCR confidence looked low.',
    },
    {
      name: 'extract-document-fields',
      description:
        'Parse a PDF and pull specific structured fields such as totals, dates, or names.',
      content:
        '# Extract Document Fields\n\nExtract a defined set of fields from a document such as an invoice, statement, or contract.\n\n## Steps\n1. Run Mistral Parser on the source PDF to get the text content.\n2. Locate the requested fields (for example vendor, total, due date, line items) within the parsed text.\n3. Return the fields as a structured object, leaving any field that is genuinely absent as null rather than guessing.\n\n## Output\nA JSON object keyed by the requested field names. List any fields that could not be found.',
    },
    {
      name: 'summarize-long-document',
      description: 'Parse a long PDF and produce a concise summary of its key points.',
      content:
        '# Summarize Long Document\n\nProduce a readable summary from a long PDF such as a report, paper, or agreement.\n\n## Steps\n1. Parse the PDF with Mistral Parser to get its full text.\n2. Identify the main sections and the most important claims, findings, or obligations.\n3. Write a tight summary that preserves specifics like figures and dates.\n\n## Output\nA short summary with a few bullet highlights. Keep numbers and named entities exact.',
    },
  ],
} as const satisfies BlockMeta
