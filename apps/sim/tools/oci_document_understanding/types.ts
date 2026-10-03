import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export type DocumentFeatureType =
  | 'TEXT_EXTRACTION'
  | 'TABLE_EXTRACTION'
  | 'KEY_VALUE_EXTRACTION'
  | 'DOCUMENT_CLASSIFICATION'
  | 'LANGUAGE_CLASSIFICATION'

export interface DocumentFeature {
  featureType: DocumentFeatureType
  modelId?: string
  tenancyId?: string
  maxResults?: number
  generateSearchablePdf?: boolean
  selectionMarkDetection?: boolean
}

export interface DocumentObjectLocation {
  namespaceName: string
  bucketName: string
  objectName: string
  pageRange?: string[]
}

export interface DocumentOutputLocation {
  namespaceName: string
  bucketName: string
  prefix: string
}

export interface OciDocumentParams {
  oauthCredential: string
  accessToken?: string
  region?: string
  compartmentId?: string
  source?: 'file' | 'objectStorage'
  file?: UserFile
  objects?: DocumentObjectLocation[]
  pageRange?: string[]
  features?: DocumentFeature[]
  documentType?: string
  language?: string
  outputLocation?: DocumentOutputLocation
  displayName?: string
  retryToken?: string
  jobId?: string
  objectName?: string
  resultType?: 'structured' | 'file'
  pageNumbers?: number[]
  maxPages?: number
  maxOutputBytes?: number
  includeWords?: boolean
  includeGeometry?: boolean
  projectId?: string
  modelId?: string
  modelType?: string
  modelSubType?: string
  lifecycleState?: string
  limit?: number
  page?: string
  start?: string
  ifMatch?: string
}

export interface DocumentGeometry {
  normalizedVertices: { x: number; y: number }[]
}

export interface DocumentText {
  text: string
  confidence?: number
  boundingPolygon?: DocumentGeometry
  wordIndexes?: number[]
}

export interface DocumentField {
  path: number[]
  fieldType: string
  fieldLabel?: { name: string; confidence?: number }
  fieldName?: {
    name: string
    confidence?: number
    boundingPolygon?: DocumentGeometry
    wordIndexes?: number[]
  }
  fieldValue?: {
    valueType: string
    text?: string
    stringValue?: string
    numberValue?: number
    confidence?: number
    normalizedValue?: string
    normalizedConfidence?: number
    boundingPolygon?: DocumentGeometry
    wordIndexes?: number[]
  }
}

export interface DocumentTable {
  rowCount: number
  columnCount: number
  confidence?: number
  boundingPolygon?: DocumentGeometry
  headerRows: { cells: (DocumentText & { rowIndex: number; columnIndex: number })[] }[]
  bodyRows: { cells: (DocumentText & { rowIndex: number; columnIndex: number })[] }[]
  footerRows: { cells: (DocumentText & { rowIndex: number; columnIndex: number })[] }[]
}

export interface DocumentPage {
  pageNumber: number
  dimensions: { width: number; height: number; unit: string }
  text: string
  lines: DocumentText[]
  words?: DocumentText[]
  tables: DocumentTable[]
  documentFields: DocumentField[]
  detectedDocumentTypes: { documentType: string; confidence: number }[]
  detectedLanguages: { language: string; confidence: number }[]
  selectionMarks: { state: string; confidence?: number; boundingPolygon?: DocumentGeometry }[]
}

export interface DocumentAnalysis {
  documentMetadata: { pageCount: number; mimeType: string }
  pages: DocumentPage[]
  detectedDocumentTypes: { documentType: string; confidence: number }[]
  detectedLanguages: { language: string; confidence: number }[]
  modelVersions: { feature: string; version: string }[]
  errors: { code: string; message: string }[]
  truncated: boolean
  truncationReasons: string[]
  returnedPageCount: number
  availablePageCount: number
}

export interface DocumentJob {
  id: string
  compartmentId: string
  displayName?: string
  lifecycleState: string
  lifecycleDetails?: string
  timeAccepted: string
  timeStarted?: string
  timeFinished?: string
  percentComplete?: number
  outputLocation: DocumentOutputLocation
  terminal: boolean
  partiallySucceeded: boolean
}

export interface DocumentModel {
  id: string
  modelSubType?: { modelType: string; modelSubType?: string }
  displayName?: string
  description?: string
  compartmentId?: string
  projectId?: string
  modelType?: string
  modelVersion?: string
  lifecycleState?: string
  lifecycleDetails?: string
  timeCreated?: string
  timeUpdated?: string
  language?: string
  aliasName?: string
  tenancyId?: string
}

export interface OciDocumentResponse extends ToolResponse {
  output: {
    opcRequestId?: string
    etag?: string
    analysis?: DocumentAnalysis
    job?: DocumentJob
    retryToken?: string
    cancellationRequested?: boolean
    jobId?: string
    objects?: { name: string; size?: number; etag?: string; timeCreated?: string }[]
    nextStartWith?: string | null
    file?: UserFile
    model?: DocumentModel
    models?: DocumentModel[]
    projects?: DocumentModel[]
    versions?: string[]
    capabilities?: { version: string; name: string; details: string[] }[]
    nextPage?: string | null
  }
}

export const DOCUMENT_CONFIDENCE_OUTPUT = {
  type: 'number',
  description: 'Provider confidence from 0 to 1',
  optional: true,
} as const

export const DOCUMENT_GEOMETRY_PROPERTIES = {
  normalizedVertices: {
    type: 'array',
    description: 'Normalized polygon vertices',
    items: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Normalized x coordinate' },
        y: { type: 'number', description: 'Normalized y coordinate' },
      },
    },
  },
} as const

export const DOCUMENT_GEOMETRY_OUTPUT = {
  type: 'object',
  description: 'Normalized geometry when requested',
  optional: true,
  properties: DOCUMENT_GEOMETRY_PROPERTIES,
} as const

export const DOCUMENT_WORD_INDEXES_OUTPUT = {
  type: 'array',
  description: 'Indices into the returned page words; omitted when words are omitted',
  optional: true,
  items: { type: 'number' },
} as const

export const DOCUMENT_TEXT_PROPERTIES = {
  text: { type: 'string', description: 'Recognized text' },
  confidence: DOCUMENT_CONFIDENCE_OUTPUT,
  boundingPolygon: DOCUMENT_GEOMETRY_OUTPUT,
  wordIndexes: DOCUMENT_WORD_INDEXES_OUTPUT,
} as const

export const DOCUMENT_FIELD_NAME_PROPERTIES = {
  name: { type: 'string', description: 'Field name' },
  confidence: DOCUMENT_CONFIDENCE_OUTPUT,
  boundingPolygon: DOCUMENT_GEOMETRY_OUTPUT,
  wordIndexes: DOCUMENT_WORD_INDEXES_OUTPUT,
} as const

export const DOCUMENT_FIELD_VALUE_PROPERTIES = {
  valueType: {
    type: 'string',
    description: 'STRING, DATE, TIME, PHONE_NUMBER, NUMBER, INTEGER or ARRAY',
  },
  text: { type: 'string', description: 'Recognized value text', optional: true },
  stringValue: {
    type: 'string',
    description: 'Provider string/date/time/phone value without date conversion',
    optional: true,
  },
  numberValue: { type: 'number', description: 'Provider numeric value', optional: true },
  normalizedValue: { type: 'string', description: 'Provider normalized value', optional: true },
  normalizedConfidence: {
    type: 'number',
    description: 'Normalization confidence from 0 to 1',
    optional: true,
  },
  confidence: DOCUMENT_CONFIDENCE_OUTPUT,
  boundingPolygon: DOCUMENT_GEOMETRY_OUTPUT,
  wordIndexes: DOCUMENT_WORD_INDEXES_OUTPUT,
} as const

export const DOCUMENT_FIELD_PROPERTIES = {
  path: {
    type: 'array',
    description: 'Sim-derived index path preserving nested array fields',
    items: { type: 'number' },
  },
  fieldType: { type: 'string', description: 'Provider field type' },
  fieldLabel: {
    type: 'object',
    optional: true,
    description: 'Detected label name and confidence',
    properties: {
      name: { type: 'string', description: 'Label name' },
      confidence: DOCUMENT_CONFIDENCE_OUTPUT,
    },
  },
  fieldName: {
    type: 'object',
    optional: true,
    description: 'Detected name, confidence, optional geometry and word indices',
    properties: DOCUMENT_FIELD_NAME_PROPERTIES,
  },
  fieldValue: {
    type: 'object',
    optional: true,
    description: 'Typed value; ARRAY children are separate fields with extended paths',
    properties: DOCUMENT_FIELD_VALUE_PROPERTIES,
  },
} as const

export const DOCUMENT_CELL_PROPERTIES = {
  ...DOCUMENT_TEXT_PROPERTIES,
  rowIndex: { type: 'number', description: 'Provider row index' },
  columnIndex: { type: 'number', description: 'Provider column index' },
} as const

export const DOCUMENT_TABLE_ROW_PROPERTIES = {
  cells: {
    type: 'array',
    description: 'Cells with text, confidence, row/column indices and optional geometry',
    items: { type: 'object', properties: DOCUMENT_CELL_PROPERTIES },
  },
} as const

export const DOCUMENT_TABLE_PROPERTIES = {
  rowCount: { type: 'number', description: 'Table row count' },
  columnCount: { type: 'number', description: 'Table column count' },
  confidence: DOCUMENT_CONFIDENCE_OUTPUT,
  boundingPolygon: DOCUMENT_GEOMETRY_OUTPUT,
  headerRows: {
    type: 'array',
    description: 'Header rows containing cells with text and row/column indices',
    items: { type: 'object', properties: DOCUMENT_TABLE_ROW_PROPERTIES },
  },
  bodyRows: {
    type: 'array',
    description: 'Body rows containing cells with text and row/column indices',
    items: { type: 'object', properties: DOCUMENT_TABLE_ROW_PROPERTIES },
  },
  footerRows: {
    type: 'array',
    description: 'Footer rows containing cells with text and row/column indices',
    items: { type: 'object', properties: DOCUMENT_TABLE_ROW_PROPERTIES },
  },
} as const

export const DOCUMENT_TYPE_OUTPUT = {
  type: 'array',
  description: 'Detected document classes',
  items: {
    type: 'object',
    properties: {
      documentType: { type: 'string', description: 'Document class' },
      confidence: { type: 'number', description: 'Confidence from 0 to 1' },
    },
  },
} as const

export const DOCUMENT_LANGUAGE_OUTPUT = {
  type: 'array',
  description: 'Detected languages',
  items: {
    type: 'object',
    properties: {
      language: { type: 'string', description: 'Language code' },
      confidence: { type: 'number', description: 'Confidence from 0 to 1' },
    },
  },
} as const

export const DOCUMENT_PAGE_PROPERTIES = {
  pageNumber: { type: 'number', description: 'Original provider page number' },
  dimensions: {
    type: 'object',
    description: 'Page size and units',
    properties: {
      width: { type: 'number', description: 'Page width' },
      height: { type: 'number', description: 'Page height' },
      unit: { type: 'string', description: 'PIXEL or INCH' },
    },
  },
  text: { type: 'string', description: 'Sim-derived text joined from returned lines' },
  lines: {
    type: 'array',
    description: 'Recognized lines with text, confidence and optional geometry/word indices',
    items: { type: 'object', properties: DOCUMENT_TEXT_PROPERTIES },
  },
  words: {
    type: 'array',
    optional: true,
    description: 'Recognized words with text, confidence and optional geometry',
    items: { type: 'object', properties: DOCUMENT_TEXT_PROPERTIES },
  },
  documentFields: {
    type: 'array',
    description: 'Fields with index paths, labels, names and typed values',
    items: { type: 'object', properties: DOCUMENT_FIELD_PROPERTIES },
  },
  tables: {
    type: 'array',
    description: 'Tables with dimensions, confidence and header/body/footer rows of cells',
    items: { type: 'object', properties: DOCUMENT_TABLE_PROPERTIES },
  },
  detectedDocumentTypes: DOCUMENT_TYPE_OUTPUT,
  detectedLanguages: DOCUMENT_LANGUAGE_OUTPUT,
  selectionMarks: {
    type: 'array',
    description: 'Selection marks when detected',
    items: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'Provider selection state' },
        confidence: DOCUMENT_CONFIDENCE_OUTPUT,
        boundingPolygon: DOCUMENT_GEOMETRY_OUTPUT,
      },
    },
  },
} as const

export const DOCUMENT_ANALYSIS_PROPERTIES = {
  documentMetadata: {
    type: 'object',
    description: 'Provider document metadata',
    properties: {
      pageCount: { type: 'number', description: 'Provider page count' },
      mimeType: { type: 'string', description: 'Detected MIME type' },
    },
  },
  pages: {
    type: 'array',
    description: 'Selected pages; omissions are reported by truncation metadata',
    items: { type: 'object', properties: DOCUMENT_PAGE_PROPERTIES },
  },
  detectedDocumentTypes: DOCUMENT_TYPE_OUTPUT,
  detectedLanguages: DOCUMENT_LANGUAGE_OUTPUT,
  modelVersions: {
    type: 'array',
    description: 'Reported feature model versions',
    items: {
      type: 'object',
      properties: {
        feature: { type: 'string', description: 'Feature name' },
        version: { type: 'string', description: 'Reported model version' },
      },
    },
  },
  errors: {
    type: 'array',
    description: 'Document-level processing errors; not inferred page errors',
    items: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Processing error code' },
        message: { type: 'string', description: 'Processing error message' },
      },
    },
  },
  truncated: { type: 'boolean', description: 'Whether a projection limit omitted content' },
  truncationReasons: {
    type: 'array',
    description: 'Explicit reasons for incomplete output',
    items: { type: 'string' },
  },
  returnedPageCount: { type: 'number', description: 'Pages returned in this projection' },
  availablePageCount: {
    type: 'number',
    description: 'Pages in the provider result before projection',
  },
} as const

export const DOCUMENT_ANALYSIS_OUTPUT = {
  type: 'object',
  description: 'Bounded documented analysis projection',
  properties: DOCUMENT_ANALYSIS_PROPERTIES,
} as const

export const DOCUMENT_LOCATION_PROPERTIES = {
  namespaceName: { type: 'string', description: 'Object Storage namespace' },
  bucketName: { type: 'string', description: 'Object Storage bucket' },
  prefix: { type: 'string', description: 'Configured output prefix' },
} as const

export const DOCUMENT_JOB_PROPERTIES = {
  id: { type: 'string', description: 'Processor job OCID' },
  compartmentId: { type: 'string', description: 'Processing compartment' },
  displayName: { type: 'string', description: 'Job display name', optional: true },
  lifecycleState: {
    type: 'string',
    description: 'ACCEPTED, IN_PROGRESS, SUCCEEDED, FAILED, CANCELING or CANCELED',
  },
  lifecycleDetails: {
    type: 'string',
    description: 'Includes PARTIALLY_SUCCEEDED or COMPLETELY_FAILED for failed jobs',
    optional: true,
  },
  timeAccepted: { type: 'string', description: 'Acceptance timestamp' },
  timeStarted: { type: 'string', description: 'Start timestamp', optional: true },
  timeFinished: { type: 'string', description: 'Finish timestamp', optional: true },
  percentComplete: { type: 'number', description: 'Provider progress percentage', optional: true },
  outputLocation: {
    type: 'object',
    description: 'Configured output storage location',
    properties: DOCUMENT_LOCATION_PROPERTIES,
  },
  terminal: { type: 'boolean', description: 'Sim-derived terminal-state flag' },
  partiallySucceeded: {
    type: 'boolean',
    description: 'FAILED with PARTIALLY_SUCCEEDED lifecycle details',
  },
} as const

export const DOCUMENT_JOB_OUTPUT = {
  type: 'object',
  description: 'Processor job status without echoed document bytes',
  properties: DOCUMENT_JOB_PROPERTIES,
} as const

export const DOCUMENT_MODEL_PROPERTIES = {
  id: { type: 'string', description: 'Resource OCID' },
  displayName: { type: 'string', description: 'Display name', optional: true },
  description: { type: 'string', description: 'Description', optional: true },
  compartmentId: { type: 'string', description: 'Compartment OCID', optional: true },
  projectId: { type: 'string', description: 'Project OCID', optional: true },
  modelType: { type: 'string', description: 'Model type', optional: true },
  modelSubType: {
    type: 'object',
    description: 'Documented model subtype discriminator',
    optional: true,
    properties: {
      modelType: { type: 'string', description: 'Subtype model family' },
      modelSubType: {
        type: 'string',
        description: 'Subtype within the model family',
        optional: true,
      },
    },
  },
  modelVersion: { type: 'string', description: 'Provider model version', optional: true },
  lifecycleState: { type: 'string', description: 'Lifecycle state', optional: true },
  lifecycleDetails: { type: 'string', description: 'Lifecycle details', optional: true },
  timeCreated: { type: 'string', description: 'Creation timestamp', optional: true },
  timeUpdated: { type: 'string', description: 'Update timestamp', optional: true },
  language: { type: 'string', description: 'Model language', optional: true },
  aliasName: { type: 'string', description: 'Model alias', optional: true },
  tenancyId: { type: 'string', description: 'Model tenancy', optional: true },
} as const

export const DOCUMENT_REQUEST_ID_OUTPUT = {
  opcRequestId: { type: 'string', description: 'Oracle request identifier', optional: true },
} as const
