import { TextractIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const TextractBlockDisplay = {
  type: 'textract',
  name: 'AWS Textract',
  description: 'Extract text, tables, and forms from documents',
  category: 'tools',
  bgColor: 'linear-gradient(135deg, #055F4E 0%, #56C0A7 100%)',
  icon: TextractIcon,
  iconColor: '#56C0A7',
  longDescription: `Integrate AWS Textract into your workflow to extract text, tables, forms, and key-value pairs from documents. Single-page mode supports JPEG, PNG, and single-page PDF. Multi-page mode supports multi-page PDF and TIFF.`,
  docsLink: 'https://docs.sim.ai/integrations/textract',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const TextractV2BlockDisplay = {
  ...TextractBlockDisplay,
  type: 'textract_v2',
  name: 'AWS Textract',
  hideFromToolbar: false,
} satisfies BlockDisplay

export const TextractBlockMeta = {
  tags: ['document-processing', 'ocr', 'cloud'],
  url: 'https://aws.amazon.com/textract',
  templates: [
    {
      icon: TextractIcon,
      title: 'Textract invoice extractor',
      prompt:
        'Create a scheduled workflow that polls an S3 folder for new PDFs, runs AWS Textract to extract line items and totals, writes the structured fields to a table, and flags invoices that fail validation.',
      modules: ['scheduled', 'tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: TextractIcon,
      title: 'Receipt OCR for expense reports',
      prompt:
        'Build a workflow that processes Gmail attachments with AWS Textract, extracts vendor, date, total, and category, logs each receipt to an expense table, and tags reimbursable items.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: TextractIcon,
      title: 'Textract ID verification',
      prompt:
        'Build a workflow that runs uploaded ID documents through AWS Textract analyze-id, extracts name, DOB, and ID number, validates against a customer record, and flags mismatches for review.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'automation'],
    },
    {
      icon: TextractIcon,
      title: 'Textract form-to-table',
      prompt:
        'Build a workflow that pushes scanned forms from Google Drive through AWS Textract analyze-document, extracts key-value pairs and tables, and writes structured rows to a Sim table for downstream automations.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'enterprise'],
      alsoIntegrations: ['google_drive'],
    },
    {
      icon: TextractIcon,
      title: 'Textract + Reducto cross-format extractor',
      prompt:
        'Create a workflow that ingests mixed PDF and image files, routes images through AWS Textract and dense PDFs through Reducto, normalizes fields, and writes rows to a table.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'analysis'],
      alsoIntegrations: ['reducto'],
    },
    {
      icon: TextractIcon,
      title: 'Textract + Extend pipeline composer',
      prompt:
        'Build a workflow that uses AWS Textract for layout-aware OCR and Extend for structured field extraction, fusing outputs into clean records for downstream automations.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['extend'],
    },
    {
      icon: TextractIcon,
      title: 'Textract handwritten-note digitizer',
      prompt:
        'Build a workflow that runs scanned handwritten intake notes through AWS Textract, converts the recognized text into clean Markdown, indexes it into a knowledge base, and posts a confidence summary to Slack so low-confidence pages get a human review.',
      modules: ['files', 'knowledge-base', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ocr', 'automation', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'extract-invoice-fields',
      description:
        'Run an invoice or receipt through AWS Textract and return clean structured fields (vendor, date, totals, line items). Use when you need to digitize finance documents.',
      content:
        '# Extract Invoice Fields\n\nUse AWS Textract to pull structured data from an invoice or receipt image/PDF.\n\n## Steps\n1. Choose the processing mode: Single Page for JPEG, PNG, or one-page PDF; Multi-Page for multi-page PDF/TIFF staged in S3.\n2. Provide the document (upload, file reference, or S3 URI) and enable Extract Forms and Extract Tables so key-value pairs and line items are captured.\n3. Run the extraction and read the returned blocks (KEY_VALUE_SET, TABLE, CELL, LINE).\n4. Map key-value pairs to fields: vendor, invoice number, invoice date, due date, subtotal, tax, and total.\n5. Reconstruct line items from the TABLE/CELL blocks into rows with description, quantity, unit price, and amount.\n\n## Output\nReturn a clean JSON record with the header fields and a line-items array. Flag any field where Textract confidence is low or the totals do not reconcile so a human can review.',
    },
    {
      name: 'extract-form-key-values',
      description:
        'Turn a scanned form into structured key-value pairs and tables using AWS Textract. Use for intake forms, applications, and contracts.',
      content:
        '# Extract Form Key-Values\n\nDigitize a scanned form into structured data.\n\n## Steps\n1. Select Single Page mode for an image or one-page PDF, or Multi-Page mode with an S3 URI for longer documents.\n2. Enable Extract Forms (key-value pairs) and, if the form has tables, Extract Tables. Enable Analyze Document Layout for complex multi-column forms.\n3. Run the extraction and parse the KEY_VALUE_SET blocks into field-name to field-value pairs.\n4. Normalize field names (trim labels, lowercase keys) and coerce values like dates and numbers.\n\n## Output\nReturn a flat object of normalized field names to values, plus any extracted tables as arrays of rows. Note pages or fields with low confidence for review.',
    },
    {
      name: 'ocr-document-to-text',
      description:
        'Convert a scanned document or image into plain readable text with AWS Textract OCR. Use to digitize handwritten notes, faxes, or image-only PDFs for indexing or search.',
      content:
        '# OCR Document To Text\n\nExtract readable text from a scanned or image-only document.\n\n## Steps\n1. Pick the processing mode that matches the file: Single Page for an image or one-page PDF, Multi-Page (S3) for multi-page documents.\n2. Provide the document and run the extraction. Plain OCR does not require the Forms or Tables features.\n3. Read the LINE and WORD blocks and join LINE blocks in reading order to reconstruct the text.\n4. Preserve paragraph and page breaks using the PAGE blocks.\n\n## Output\nReturn the full extracted text as clean Markdown, grouped by page. Include the page count from document metadata and surface any low-confidence lines so they can be reviewed before indexing.',
    },
  ],
} as const satisfies BlockMeta
