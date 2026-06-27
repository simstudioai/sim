import { ExtendIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ExtendBlockDisplay = {
  type: 'extend',
  name: 'Extend',
  description: 'Parse and extract content from documents',
  category: 'tools',
  bgColor: '#000000',
  icon: ExtendIcon,
  longDescription:
    'Integrate Extend AI into the workflow. Parse and extract structured content from documents including PDFs, images, and Office files.',
  docsLink: 'https://docs.sim.ai/integrations/extend',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const ExtendV2BlockDisplay = {
  ...ExtendBlockDisplay,
  type: 'extend_v2',
  name: 'Extend',
  longDescription:
    'Integrate Extend AI into the workflow. Parse and extract structured content from documents or file references.',
  hideFromToolbar: false,
} satisfies BlockDisplay

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
