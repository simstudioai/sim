import { PulseIcon } from '@/components/icons'
import {
  AuthMode,
  type BlockConfig,
  type BlockMeta,
  IntegrationType,
  type SubBlockType,
} from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { PulseParserOutput } from '@/tools/pulse/types'

export const PulseBlock: BlockConfig<PulseParserOutput> = {
  type: 'pulse',
  name: 'Pulse',
  description: 'Extract text from documents using Pulse OCR',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Pulse into the workflow. Extract text from PDF documents, images, and Office files via URL or upload.',
  docsLink: 'https://docs.sim.ai/tools/pulse',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#FFFFFF',
  icon: PulseIcon,
  subBlocks: [
    {
      id: 'fileUpload',
      title: 'Document',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'document',
      acceptedTypes: 'application/pdf,image/*,.docx,.pptx,.xlsx',
      placeholder: 'Upload a document',
      mode: 'basic',
      maxSize: 50,
      required: true,
    },
    {
      id: 'filePath',
      title: 'Document',
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
      placeholder: 'e.g. 1-3,5 (leave empty for all pages)',
    },
    {
      id: 'chunking',
      title: 'Chunking Strategy',
      type: 'short-input',
      placeholder: 'e.g. semantic,header,page,recursive',
    },
    {
      id: 'chunkSize',
      title: 'Chunk Size',
      type: 'short-input',
      placeholder: 'Max characters per chunk',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Pulse API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['pulse_parser'],
    config: {
      tool: () => 'pulse_parser',
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

        if (params.pages && params.pages.trim() !== '') {
          parameters.pages = params.pages.trim()
        }

        if (params.chunking && params.chunking.trim() !== '') {
          parameters.chunking = params.chunking.trim()
        }

        if (params.chunkSize && params.chunkSize.trim() !== '') {
          const size = Number.parseInt(params.chunkSize.trim(), 10)
          if (!Number.isNaN(size) && size > 0) {
            parameters.chunkSize = size
          }
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
    apiKey: { type: 'string', description: 'Pulse API key' },
    pages: { type: 'string', description: 'Page range selection' },
    chunking: {
      type: 'string',
      description: 'Chunking strategies (semantic, header, page, recursive)',
    },
    chunkSize: { type: 'string', description: 'Maximum characters per chunk' },
  },
  outputs: {
    markdown: { type: 'string', description: 'Extracted content in markdown format' },
    page_count: { type: 'number', description: 'Number of pages in the document' },
    job_id: { type: 'string', description: 'Unique job identifier' },
    'plan-info': { type: 'json', description: 'Plan usage information' },
    bounding_boxes: { type: 'json', description: 'Bounding box layout information' },
    extraction_url: { type: 'string', description: 'URL for extraction results (large documents)' },
    html: { type: 'string', description: 'HTML content if requested' },
    structured_output: { type: 'json', description: 'Structured output if schema was provided' },
    chunks: { type: 'json', description: 'Chunked content if chunking was enabled' },
    figures: { type: 'json', description: 'Extracted figures if figure extraction was enabled' },
  },
}

const pulseV2Inputs = {
  file: { type: 'json' as const, description: 'Document (file upload or file reference)' },
  apiKey: PulseBlock.inputs?.apiKey,
  pages: PulseBlock.inputs?.pages,
  chunking: PulseBlock.inputs?.chunking,
  chunkSize: PulseBlock.inputs?.chunkSize,
}
const pulseV2SubBlocks = (PulseBlock.subBlocks || []).flatMap((subBlock) => {
  if (subBlock.id === 'filePath') {
    return []
  }
  if (subBlock.id === 'fileUpload') {
    return [
      { ...subBlock, canonicalParamId: 'file' },
      {
        id: 'fileReference',
        title: 'Document',
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

export const PulseV2Block: BlockConfig<PulseParserOutput> = {
  ...PulseBlock,
  type: 'pulse_v2',
  name: 'Pulse',
  hideFromToolbar: false,
  longDescription:
    'Integrate Pulse into the workflow. Extract text from PDF documents, images, and Office files via upload or file references.',
  subBlocks: pulseV2SubBlocks,
  tools: {
    access: ['pulse_parser_v2'],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: () => 'pulse_parser',
        suffix: '_v2',
        fallbackToolId: 'pulse_parser_v2',
      }),
      params: (params) => {
        const parameters: Record<string, unknown> = {
          apiKey: params.apiKey.trim(),
        }

        const normalizedFile = normalizeFileInput(params.file, { single: true })
        if (!normalizedFile) {
          throw new Error('Document file is required')
        }
        parameters.file = normalizedFile

        if (params.pages && params.pages.trim() !== '') {
          parameters.pages = params.pages.trim()
        }

        if (params.chunking && params.chunking.trim() !== '') {
          parameters.chunking = params.chunking.trim()
        }

        if (params.chunkSize && params.chunkSize.trim() !== '') {
          const size = Number.parseInt(params.chunkSize.trim(), 10)
          if (!Number.isNaN(size) && size > 0) {
            parameters.chunkSize = size
          }
        }

        return parameters
      },
    },
  },
  inputs: pulseV2Inputs,
}

export const PulseBlockMeta = {
  tags: ['document-processing', 'ocr'],
  templates: [
    {
      icon: PulseIcon,
      title: 'Pulse meeting intelligence',
      prompt:
        'Create a workflow that pulls Pulse meeting recordings, extracts action items, sentiment, and decisions, and updates the related deal record in Salesforce or HubSpot with the meeting summary.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: PulseIcon,
      title: 'Pulse weekly call insights',
      prompt:
        'Build a scheduled weekly workflow that aggregates Pulse meeting insights — objections, action items, deal-stage signals — across the rep team, and posts a coaching digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PulseIcon,
      title: 'Pulse + DSPy call-pattern miner',
      prompt:
        'Create a workflow that uses Pulse meeting transcripts as a DSPy training dataset to optimize objection-handling prompts, captures wins, and writes the evolution to a coaching table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
      alsoIntegrations: ['dspy'],
    },
    {
      icon: PulseIcon,
      title: 'Pulse + Zep call-context memory',
      prompt:
        'Build a workflow that writes Pulse meeting insights into Zep memory per account so the next sales call begins with continuity instead of forgetting prior commitments.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['zep'],
    },
    {
      icon: PulseIcon,
      title: 'Pulse rep coaching dashboard',
      prompt:
        'Build a scheduled weekly workflow that aggregates Pulse meeting insights per sales rep, identifies coaching opportunities, and writes a personalized coaching plan to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
    },
    {
      icon: PulseIcon,
      title: 'Pulse churn-signal extractor',
      prompt:
        'Create a workflow that watches Pulse customer calls for churn signals — frustration, escalation language, competitor mentions — and writes high-risk accounts to a CS table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'analysis'],
    },
    {
      icon: PulseIcon,
      title: 'Pulse document OCR pipeline',
      prompt:
        'Build a workflow that runs each uploaded PDF, image, or Office file through Pulse OCR, extracts the text into structured rows in a table, and indexes the cleaned content into a knowledge base so agents can search across every scanned document.',
      modules: ['files', 'tables', 'knowledge-base', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ocr', 'document-processing', 'automation'],
    },
  ],
} as const satisfies BlockMeta
