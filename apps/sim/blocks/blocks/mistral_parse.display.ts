import { MistralIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const MistralParseBlockDisplay = {
  type: 'mistral_parse',
  name: 'Mistral Parser (Legacy)',
  description: 'Extract text from PDF documents',
  category: 'tools',
  bgColor: '#000000',
  icon: MistralIcon,
  longDescription: `Integrate Mistral Parse into the workflow. Can extract text from uploaded PDF documents, or from a URL.`,
  docsLink: 'https://docs.sim.ai/integrations/mistral_parse',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const MistralParseV2BlockDisplay = {
  ...MistralParseBlockDisplay,
  type: 'mistral_parse_v2',
  name: 'Mistral Parser',
  description: 'Extract text from PDF documents',
  hideFromToolbar: true,
} satisfies BlockDisplay

export const MistralParseV3BlockDisplay = {
  ...MistralParseBlockDisplay,
  type: 'mistral_parse_v3',
  name: 'Mistral Parser',
  description: 'Extract text from PDF documents',
  hideFromToolbar: false,
} satisfies BlockDisplay

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
