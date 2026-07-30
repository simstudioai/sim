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
  sunset: { status: 'legacy', replacedBy: 'pulse_v2' },
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Pulse into the workflow. Extract text from PDF documents, images, and Office files via URL or upload.',
  docsLink: 'https://docs.sim.ai/integrations/pulse',
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
  sunset: undefined,
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
  url: 'https://www.runpulse.com',
  templates: [
    {
      icon: PulseIcon,
      title: 'Pulse invoice extractor',
      prompt:
        'Create a workflow that runs each uploaded invoice PDF through Pulse OCR, extracts vendor, line items, and totals into structured fields, and writes the parsed records to an accounts-payable table.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['document-processing', 'automation'],
    },
    {
      icon: PulseIcon,
      title: 'Pulse contract clause extractor',
      prompt:
        'Build a workflow that extracts the full text of uploaded contract PDFs with Pulse OCR, has an agent pull out key clauses, parties, and renewal dates, and writes a structured summary to a table.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['document-processing', 'analysis'],
    },
    {
      icon: PulseIcon,
      title: 'Pulse scanned-document indexer',
      prompt:
        'Create a workflow that runs each scanned image or PDF through Pulse OCR, chunks the extracted markdown, and indexes the cleaned content into a knowledge base so agents can search across every document.',
      modules: ['files', 'knowledge-base', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ocr', 'knowledge-base'],
    },
    {
      icon: PulseIcon,
      title: 'Pulse form data extractor',
      prompt:
        'Build a workflow that extracts text from uploaded form PDFs and images with Pulse OCR, maps the values into structured fields with an agent, and writes each submission to a table.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ocr', 'automation'],
    },
    {
      icon: PulseIcon,
      title: 'Pulse table-to-spreadsheet extractor',
      prompt:
        'Create a workflow that runs uploaded reports through Pulse OCR, pulls the embedded tables into structured rows, and writes the consolidated data to a tracking table.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['document-processing', 'automation'],
    },
    {
      icon: PulseIcon,
      title: 'Pulse document summarizer',
      prompt:
        'Build a workflow that extracts the text of an uploaded PDF or Office file with Pulse OCR, has an agent write a concise summary, and posts it to Slack.',
      modules: ['files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['document-processing', 'automation'],
      alsoIntegrations: ['slack'],
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
  skills: [
    {
      name: 'extract-document-text',
      description: 'Run a PDF, image, or Office file through Pulse OCR and return clean markdown.',
      content:
        '# Extract Document Text\n\nTurn a document into structured markdown text.\n\n## Steps\n1. Upload the Document (PDF, image, DOCX, PPTX, or XLSX) or provide a file reference.\n2. Optionally set Specific Pages (for example 1-3,5) to limit extraction to part of the document.\n3. Provide the Pulse API Key.\n4. Use the returned markdown as the source for downstream summarization or parsing.\n\n## Output\nThe extracted markdown text and the page count, plus any bounding-box or figure data when available.',
    },
    {
      name: 'extract-structured-fields',
      description:
        'Use Pulse OCR output to pull structured fields like vendor, totals, or dates from a document.',
      content:
        '# Extract Structured Fields\n\nPull specific data points out of a scanned document.\n\n## Steps\n1. Run the document through Pulse OCR to get the markdown text.\n2. In a following agent step, map the markdown to the target fields (for example invoice vendor, line items, totals, or contract parties and renewal dates).\n3. Validate the parsed values against the source text before using them.\n\n## Output\nA structured record of the requested fields, with a note on any field that could not be confidently extracted from the document.',
    },
    {
      name: 'chunk-for-knowledge-base',
      description:
        'Extract and chunk a document with Pulse OCR so it can be indexed for retrieval.',
      content:
        '# Chunk For Knowledge Base\n\nPrepare a document for vector indexing.\n\n## Steps\n1. Upload the Document and provide the Pulse API Key.\n2. Set a Chunking Strategy (semantic, header, page, or recursive) and a Chunk Size in characters.\n3. Use the returned chunks as the units to embed and index into a knowledge base.\n\n## Output\nThe chunked content ready for embedding, with each chunk sized per the strategy, plus the total page count for reference.',
    },
  ],
} as const satisfies BlockMeta
