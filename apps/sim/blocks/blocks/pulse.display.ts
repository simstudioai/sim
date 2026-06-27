import { PulseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const PulseBlockDisplay = {
  type: 'pulse',
  name: 'Pulse',
  description: 'Extract text from documents using Pulse OCR',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: PulseIcon,
  longDescription:
    'Integrate Pulse into the workflow. Extract text from PDF documents, images, and Office files via URL or upload.',
  docsLink: 'https://docs.sim.ai/integrations/pulse',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const PulseV2BlockDisplay = {
  ...PulseBlockDisplay,
  type: 'pulse_v2',
  name: 'Pulse',
  longDescription:
    'Integrate Pulse into the workflow. Extract text from PDF documents, images, and Office files via upload or file references.',
  hideFromToolbar: false,
} satisfies BlockDisplay

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
