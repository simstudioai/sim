import { NetSuiteIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { OciDocumentResponse } from '@/tools/oci_document_understanding/types'

const OPERATION_FIELDS: Record<string, readonly string[]> = {
  oci_document_understanding_analyze_document: [
    'source',
    'file',
    'objects',
    'pageRange',
    'features',
    'compartmentId',
    'documentType',
    'language',
    'pageNumbers',
    'maxPages',
    'maxOutputBytes',
    'includeWords',
    'includeGeometry',
  ],
  oci_document_understanding_create_processor_job: [
    'source',
    'file',
    'objects',
    'pageRange',
    'features',
    'compartmentId',
    'documentType',
    'language',
    'outputLocation',
    'displayName',
    'retryToken',
  ],
  oci_document_understanding_get_processor_job: ['jobId'],
  oci_document_understanding_cancel_processor_job: ['jobId', 'ifMatch'],
  oci_document_understanding_list_job_outputs: ['jobId', 'limit', 'start'],
  oci_document_understanding_get_job_output: [
    'jobId',
    'objectName',
    'resultType',
    'ifMatch',
    'pageNumbers',
    'maxPages',
    'maxOutputBytes',
    'includeWords',
    'includeGeometry',
  ],
  oci_document_understanding_list_projects: [
    'compartmentId',
    'displayName',
    'lifecycleState',
    'limit',
    'page',
  ],
  oci_document_understanding_list_models: [
    'compartmentId',
    'projectId',
    'displayName',
    'lifecycleState',
    'limit',
    'page',
  ],
  oci_document_understanding_get_model: ['modelId'],
  oci_document_understanding_get_model_type: ['modelType', 'modelSubType', 'compartmentId'],
}

export const OciDocumentUnderstandingBlock: BlockConfig<OciDocumentResponse> = {
  type: 'oci_document_understanding',
  name: 'OCI Document Understanding',
  description:
    'Extract document text, tables and fields, classify documents, and manage analysis jobs',
  longDescription:
    'Analyze JPEG, PNG, PDF and TIFF documents with native OCI API signing-key credentials. Synchronous and inline job input is limited to 8 MB and five pages. Object Storage jobs accept up to 2000 documents, 500 MB and 2000 pages per document, within a 500 KB request body. Remote document limits are enforced by Oracle. Choose feature objects for OCR, tables, key-value extraction, document classification and language classification. Pretrained models need no modelId. Language and feature combinations depend on the model; no explicit model-version switch is sent. Searchable PDFs are supported through jobs. Existing models and projects can be discovered; model training and separate Generative AI products are not included. Jobs require an existing output bucket and prefix plus Oracle IAM access to process documents and read/write Object Storage. Cross-tenancy inputs require Oracle endorse/admit policies. Artifact paths follow Oracle’s prefix/jobId/ convention; no complete failure manifest or ZIP schema is assumed. Partial success is FAILED with PARTIALLY_SUCCEEDED details. Status reads do not poll automatically. The OCI transport sends synchronous analysis once. Disable block/workflow retries for paid analysis: the shared executor currently drops the non-retryable marker. Job tokens are derived from complete workflow invocation identity, otherwise generated per call; supply a stable token for deliberate replays with identical input. Oracle tokens expire after 24 hours and may be invalidated earlier. Structured output defaults to 1 MiB and 20 pages, capped at 8 MiB and 100 pages, with explicit truncation. JSON parsing is capped at 32 MiB. File artifacts up to 100 MiB are persisted as Sim files. Use file retrieval when an artifact exceeds the structured limit. No arbitrary document URLs are accepted.',
  docsLink: 'https://docs.sim.ai/integrations/oci_document_understanding',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  authMode: AuthMode.ApiKey,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Document Understanding',
    sentences: {
      byOperation: {
        oci_document_understanding_analyze_document: [
          { text: 'Analyze document', field: 'source', core: true },
        ],
        oci_document_understanding_create_processor_job: [
          { text: 'Submit document job', field: 'source', core: true },
        ],
        oci_document_understanding_get_processor_job: [
          { text: 'Read document job', field: 'jobId', core: true },
        ],
        oci_document_understanding_cancel_processor_job: [
          { text: 'Cancel document job', field: 'jobId', core: true },
        ],
        oci_document_understanding_list_job_outputs: [
          { text: 'List job artifacts', field: 'jobId', core: true },
        ],
        oci_document_understanding_get_job_output: [
          {
            text: 'Retrieve job artifact',
            field: ['artifactSelector', 'artifactManual'],
            core: true,
          },
        ],
        oci_document_understanding_list_projects: [
          { text: 'List document projects', field: 'compartmentId', core: true },
        ],
        oci_document_understanding_list_models: [
          { text: 'List document models', field: 'compartmentId', core: true },
        ],
        oci_document_understanding_get_model: [
          { text: 'Inspect document model', field: ['modelSelector', 'modelManual'], core: true },
        ],
        oci_document_understanding_get_model_type: [
          { text: 'Inspect model capabilities', field: 'modelType', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Analyze Document', id: 'oci_document_understanding_analyze_document' },
        { label: 'Create Processor Job', id: 'oci_document_understanding_create_processor_job' },
        { label: 'Get Processor Job', id: 'oci_document_understanding_get_processor_job' },
        { label: 'Cancel Processor Job', id: 'oci_document_understanding_cancel_processor_job' },
        { label: 'List Job Outputs', id: 'oci_document_understanding_list_job_outputs' },
        { label: 'Get Job Output', id: 'oci_document_understanding_get_job_output' },
        { label: 'List Projects', id: 'oci_document_understanding_list_projects' },
        { label: 'List Models', id: 'oci_document_understanding_list_models' },
        { label: 'Get Model', id: 'oci_document_understanding_get_model' },
        { label: 'Get Model Type', id: 'oci_document_understanding_get_model_type' },
      ],
      value: () => 'oci_document_understanding_analyze_document',
    },
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci_document_understanding',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'OCI Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Credential ID',
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Defaults to credential region',
    },
    {
      id: 'source',
      title: 'Document Source',
      type: 'dropdown',
      options: [
        { label: 'Sim File', id: 'file' },
        { label: 'OCI Object Storage', id: 'objectStorage' },
      ],
      value: () => 'file',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_create_processor_job',
        ],
      },
    },
    {
      id: 'fileUpload',
      title: 'Document',
      type: 'file-upload',
      acceptedTypes: 'image/jpeg,image/png,application/pdf,image/tiff',
      maxSize: 8,
      canonicalParamId: 'file',
      mode: 'basic',
      required: false,
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_create_processor_job',
        ],
        and: { field: 'source', value: 'file' },
      },
    },
    {
      id: 'fileReference',
      title: 'Document Reference',
      type: 'short-input',
      canonicalParamId: 'file',
      mode: 'advanced',
      required: false,
      placeholder: 'Reference a stored Sim file',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_create_processor_job',
        ],
        and: { field: 'source', value: 'file' },
      },
    },
    {
      id: 'objects',
      title: 'Oracle Objects',
      type: 'long-input',
      placeholder:
        '[{"namespaceName":"namespace","bucketName":"documents","objectName":"invoice.pdf"}]',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_create_processor_job',
        ],
        and: { field: 'source', value: 'objectStorage' },
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Create an array of Oracle object references with namespaceName, bucketName, objectName and optional pageRange arrays. Do not use URLs. Return ONLY the JSON array.',
        placeholder: 'Describe the Oracle objects',
      },
    },
    {
      id: 'features',
      title: 'Analysis Features',
      type: 'long-input',
      required: true,
      value: () => '[{"featureType":"TEXT_EXTRACTION"}]',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_create_processor_job',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Create a feature array using TEXT_EXTRACTION, TABLE_EXTRACTION, KEY_VALUE_EXTRACTION, DOCUMENT_CLASSIFICATION or LANGUAGE_CLASSIFICATION. Custom models use modelId. Only TEXT_EXTRACTION accepts generateSearchablePdf, for jobs only. Return ONLY the JSON array.',
        placeholder: 'Describe what to extract',
      },
    },
    {
      id: 'compartmentId',
      title: 'Compartment OCID',
      type: 'short-input',
      placeholder: 'Processing compartment; also needed for project/model selection',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_create_processor_job',
          'oci_document_understanding_list_projects',
          'oci_document_understanding_list_models',
          'oci_document_understanding_get_model',
          'oci_document_understanding_get_model_type',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_document_understanding_create_processor_job',
          'oci_document_understanding_list_projects',
          'oci_document_understanding_list_models',
        ],
      },
    },
    {
      id: 'documentType',
      title: 'Document Type Hint',
      type: 'dropdown',
      mode: 'advanced',
      options: [
        { label: 'Automatic', id: '' },
        { label: 'Invoice', id: 'INVOICE' },
        { label: 'Receipt', id: 'RECEIPT' },
        { label: 'Passport', id: 'PASSPORT' },
        { label: 'Driver License', id: 'DRIVER_LICENSE' },
        { label: 'Health Insurance ID', id: 'HEALTH_INSURANCE_ID' },
        { label: 'Resume', id: 'RESUME' },
        { label: 'Tax Form', id: 'TAX_FORM' },
        { label: 'Bank Statement', id: 'BANK_STATEMENT' },
        { label: 'Check', id: 'CHECK' },
        { label: 'Payslip', id: 'PAYSLIP' },
        { label: 'Other', id: 'OTHERS' },
      ],
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_create_processor_job',
        ],
      },
    },
    {
      id: 'language',
      title: 'Language Hint',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'BCP 47 code, e.g. en',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_create_processor_job',
        ],
      },
    },
    {
      id: 'pageRange',
      title: 'Inline Page Ranges',
      type: 'long-input',
      mode: 'advanced',
      placeholder: '["1-3","5"]',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_create_processor_job',
        ],
        and: { field: 'source', value: 'file' },
      },
    },
    {
      id: 'outputLocation',
      title: 'Output Storage Location',
      type: 'long-input',
      required: true,
      placeholder: '{"namespaceName":"namespace","bucketName":"results","prefix":"documents"}',
      condition: { field: 'operation', value: 'oci_document_understanding_create_processor_job' },
      wandConfig: {
        enabled: true,
        prompt:
          'Create an Oracle output location with namespaceName, bucketName and prefix strings. Use existing authorized storage. Return ONLY the JSON object.',
        placeholder: 'Describe the output bucket and prefix',
      },
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_create_processor_job',
          'oci_document_understanding_list_projects',
          'oci_document_understanding_list_models',
        ],
      },
    },
    {
      id: 'retryToken',
      title: 'Submission Retry Token',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Generated when omitted; reuse only with identical input',
      condition: { field: 'operation', value: 'oci_document_understanding_create_processor_job' },
    },
    {
      id: 'jobId',
      title: 'Processor Job OCID',
      type: 'short-input',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_get_processor_job',
          'oci_document_understanding_cancel_processor_job',
          'oci_document_understanding_list_job_outputs',
          'oci_document_understanding_get_job_output',
        ],
      },
    },
    {
      id: 'artifactSelector',
      title: 'Job Artifact',
      type: 'project-selector',
      selectorKey: 'oci_document_understanding.artifacts',
      canonicalParamId: 'objectName',
      mode: 'basic',
      required: true,
      dependsOn: ['oauthCredential', 'region', 'jobId'],
      condition: { field: 'operation', value: 'oci_document_understanding_get_job_output' },
    },
    {
      id: 'artifactManual',
      title: 'Job Artifact',
      type: 'short-input',
      canonicalParamId: 'objectName',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'oci_document_understanding_get_job_output' },
    },
    {
      id: 'resultType',
      title: 'Result Type',
      type: 'dropdown',
      options: [
        { label: 'Structured Analysis', id: 'structured' },
        { label: 'File Artifact', id: 'file' },
      ],
      value: () => 'structured',
      condition: { field: 'operation', value: 'oci_document_understanding_get_job_output' },
    },
    {
      id: 'ifMatch',
      title: 'ETag Condition',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_cancel_processor_job',
          'oci_document_understanding_get_job_output',
        ],
      },
    },
    {
      id: 'pageNumbers',
      title: 'Returned Page Numbers',
      type: 'long-input',
      mode: 'advanced',
      placeholder: '[1,3]',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_get_job_output',
        ],
      },
    },
    {
      id: 'maxPages',
      title: 'Returned Page Limit',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '20 (maximum 100)',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_get_job_output',
        ],
      },
    },
    {
      id: 'maxOutputBytes',
      title: 'Structured Output Budget',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '1048576 (maximum 8388608)',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_get_job_output',
        ],
      },
    },
    {
      id: 'includeWords',
      title: 'Include Words',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_get_job_output',
        ],
      },
    },
    {
      id: 'includeGeometry',
      title: 'Include Geometry',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_analyze_document',
          'oci_document_understanding_get_job_output',
        ],
      },
    },
    {
      id: 'projectSelector',
      title: 'Project',
      type: 'project-selector',
      selectorKey: 'oci_document_understanding.projects',
      canonicalParamId: 'projectId',
      mode: 'basic',
      dependsOn: ['oauthCredential', 'region', 'compartmentId'],
      condition: {
        field: 'operation',
        value: ['oci_document_understanding_list_models', 'oci_document_understanding_get_model'],
      },
    },
    {
      id: 'projectManual',
      title: 'Project',
      type: 'short-input',
      canonicalParamId: 'projectId',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['oci_document_understanding_list_models', 'oci_document_understanding_get_model'],
      },
    },
    {
      id: 'modelSelector',
      title: 'Model',
      type: 'project-selector',
      selectorKey: 'oci_document_understanding.models',
      canonicalParamId: 'modelId',
      mode: 'basic',
      required: true,
      dependsOn: ['oauthCredential', 'region', 'compartmentId', 'projectId', 'modelType'],
      condition: { field: 'operation', value: 'oci_document_understanding_get_model' },
    },
    {
      id: 'modelManual',
      title: 'Model',
      type: 'short-input',
      canonicalParamId: 'modelId',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'oci_document_understanding_get_model' },
    },
    {
      id: 'modelType',
      title: 'Model Type',
      type: 'short-input',
      placeholder: 'Oracle model type',
      required: { field: 'operation', value: 'oci_document_understanding_get_model_type' },
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_get_model',
          'oci_document_understanding_get_model_type',
        ],
      },
    },
    {
      id: 'modelSubType',
      title: 'Model Subtype',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'oci_document_understanding_get_model_type' },
    },
    {
      id: 'lifecycleState',
      title: 'Lifecycle Filter',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. ACTIVE',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_list_projects',
          'oci_document_understanding_list_models',
        ],
      },
    },
    {
      id: 'limit',
      title: 'List Limit',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_list_projects',
          'oci_document_understanding_list_models',
          'oci_document_understanding_list_job_outputs',
        ],
      },
    },
    {
      id: 'page',
      title: 'Next Page Token',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_document_understanding_list_projects',
          'oci_document_understanding_list_models',
        ],
      },
    },
    {
      id: 'start',
      title: 'Next Artifact Start',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'oci_document_understanding_list_job_outputs' },
    },
  ],
  tools: {
    access: [
      'oci_document_understanding_analyze_document',
      'oci_document_understanding_create_processor_job',
      'oci_document_understanding_get_processor_job',
      'oci_document_understanding_cancel_processor_job',
      'oci_document_understanding_list_job_outputs',
      'oci_document_understanding_get_job_output',
      'oci_document_understanding_list_projects',
      'oci_document_understanding_list_models',
      'oci_document_understanding_get_model',
      'oci_document_understanding_get_model_type',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const operation = params.operation
        if (typeof operation !== 'string' || !Object.hasOwn(OPERATION_FIELDS, operation))
          throw new Error('Select a Document Understanding operation')
        const output: Record<string, unknown> = {
          oauthCredential: params.oauthCredential,
          region: params.region || undefined,
        }
        for (const key of OPERATION_FIELDS[operation]) {
          const value = params[key]
          if (value !== undefined && value !== null && value !== '') output[key] = value
        }
        for (const key of ['objects', 'features', 'pageRange', 'outputLocation', 'pageNumbers']) {
          if (typeof output[key] === 'string') {
            const value = output[key] as string
            if (value.length > 1024 * 1024) throw new Error(`${key} exceeds the input limit`)
            try {
              output[key] = JSON.parse(value)
            } catch {
              throw new Error(`${key} must be valid JSON`)
            }
          }
        }
        for (const key of ['limit', 'maxPages', 'maxOutputBytes']) {
          if (output[key] !== undefined)
            output[key] = parseOptionalNumberInput(output[key], key, { integer: true, min: 1 })
        }
        for (const key of ['includeWords', 'includeGeometry']) {
          if (output[key] === 'true') output[key] = true
          if (output[key] === 'false') output[key] = false
        }
        if ('source' in output) {
          if (output.source === 'file') {
            output.file = normalizeFileInput(params.file, { single: true })
            output.objects = undefined
          } else {
            output.file = undefined
            output.pageRange = undefined
          }
        }
        return output
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Document Understanding operation' },
    oauthCredential: { type: 'string', description: 'OCI credential' },
    region: { type: 'string', description: 'OCI region' },
    source: { type: 'string', description: 'file or objectStorage' },
    file: { type: 'file', description: 'Stored Sim file' },
    objects: { type: 'json', description: 'Oracle object references' },
    features: { type: 'json', description: 'Analysis feature objects' },
    pageRange: { type: 'json', description: 'Inline page ranges' },
    compartmentId: { type: 'string', description: 'Processing/discovery compartment' },
    documentType: { type: 'string', description: 'Document type hint' },
    language: { type: 'string', description: 'Language hint' },
    outputLocation: { type: 'json', description: 'Output namespace, bucket and prefix' },
    displayName: { type: 'string', description: 'Job name or discovery filter' },
    retryToken: { type: 'string', description: 'Stable job submission token' },
    jobId: { type: 'string', description: 'Processor job OCID' },
    objectName: { type: 'string', description: 'Exact job artifact name' },
    resultType: { type: 'string', description: 'structured or file' },
    ifMatch: { type: 'string', description: 'Entity tag condition' },
    pageNumbers: { type: 'json', description: 'Original pages to return' },
    maxPages: { type: 'number', description: 'Returned page limit' },
    maxOutputBytes: { type: 'number', description: 'Structured byte budget' },
    includeWords: { type: 'boolean', description: 'Include words' },
    includeGeometry: { type: 'boolean', description: 'Include geometry' },
    projectId: { type: 'string', description: 'Project OCID' },
    modelId: { type: 'string', description: 'Model OCID' },
    modelType: { type: 'string', description: 'Model type' },
    modelSubType: { type: 'string', description: 'Model subtype' },
    lifecycleState: { type: 'string', description: 'Lifecycle filter' },
    limit: { type: 'number', description: 'List limit' },
    page: { type: 'string', description: 'Discovery continuation' },
    start: { type: 'string', description: 'Artifact continuation' },
  },
  outputs: {
    analysis: {
      type: 'json',
      description:
        'Document metadata, pages with text/tables/fields/geometry, classifications, model versions, errors and truncation metadata',
    },
    job: {
      type: 'json',
      description:
        'Job id, lifecycleState/details, timestamps, progress, outputLocation, terminal and partiallySucceeded',
    },
    etag: { type: 'string', description: 'Job ETag for conditional cancellation' },
    jobId: { type: 'string', description: 'Processor job OCID' },
    retryToken: { type: 'string', description: 'Submission token' },
    cancellationRequested: { type: 'boolean', description: 'Cancellation acknowledgement' },
    objects: { type: 'json', description: '[{name,size,etag,timeCreated}] job artifacts' },
    nextStartWith: { type: 'string', description: 'Artifact continuation name' },
    file: { type: 'file', description: 'Persisted job artifact' },
    model: { type: 'json', description: 'Model identity, type, version, language and lifecycle' },
    models: { type: 'json', description: 'Model summaries without datasets' },
    projects: { type: 'json', description: 'Project summaries' },
    versions: { type: 'json', description: 'Model type version strings' },
    capabilities: { type: 'json', description: '[{version,name,details}] model capabilities' },
    nextPage: { type: 'string', description: 'Discovery continuation token' },
    opcRequestId: { type: 'string', description: 'Oracle request ID' },
  },
}

export const OciDocumentUnderstandingBlockMeta = {
  tags: ['document-processing', 'automation', 'cloud'],
  url: 'https://www.oracle.com/artificial-intelligence/document-understanding/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Read scanned documents',
      prompt:
        'Extract text from an authorized uploaded PDF using OCI Document Understanding. Return bounded page text and flag incomplete output.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['document-processing'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Extract invoice fields',
      prompt:
        'Analyze an invoice with OCI key-value extraction, save vendor and invoice fields in a table, and route low-confidence values for human review.',
      modules: ['files', 'tables', 'workflows'],
      category: 'operations',
      tags: ['document-processing'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review expense receipts',
      prompt:
        'Extract receipt fields with OCI Document Understanding and present the totals and confidence for expense review.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['document-processing'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Extract document tables',
      prompt:
        'Extract table cells from an English document using OCI Document Understanding, preserve row and column indices, and store selected rows in a table.',
      modules: ['files', 'tables', 'workflows'],
      category: 'operations',
      tags: ['document-processing'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Route classified documents',
      prompt:
        'Classify incoming documents using OCI Document Understanding and branch on the returned document class and confidence.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['document-processing'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Process a document batch',
      prompt:
        'Submit an explicit list of authorized Oracle Object Storage documents for analysis, retain the job ID, and check status with bounded scheduled runs. Retrieve available results even on partial success.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Create searchable PDFs',
      prompt:
        'Submit an OCI OCR processor job with generateSearchablePdf enabled, list its completed artifacts, and return the searchable PDF as a Sim file within the transfer limit.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['document-processing'],
    },
  ],
  skills: [
    {
      name: 'extract-document-text',
      description: 'Read document text with bounded OCR output.',
      content:
        '# Extract Document Text\n\n## Steps\n\n1. Select an authorized file or Oracle object.\n2. Disable block retries and analyze with TEXT_EXTRACTION.\n3. Inspect page text and truncation before using the result.\n\n## Output\n\nReturn text with original page numbers and reported confidence.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/document-understanding/using/overview.htm',
    },
    {
      name: 'extract-invoice-and-receipt-fields',
      description: 'Extract business fields for human-reviewed automation.',
      content:
        '# Extract Invoice And Receipt Fields\n\n## Steps\n\n1. Choose INVOICE or RECEIPT and KEY_VALUE_EXTRACTION.\n2. Preserve nested field paths and confidence.\n3. Route uncertain values for human review.\n\n## Output\n\nReturn named fields and their provider-normalized values without guessing absent fields.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/document-understanding/using/key-value-extraction-about.htm',
    },
    {
      name: 'extract-document-tables',
      description: 'Preserve table structure for downstream processing.',
      content:
        '# Extract Document Tables\n\n## Steps\n\n1. Use TABLE_EXTRACTION on a supported English document.\n2. Preserve header, body, footer, and cell indices.\n3. Inspect truncation before importing rows.\n\n## Output\n\nReturn typed table cells and optional geometry.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/document-understanding/using/pretrained_doc_table_extraction.htm',
    },
    {
      name: 'classify-incoming-documents',
      description: 'Route documents by detected class and confidence.',
      content:
        '# Classify Incoming Documents\n\n## Steps\n\n1. Analyze with DOCUMENT_CLASSIFICATION.\n2. Inspect detected classes and confidence.\n3. Route documents using workflow conditions.\n\n## Output\n\nReturn the classification and confidence without assuming a class is certain.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/document-understanding/using/pretrained_doc_document_class.htm',
    },
    {
      name: 'retrieve-batch-analysis',
      description: 'Track batch processing and preserve partial results.',
      content:
        '# Retrieve Batch Analysis\n\n## Steps\n\n1. Submit an explicit bounded object list with a stable retry token and retain the job ID.\n2. Read status with a deadline and capped workflow loop.\n3. List one output page and retrieve selected artifacts.\n\n## Output\n\nReturn job state, available analysis, and continuation tokens. FAILED with PARTIALLY_SUCCEEDED can contain usable artifacts.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/document-understanding/using/api_models.htm',
    },
    {
      name: 'create-searchable-document-artifacts',
      description: 'Generate and retrieve searchable PDFs.',
      content:
        '# Create Searchable Document Artifacts\n\n## Steps\n\n1. Submit a processor job with TEXT_EXTRACTION and generateSearchablePdf true.\n2. Wait using bounded workflow status checks.\n3. List outputs and retrieve the PDF with resultType file.\n\n## Output\n\nReturn the persisted file; do not interpret the undocumented synchronous searchablePdf string.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/document-understanding/using/pretrained_doc_ocr_pdf.htm',
    },
  ],
} satisfies BlockMeta
