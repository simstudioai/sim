import { ExtendIcon } from '@/components/icons'
import {
  AuthMode,
  type BlockConfig,
  type BlockMeta,
  IntegrationType,
  type SubBlockType,
} from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { ExtendParserOutput } from '@/tools/extend/types'

export const ExtendBlock: BlockConfig<ExtendParserOutput> = {
  type: 'extend',
  name: 'Extend',
  description: 'Parse and extract content from documents',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Extend AI into the workflow. Parse and extract structured content from documents including PDFs, images, and Office files.',
  docsLink: 'https://docs.sim.ai/integrations/extend',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#000000',
  icon: ExtendIcon,
  subBlocks: [
    {
      id: 'fileUpload',
      title: 'Document',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'document',
      acceptedTypes:
        'application/pdf,image/jpeg,image/png,image/tiff,image/gif,image/bmp,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
      id: 'outputFormat',
      title: 'Output Format',
      type: 'dropdown',
      options: [
        { id: 'markdown', label: 'Markdown' },
        { id: 'spatial', label: 'Spatial' },
      ],
    },
    {
      id: 'chunking',
      title: 'Chunking Strategy',
      type: 'dropdown',
      options: [
        { id: 'page', label: 'Page' },
        { id: 'document', label: 'Document' },
        { id: 'section', label: 'Section' },
      ],
    },
    {
      id: 'engine',
      title: 'Engine',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { id: 'parse_performance', label: 'Performance' },
        { id: 'parse_light', label: 'Light' },
      ],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as SubBlockType,
      placeholder: 'Enter your Extend API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['extend_parser'],
    config: {
      tool: () => 'extend_parser',
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

        if (params.outputFormat) {
          parameters.outputFormat = params.outputFormat
        }

        if (params.chunking) {
          parameters.chunking = params.chunking
        }

        if (params.engine) {
          parameters.engine = params.engine
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
    apiKey: { type: 'string', description: 'Extend API key' },
    outputFormat: { type: 'string', description: 'Output format (markdown or spatial)' },
    chunking: { type: 'string', description: 'Chunking strategy' },
    engine: { type: 'string', description: 'Parsing engine' },
  },
  outputs: {
    id: { type: 'string', description: 'Unique identifier for the parser run' },
    status: { type: 'string', description: 'Processing status' },
    chunks: { type: 'json', description: 'Parsed document content chunks' },
    blocks: { type: 'json', description: 'Block-level document elements' },
    pageCount: { type: 'number', description: 'Number of pages processed' },
    creditsUsed: { type: 'number', description: 'API credits consumed' },
  },
}

const extendV2Inputs = {
  file: { type: 'json' as const, description: 'Document (file upload or file reference)' },
  apiKey: ExtendBlock.inputs?.apiKey,
  outputFormat: ExtendBlock.inputs?.outputFormat,
  chunking: ExtendBlock.inputs?.chunking,
  engine: ExtendBlock.inputs?.engine,
}
const extendV2SubBlocks = (ExtendBlock.subBlocks || []).flatMap((subBlock) => {
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
        placeholder: 'Connect a file output from another block',
        mode: 'advanced' as const,
        required: true,
      },
    ]
  }
  return [subBlock]
})

export const ExtendV2Block: BlockConfig<ExtendParserOutput> = {
  ...ExtendBlock,
  type: 'extend_v2',
  name: 'Extend',
  hideFromToolbar: false,
  longDescription:
    'Integrate Extend AI into the workflow. Parse and extract structured content from documents or file references.',
  subBlocks: extendV2SubBlocks,
  tools: {
    access: ['extend_parser_v2'],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: () => 'extend_parser',
        suffix: '_v2',
        fallbackToolId: 'extend_parser_v2',
      }),
      params: (params) => {
        const parameters: Record<string, unknown> = {
          apiKey: params.apiKey.trim(),
        }

        const documentInput = normalizeFileInput(params.file, { single: true })
        if (!documentInput) {
          throw new Error('Document file is required')
        }
        parameters.file = documentInput

        if (params.outputFormat) {
          parameters.outputFormat = params.outputFormat
        }

        if (params.chunking) {
          parameters.chunking = params.chunking
        }

        if (params.engine) {
          parameters.engine = params.engine
        }

        return parameters
      },
    },
  },
  inputs: extendV2Inputs,
}

export const ExtendBlockMeta = {
  tags: ['document-processing', 'ocr'],
  url: 'https://www.extend.ai',
  templates: [
    {
      icon: ExtendIcon,
      title: 'Extend structured-data extractor',
      prompt:
        'Build a workflow that runs uploaded forms through Extend to pull labelled fields, writes the structured rows to a table, and notifies Slack on missing required fields.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ExtendIcon,
      title: 'Extend insurance claim ingester',
      prompt:
        'Create a workflow that uses Extend to ingest claim forms, extracts policy number, claim amount, and incident details to structured rows, and routes high-value claims to a Slack adjuster channel.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ExtendIcon,
      title: 'Extend purchase-order extractor',
      prompt:
        'Create a workflow that processes inbound PO PDFs with Extend, writes vendor, SKU, quantity, and total to an orders table, and pings Slack when a PO exceeds the approval threshold.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ExtendIcon,
      title: 'Extend + ElevenLabs spoken-summary',
      prompt:
        'Build a workflow that uses Extend to pull structured data from a document, then narrates the summary with ElevenLabs, producing an audio briefing for stakeholders.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'communication'],
      alsoIntegrations: ['elevenlabs'],
    },
    {
      icon: ExtendIcon,
      title: 'Extend KYC pipeline',
      prompt:
        'Build a workflow that runs Extend on uploaded KYC documents, validates extracted fields against a compliance rule set, and writes outcomes to a verification table.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'automation'],
    },
    {
      icon: ExtendIcon,
      title: 'Extend invoice processor',
      prompt:
        'Create a workflow that parses uploaded vendor invoices with Extend, extracts line items, totals, and due dates, validates against the matching purchase order, and writes approved invoices to an accounts-payable table for payment.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation', 'document-processing'],
    },
    {
      icon: ExtendIcon,
      title: 'Extend contract data extractor',
      prompt:
        'Build a workflow that runs Extend on uploaded contracts to pull parties, term dates, renewal clauses, and obligations, summarizes the key risks with an agent, and logs the structured fields to a contracts table for the legal team.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'document-processing', 'automation'],
    },
  ],
  skills: [
    {
      name: 'extract-invoice-fields',
      description:
        'Parse an uploaded invoice with Extend and return structured vendor, line item, and total fields.',
      content:
        '# Extract Invoice Fields\n\nUse Extend to turn an invoice PDF or image into structured, validated data.\n\n## Steps\n1. Take the uploaded invoice document (file upload or URL).\n2. Run the Extend parser to produce structured chunks and blocks.\n3. Pull the key fields: vendor name, invoice number, invoice date, due date, line items (description, quantity, unit price), subtotal, tax, and total.\n4. Validate that totals add up and that required fields are present; flag any that are missing or inconsistent.\n\n## Output\nReturn a clean JSON object with the extracted fields plus a list of any validation warnings. Note the page count and credits used so cost can be tracked.',
    },
    {
      name: 'parse-document-to-markdown',
      description:
        'Convert a scanned or complex document into clean, LLM-ready markdown using Extend.',
      content:
        '# Parse Document to Markdown\n\nUse Extend to convert any supported document (PDF, image, or Office file) into clean markdown an agent can reason over.\n\n## Steps\n1. Take the source document and choose a chunking strategy (page, section, or document) based on how the content will be consumed.\n2. Run the Extend parser with markdown output.\n3. Stitch the returned chunks into a single ordered markdown document, preserving headings, tables, and lists.\n\n## Output\nReturn the full markdown text plus the page count. If the document was chunked, also return the per-chunk markdown so downstream steps can process sections independently.',
    },
    {
      name: 'classify-and-route-document',
      description:
        'Parse an uploaded document with Extend, identify its type, and route it to the right downstream handler.',
      content:
        '# Classify and Route Document\n\nUse Extend to read an incoming document and decide where it should go.\n\n## Steps\n1. Run the Extend parser on the uploaded document to get its text content.\n2. Inspect the parsed content to classify the document type (e.g. invoice, contract, claim form, purchase order, KYC document).\n3. Pull the few identifying fields needed for routing (such as document type, reference number, and amount).\n4. Decide the destination queue, table, or channel based on the classification and any thresholds.\n\n## Output\nReturn the detected document type, the routing decision, and the extracted routing fields. Note any document that could not be confidently classified for manual review.',
    },
  ],
} as const satisfies BlockMeta
