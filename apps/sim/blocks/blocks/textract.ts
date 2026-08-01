import { TextractIcon } from '@/components/icons'
import {
  AuthMode,
  type BlockConfig,
  type BlockMeta,
  IntegrationType,
  type SubBlockType,
} from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { TextractParserOutput } from '@/tools/textract/types'

export const TextractBlock: BlockConfig<TextractParserOutput> = {
  type: 'textract',
  name: 'AWS Textract',
  description: 'Extract text, tables, and forms from documents',
  hideFromToolbar: true,
  sunset: { status: 'legacy', replacedBy: 'textract_v2' },
  authMode: AuthMode.ApiKey,
  longDescription: `Integrate AWS Textract into your workflow to extract text, tables, forms, and key-value pairs from documents. Single-page mode supports JPEG, PNG, and single-page PDF. Multi-page mode supports multi-page PDF and TIFF.`,
  docsLink: 'https://docs.sim.ai/integrations/textract',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: 'linear-gradient(135deg, #055F4E 0%, #56C0A7 100%)',
  iconColor: '#56C0A7',
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

/**
 * The front-document fields (fileUpload/fileReference) are shared by all three operations.
 * Analyze Identity Document is always synchronous, so they must stay visible for it regardless
 * of a stale `processingMode` value left over from switching away from another operation.
 */
function documentFieldCondition(values?: Record<string, unknown>) {
  if (values?.operation === 'analyze_id') {
    return { field: 'operation', value: 'analyze_id' } as const
  }
  return { field: 'processingMode', value: 'async', not: true } as const
}

/**
 * Resolves a canonical document input to either an uploaded file object or a plain URL string.
 * `normalizeFileInput` only recognizes file objects (or JSON-serialized file references) — a raw
 * URL typed into the "File reference" advanced field falls through to `filePath` instead.
 */
function resolveDocumentParam(value: unknown): { file?: object; filePath?: string } {
  const file = normalizeFileInput(value, { single: true })
  if (file) return { file }
  if (typeof value === 'string' && value.trim() !== '') return { filePath: value.trim() }
  return {}
}

function requireAwsCredentials(params: Record<string, unknown>) {
  const accessKeyId = typeof params.accessKeyId === 'string' ? params.accessKeyId.trim() : ''
  const secretAccessKey =
    typeof params.secretAccessKey === 'string' ? params.secretAccessKey.trim() : ''
  const region = typeof params.region === 'string' ? params.region.trim() : ''

  if (!accessKeyId) throw new Error('AWS Access Key ID is required')
  if (!secretAccessKey) throw new Error('AWS Secret Access Key is required')
  if (!region) throw new Error('AWS Region is required')

  return { accessKeyId, secretAccessKey, region }
}

export const TextractV2Block: BlockConfig<TextractParserOutput> = {
  ...TextractBlock,
  sunset: undefined,
  type: 'textract_v2',
  name: 'AWS Textract',
  hideFromToolbar: false,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown' as SubBlockType,
      options: [
        { id: 'analyze_document', label: 'Analyze Document (Text, Tables, Forms)' },
        { id: 'analyze_expense', label: 'Analyze Expense (Invoices & Receipts)' },
        { id: 'analyze_id', label: 'Analyze Identity Document' },
      ],
      value: () => 'analyze_document',
    },
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
      condition: { field: 'operation', value: 'analyze_id', not: true },
    },
    {
      id: 'fileUpload',
      title: 'Document',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'document',
      acceptedTypes: 'image/jpeg,image/png,application/pdf',
      placeholder: 'Upload JPEG, PNG, or single-page PDF (max 10MB)',
      condition: documentFieldCondition,
      mode: 'basic',
      maxSize: 10,
    },
    {
      id: 'fileReference',
      title: 'Document',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'document',
      placeholder: 'File reference',
      condition: documentFieldCondition,
      mode: 'advanced' as const,
    },
    {
      id: 'fileUploadBack',
      title: 'Back of ID (optional)',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'documentBack',
      acceptedTypes: 'image/jpeg,image/png,application/pdf',
      placeholder: 'Upload the back of the ID, if it carries data',
      condition: { field: 'operation', value: 'analyze_id' },
      mode: 'basic',
      maxSize: 10,
    },
    {
      id: 'fileReferenceBack',
      title: 'Back of ID (optional)',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'documentBack',
      placeholder: 'File reference',
      condition: { field: 'operation', value: 'analyze_id' },
      mode: 'advanced' as const,
    },
    {
      id: 's3Uri',
      title: 'S3 URI',
      type: 'short-input' as SubBlockType,
      placeholder: 's3://bucket-name/path/to/document.pdf',
      condition: {
        field: 'processingMode',
        value: 'async',
        and: { field: 'operation', value: 'analyze_id', not: true },
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
      condition: { field: 'operation', value: 'analyze_document' },
    },
    {
      id: 'extractForms',
      title: 'Extract Forms (Key-Value Pairs)',
      type: 'switch' as SubBlockType,
      condition: { field: 'operation', value: 'analyze_document' },
    },
    {
      id: 'detectSignatures',
      title: 'Detect Signatures',
      type: 'switch' as SubBlockType,
      condition: { field: 'operation', value: 'analyze_document' },
    },
    {
      id: 'analyzeLayout',
      title: 'Analyze Document Layout',
      type: 'switch' as SubBlockType,
      condition: { field: 'operation', value: 'analyze_document' },
    },
  ],
  tools: {
    access: ['textract_parser_v2', 'textract_analyze_expense', 'textract_analyze_id'],
    config: {
      tool: (params) => {
        const operation = params.operation || 'analyze_document'
        if (operation === 'analyze_expense') return 'textract_analyze_expense'
        if (operation === 'analyze_id') return 'textract_analyze_id'
        return 'textract_parser_v2'
      },
      params: (params) => {
        const { accessKeyId, secretAccessKey, region } = requireAwsCredentials(params)
        const operation = params.operation || 'analyze_document'

        if (operation === 'analyze_id') {
          const front = resolveDocumentParam(params.document)
          if (!front.file && !front.filePath) throw new Error('Identity document is required')

          const parameters: Record<string, unknown> = {
            accessKeyId,
            secretAccessKey,
            region,
            ...front,
          }
          const back = resolveDocumentParam(params.documentBack)
          if (back.file) parameters.fileBack = back.file
          else if (back.filePath) parameters.filePathBack = back.filePath
          return parameters
        }

        const processingMode = params.processingMode || 'sync'
        const parameters: Record<string, unknown> = {
          accessKeyId,
          secretAccessKey,
          region,
          processingMode,
        }

        if (processingMode === 'async') {
          if (!params.s3Uri || params.s3Uri.trim() === '') {
            throw new Error('S3 URI is required for multi-page processing')
          }
          parameters.s3Uri = params.s3Uri.trim()
        } else if (operation === 'analyze_expense') {
          const resolved = resolveDocumentParam(params.document)
          if (!resolved.file && !resolved.filePath) throw new Error('Document file is required')
          Object.assign(parameters, resolved)
        } else {
          const file = normalizeFileInput(params.document, { single: true })
          if (!file) throw new Error('Document file is required')
          parameters.file = file
        }

        if (operation === 'analyze_expense') return parameters

        const featureTypes: string[] = []
        if (params.extractTables) featureTypes.push('TABLES')
        if (params.extractForms) featureTypes.push('FORMS')
        if (params.detectSignatures) featureTypes.push('SIGNATURES')
        if (params.analyzeLayout) featureTypes.push('LAYOUT')
        if (featureTypes.length > 0) parameters.featureTypes = featureTypes

        return parameters
      },
    },
  },
  inputs: {
    operation: {
      type: 'string',
      description: 'Operation: analyze_document, analyze_expense, or analyze_id',
    },
    processingMode: { type: 'string', description: 'Document type: single-page or multi-page' },
    document: { type: 'json', description: 'Document input (file upload or URL reference)' },
    documentBack: {
      type: 'json',
      description: 'Back-of-ID document input, for analyze_id (file upload or URL reference)',
    },
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
      condition: { field: 'operation', value: 'analyze_document' },
    },
    expenseDocuments: {
      type: 'json',
      description:
        '[{expenseIndex, summaryFields: [{type, valueDetection, currency}], lineItemGroups: [{lineItems}]}]',
      condition: { field: 'operation', value: 'analyze_expense' },
    },
    identityDocuments: {
      type: 'json',
      description:
        '[{documentIndex, identityDocumentFields: [{type: {text}, valueDetection: {text, normalizedValue}}]}]',
      condition: { field: 'operation', value: 'analyze_id' },
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
      title: 'Textract receipt OCR',
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
        'Run an invoice or receipt through AWS Textract Analyze Expense and return clean structured fields (vendor, date, totals, line items). Use when you need to digitize finance documents.',
      content:
        '# Extract Invoice Fields\n\nUse AWS Textract Analyze Expense to pull structured data from an invoice or receipt image/PDF.\n\n## Steps\n1. Set Operation to "Analyze Expense". Choose Single Page for JPEG, PNG, or one-page PDF, or Multi-Page for a PDF/TIFF staged in S3.\n2. Provide the document (upload, file reference, or S3 URI) and run the extraction.\n3. Read `expenseDocuments[].summaryFields` for header data (vendor, invoice number, invoice date, due date, subtotal, tax, total) and `expenseDocuments[].lineItemGroups[].lineItems` for purchased items.\n4. Map each summary field\'s normalized `type.text` (e.g., VENDOR_NAME, TOTAL, INVOICE_DATE) to your target schema, and read `valueDetection.text` for the value.\n\n## Output\nReturn a clean JSON record with the header fields and a line-items array. Flag any field where confidence is low or the totals do not reconcile so a human can review.',
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
    {
      name: 'verify-identity-document',
      description:
        'Run a government-issued ID through AWS Textract Analyze ID and return normalized identity fields (name, date of birth, ID number, expiration date). Use for KYC and identity-verification workflows.',
      content:
        '# Verify Identity Document\n\nUse AWS Textract Analyze ID to extract normalized fields from a driver\'s license, passport, or other identity document.\n\n## Steps\n1. Set Operation to "Analyze Identity Document".\n2. Upload the front of the ID. If the document carries data on both sides (e.g., a driver\'s license), also upload the back.\n3. Run the extraction and read `identityDocuments[].identityDocumentFields`, where each field has a normalized `type.text` (e.g., FIRST_NAME, LAST_NAME, DATE_OF_BIRTH, DOCUMENT_NUMBER, EXPIRATION_DATE) and a `valueDetection.text` (with `valueDetection.normalizedValue` for dates).\n4. Compare the extracted fields against the customer record you already have on file.\n\n## Output\nReturn a normalized identity record and flag any mismatch between the extracted fields and the existing customer record for human review.',
    },
  ],
} as const satisfies BlockMeta
