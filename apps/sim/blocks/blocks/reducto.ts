import { toError } from '@sim/utils/errors'
import { ReductoIcon } from '@/components/icons'
import {
  AuthMode,
  type BlockConfig,
  type BlockMeta,
  IntegrationType,
  type SubBlockType,
} from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { ReductoParserOutput } from '@/tools/reducto/types'

export const ReductoBlock: BlockConfig<ReductoParserOutput> = {
  type: 'reducto',
  name: 'Reducto',
  description: 'Extract text from PDF documents',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  longDescription: `Integrate Reducto Parse into the workflow. Can extract text from uploaded PDF documents, or from a URL.`,
  docsLink: 'https://docs.sim.ai/tools/reducto',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#5c0c5c',
  icon: ReductoIcon,
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
      id: 'filePath',
      title: 'PDF Document',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'document',
      placeholder: 'Document URL',
      mode: 'advanced',
      required: true,
    },
    {
      id: 'pages',
      title: 'Specific Pages',
      type: 'short-input',
      placeholder: 'e.g. 1,2,3 (1-indexed, leave empty for all)',
    },
    {
      id: 'tableOutputFormat',
      title: 'Table Format',
      type: 'dropdown',
      options: [
        { id: 'md', label: 'Markdown' },
        { id: 'html', label: 'HTML' },
      ],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Reducto API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['reducto_parser'],
    config: {
      tool: () => 'reducto_parser',
      params: (params) => {
        const parameters: Record<string, unknown> = {
          apiKey: params.apiKey.trim(),
        }

        const documentInput = params.document

        if (typeof documentInput === 'object') {
          parameters.file = documentInput
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

        if (params.tableOutputFormat) {
          parameters.tableOutputFormat = params.tableOutputFormat
        }

        return parameters
      },
    },
  },
  inputs: {
    document: {
      type: 'json',
      description: 'Document input (canonical param for file upload or URL)',
    },
    apiKey: { type: 'string', description: 'Reducto API key' },
    pages: { type: 'string', description: 'Page selection' },
    tableOutputFormat: { type: 'string', description: 'Table output format' },
  },
  outputs: {
    job_id: { type: 'string', description: 'Unique identifier for the processing job' },
    duration: { type: 'number', description: 'Processing time in seconds' },
    usage: { type: 'json', description: 'Resource consumption data (num_pages, credits)' },
    result: { type: 'json', description: 'Parsed document content with chunks and blocks' },
    pdf_url: { type: 'string', description: 'Storage URL of converted PDF' },
    studio_link: { type: 'string', description: 'Link to Reducto studio interface' },
  },
}

const reductoV2Inputs = {
  file: { type: 'json' as const, description: 'PDF document (file upload or file reference)' },
  apiKey: ReductoBlock.inputs?.apiKey,
  pages: ReductoBlock.inputs?.pages,
  tableOutputFormat: ReductoBlock.inputs?.tableOutputFormat,
}
const reductoV2SubBlocks = (ReductoBlock.subBlocks || []).flatMap((subBlock) => {
  if (subBlock.id === 'filePath') {
    return []
  }
  if (subBlock.id === 'fileUpload') {
    return [
      { ...subBlock, canonicalParamId: 'file' },
      {
        id: 'fileReference',
        title: 'PDF Document',
        type: 'short-input' as SubBlockType,
        canonicalParamId: 'file',
        placeholder: 'File reference',
        mode: 'advanced' as const,
        required: true,
      },
    ]
  }
  return [subBlock]
})

export const ReductoV2Block: BlockConfig<ReductoParserOutput> = {
  ...ReductoBlock,
  type: 'reducto_v2',
  name: 'Reducto',
  hideFromToolbar: false,
  longDescription: `Integrate Reducto Parse into the workflow. Can extract text from uploaded PDF documents or file references.`,
  subBlocks: reductoV2SubBlocks,
  tools: {
    access: ['reducto_parser_v2'],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: () => 'reducto_parser',
        suffix: '_v2',
        fallbackToolId: 'reducto_parser_v2',
      }),
      params: (params) => {
        const parameters: Record<string, unknown> = {
          apiKey: params.apiKey.trim(),
        }

        const fileInput = normalizeFileInput(params.file, { single: true })
        if (!fileInput) {
          throw new Error('PDF document file is required')
        }
        parameters.file = fileInput

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

        if (params.tableOutputFormat) {
          parameters.tableOutputFormat = params.tableOutputFormat
        }

        return parameters
      },
    },
  },
  inputs: reductoV2Inputs,
}

export const ReductoBlockMeta = {
  tags: ['document-processing', 'ocr'],
  templates: [
    {
      icon: ReductoIcon,
      title: 'Reducto contract parser',
      prompt:
        'Create a workflow that uses Reducto to parse uploaded contract PDFs into structured clauses, writes payment terms, liability caps, and termination conditions to a table, and flags non-standard clauses.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'analysis'],
    },
    {
      icon: ReductoIcon,
      title: 'Reducto + knowledge base loader',
      prompt:
        'Build a workflow that parses every PDF in a Drive folder with Reducto, normalizes the structure, and upserts chunks into a knowledge base with section-aware metadata so retrieval returns the right passage.',
      modules: ['knowledge-base', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'sync'],
      alsoIntegrations: ['google_drive'],
    },
    {
      icon: ReductoIcon,
      title: 'Reducto medical-record digester',
      prompt:
        'Build a workflow that parses medical record PDFs with Reducto, extracts diagnoses, medications, and visit summaries to structured rows, and produces a patient-facing one-pager file.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
    },
    {
      icon: ReductoIcon,
      title: 'Reducto + Mem0 contract memory',
      prompt:
        'Create a workflow that parses contracts with Reducto and writes the key terms into Mem0 per counterparty, so future interactions reference the real contract terms.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'automation'],
      alsoIntegrations: ['mem0'],
    },
    {
      icon: ReductoIcon,
      title: 'Reducto invoice line-item extractor',
      prompt:
        'Build a workflow that parses incoming invoice PDFs with Reducto, extracts vendor, line items, tax, and totals into an accounts-payable table, and flags any invoice that fails to reconcile against its purchase order.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation', 'analysis'],
    },
    {
      icon: ReductoIcon,
      title: 'Reducto financial-statement digitizer',
      prompt:
        'Create a workflow that parses quarterly financial-statement PDFs with Reducto, extracts the balance sheet and income statement figures into structured rows, and writes a normalized table the finance team can chart over time.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis', 'reporting'],
    },
    {
      icon: ReductoIcon,
      title: 'Reducto form-intake router',
      prompt:
        'Build a workflow that runs each uploaded intake form through Reducto, extracts the applicant fields into a table, and routes the parsed submission to the right reviewer in Slack based on the form type.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'forms', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
} as const satisfies BlockMeta
