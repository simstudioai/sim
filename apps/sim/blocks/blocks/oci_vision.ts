import { NetSuiteIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import {
  normalizeFileInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'
import {
  OCI_VISION_FEATURE_FIELDS,
  OCI_VISION_FEATURES,
  OCI_VISION_LIST_FIELDS,
  OCI_VISION_REGIONS,
} from '@/tools/oci_vision/shared'
import type { OciVisionOperation, OciVisionResponse } from '@/tools/oci_vision/types'

const analysisOperations = ['analyze_image', 'create_image_job'] as const
const discoveryOperations = ['list_projects', 'list_models'] as const
const projectOperations = [...analysisOperations, 'list_models', 'get_project'] as const
const jobOperations = [
  'get_image_job',
  'cancel_image_job',
  'list_image_job_outputs',
  'download_image_job_output',
] as const
const fileCondition = {
  field: 'operation',
  value: 'analyze_image',
  and: { field: 'source', value: 'file' },
}
const storageCondition = {
  field: 'operation',
  value: 'analyze_image',
  and: { field: 'source', value: 'object_storage' },
}
const operationFields: Record<OciVisionOperation, readonly string[]> = {
  analyze_image: [...OCI_VISION_FEATURE_FIELDS, 'source'],
  create_image_job: [
    ...OCI_VISION_FEATURE_FIELDS,
    'objectLocations',
    'outputNamespaceName',
    'outputBucketName',
    'outputPrefix',
    'displayName',
    'isZipOutputEnabled',
    'retryToken',
  ],
  get_image_job: ['imageJobId'],
  cancel_image_job: ['imageJobId', 'ifMatch'],
  list_projects: OCI_VISION_LIST_FIELDS,
  get_project: ['projectId'],
  list_models: [...OCI_VISION_LIST_FIELDS, 'projectId'],
  get_model: ['modelId'],
  list_image_job_outputs: ['imageJobId', 'limit', 'start'],
  download_image_job_output: ['imageJobId', 'ifMatch'],
}

export const OciVisionBlock: BlockConfig<OciVisionResponse> = {
  type: 'oci_vision',
  name: 'OCI Vision',
  description: 'Analyze images and manage Vision batch jobs',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Analyze JPEG and PNG images for labels, objects, English scene text, and faces using OCI Vision. Use pretrained or existing active custom models, discover projects and models, submit batches, read or cancel jobs, and retrieve output files. Images are limited to 5,000,000 bytes and 32–10,000 pixels per dimension; Sim files are validated before upload. OCI validates referenced images. Batch requests accept up to 2,000 Object Storage references and 500,000 bytes of JSON. Analysis and unkeyed job creation use one request attempt. Enabling block retries may repeat paid requests; a stable caller-supplied job retry token provides bounded provider deduplication. Status reads do not wait for completion. Output listing uses the job’s returned bucket and prefix, which may also contain other objects when reused. Downloads return one UserFile, capped at 50 MiB; batch file contents are not parsed. Requires an OCI signing-key service account, Vision permissions, input-object access and, for batches, output-write access; reading output files also requires Object Storage list/read permissions. Document extraction, video, face recognition, model training, and automatic image staging are excluded.',
  docsLink: 'https://docs.sim.ai/integrations/oci_vision',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#C74634',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Vision',
    sentences: {
      byOperation: {
        analyze_image: [
          { text: 'Analyze', field: ['imageFile', 'fileReference', 'imageObjectName'], core: true },
          { text: 'for', field: 'features' },
        ],
        create_image_job: [{ text: 'Analyze batch', field: 'objectLocations', core: true }],
        get_image_job: [{ text: 'Read image job', field: 'imageJobId', core: true }],
        cancel_image_job: [{ text: 'Request cancellation of', field: 'imageJobId', core: true }],
        list_projects: [{ text: 'List projects in', field: 'compartmentId', core: true }],
        get_project: [
          { text: 'Read project', field: ['projectSelector', 'projectManual'], core: true },
        ],
        list_models: [{ text: 'List models in', field: 'compartmentId', core: true }],
        get_model: [{ text: 'Read model', field: 'modelId', core: true }],
        list_image_job_outputs: [{ text: 'List files for job', field: 'imageJobId', core: true }],
        download_image_job_output: [
          { text: 'Download', field: 'outputObjectName', core: true },
          { text: 'from job', field: 'imageJobId' },
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
        { id: 'analyze_image', label: 'Analyze Image' },
        { id: 'create_image_job', label: 'Create Image Job' },
        { id: 'get_image_job', label: 'Get Image Job' },
        { id: 'cancel_image_job', label: 'Cancel Image Job' },
        { id: 'list_projects', label: 'List Projects' },
        { id: 'get_project', label: 'Get Project' },
        { id: 'list_models', label: 'List Models' },
        { id: 'get_model', label: 'Get Model' },
        { id: 'list_image_job_outputs', label: 'List Image Job Outputs' },
        { id: 'download_image_job_output', label: 'Download Image Job Output' },
      ],
      value: () => 'analyze_image',
      required: true,
    },
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci_vision',
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
      placeholder: 'Connected credential ID',
      required: true,
    },
    {
      id: 'region',
      title: 'Region',
      type: 'dropdown',
      options: OCI_VISION_REGIONS.map((id) => ({ id, label: id })),
      placeholder: 'Use credential region',
      emptyIsValid: true,
    },
    {
      id: 'compartmentId',
      title: 'Compartment OCID',
      type: 'short-input',
      placeholder: 'ocid1.compartment…',
      condition: { field: 'operation', value: [...projectOperations, 'list_projects'] },
      required: { field: 'operation', value: [...discoveryOperations] },
      tooltip: 'Required for discovery selectors; optional for direct analysis and job creation.',
    },
    {
      id: 'source',
      title: 'Image Source',
      type: 'dropdown',
      options: [
        { id: 'file', label: 'Sim File' },
        { id: 'object_storage', label: 'OCI Object Storage Reference' },
      ],
      value: () => 'file',
      condition: { field: 'operation', value: 'analyze_image' },
      required: { field: 'operation', value: 'analyze_image' },
    },
    {
      id: 'imageFile',
      title: 'Image',
      type: 'file-upload',
      canonicalParamId: 'file',
      acceptedTypes: '.jpg,.jpeg,.png',
      maxSize: 5,
      multiple: false,
      mode: 'basic',
      condition: fileCondition,
      required: fileCondition,
    },
    {
      id: 'fileReference',
      title: 'Image',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a Sim UserFile',
      mode: 'advanced',
      condition: fileCondition,
      required: fileCondition,
    },
    {
      id: 'namespaceName',
      title: 'Image Namespace',
      type: 'short-input',
      condition: storageCondition,
      required: storageCondition,
    },
    {
      id: 'bucketName',
      title: 'Image Bucket',
      type: 'short-input',
      condition: storageCondition,
      required: storageCondition,
    },
    {
      id: 'imageObjectName',
      title: 'Image Object Name',
      type: 'short-input',
      placeholder: 'photos/example.jpg',
      condition: storageCondition,
      required: storageCondition,
    },
    {
      id: 'features',
      title: 'Features',
      type: 'dropdown',
      multiSelect: true,
      options: [
        { id: 'IMAGE_CLASSIFICATION', label: 'Image Classification' },
        { id: 'OBJECT_DETECTION', label: 'Object Detection' },
        { id: 'TEXT_DETECTION', label: 'Scene Text (English)' },
        { id: 'FACE_DETECTION', label: 'Face Detection' },
      ],
      condition: { field: 'operation', value: [...analysisOperations] },
      required: { field: 'operation', value: [...analysisOperations] },
    },
    {
      id: 'projectSelector',
      title: 'Project',
      type: 'project-selector',
      canonicalParamId: 'projectId',
      serviceId: 'oci_vision',
      selectorKey: 'oci_vision.projects',
      dependsOn: ['credential', 'region', 'compartmentId'],
      mode: 'basic',
      emptyIsValid: true,
      condition: { field: 'operation', value: [...projectOperations] },
      required: { field: 'operation', value: 'get_project' },
    },
    {
      id: 'projectManual',
      title: 'Project',
      type: 'short-input',
      canonicalParamId: 'projectId',
      placeholder: 'Project OCID (optional model filter)',
      mode: 'advanced',
      condition: { field: 'operation', value: [...projectOperations] },
      required: { field: 'operation', value: 'get_project' },
    },
    {
      id: 'classificationModelSelector',
      title: 'Custom Classification Model',
      type: 'project-selector',
      canonicalParamId: 'classificationModelId',
      serviceId: 'oci_vision',
      selectorKey: 'oci_vision.classification_models',
      dependsOn: ['credential', 'region', 'compartmentId', 'projectSelector'],
      mode: 'basic',
      emptyIsValid: true,
      placeholder: 'Use pretrained classification',
      condition: { field: 'operation', value: [...analysisOperations] },
    },
    {
      id: 'classificationModelManual',
      title: 'Custom Classification Model',
      type: 'short-input',
      canonicalParamId: 'classificationModelId',
      placeholder: 'Active classification model OCID; omit for pretrained',
      mode: 'advanced',
      condition: { field: 'operation', value: [...analysisOperations] },
    },
    {
      id: 'objectDetectionModelSelector',
      title: 'Custom Object Detection Model',
      type: 'project-selector',
      canonicalParamId: 'objectDetectionModelId',
      serviceId: 'oci_vision',
      selectorKey: 'oci_vision.object_detection_models',
      dependsOn: ['credential', 'region', 'compartmentId', 'projectSelector'],
      mode: 'basic',
      emptyIsValid: true,
      placeholder: 'Use pretrained object detection',
      condition: { field: 'operation', value: [...analysisOperations] },
    },
    {
      id: 'objectDetectionModelManual',
      title: 'Custom Object Detection Model',
      type: 'short-input',
      canonicalParamId: 'objectDetectionModelId',
      placeholder: 'Active object detection model OCID; omit for pretrained',
      mode: 'advanced',
      condition: { field: 'operation', value: [...analysisOperations] },
    },
    {
      id: 'classificationMaxResults',
      title: 'Maximum Labels',
      type: 'short-input',
      placeholder: '5 (1–1000)',
      mode: 'advanced',
      condition: { field: 'operation', value: [...analysisOperations] },
    },
    {
      id: 'objectDetectionMaxResults',
      title: 'Maximum Objects',
      type: 'short-input',
      placeholder: '5 (1–1000)',
      mode: 'advanced',
      condition: { field: 'operation', value: [...analysisOperations] },
    },
    {
      id: 'faceMaxResults',
      title: 'Maximum Faces',
      type: 'short-input',
      placeholder: '50 (1–1000)',
      mode: 'advanced',
      condition: { field: 'operation', value: [...analysisOperations] },
    },
    {
      id: 'shouldReturnLandmarks',
      title: 'Include Facial Landmarks',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: [...analysisOperations] },
    },
    {
      id: 'language',
      title: 'Scene Text Language Hint',
      type: 'dropdown',
      options: [{ id: 'ENG', label: 'English' }],
      emptyIsValid: true,
      mode: 'advanced',
      condition: { field: 'operation', value: [...analysisOperations] },
    },
    {
      id: 'objectLocations',
      title: 'Image Object References',
      type: 'code',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Return only a JSON array of existing OCI image references with namespaceName, bucketName, and objectName. Use the supplied locators without inventing object names. Example: [{"namespaceName":"namespace","bucketName":"images","objectName":"photo.jpg"}]. No markdown or explanation.',
        placeholder: 'Describe the existing image references to include',
      },
      placeholder: '[{"namespaceName":"namespace","bucketName":"images","objectName":"photo.jpg"}]',
      condition: { field: 'operation', value: 'create_image_job' },
      required: { field: 'operation', value: 'create_image_job' },
      tooltip:
        'JSON array of 1–2,000 existing OCI objects; the complete request must fit in 500,000 bytes.',
    },
    {
      id: 'outputNamespaceName',
      title: 'Output Namespace',
      type: 'short-input',
      condition: { field: 'operation', value: 'create_image_job' },
      required: { field: 'operation', value: 'create_image_job' },
    },
    {
      id: 'outputBucketName',
      title: 'Output Bucket',
      type: 'short-input',
      condition: { field: 'operation', value: 'create_image_job' },
      required: { field: 'operation', value: 'create_image_job' },
    },
    {
      id: 'outputPrefix',
      title: 'Output Prefix',
      type: 'short-input',
      placeholder: 'vision/my-run/',
      condition: { field: 'operation', value: 'create_image_job' },
      required: { field: 'operation', value: 'create_image_job' },
      tooltip:
        'Choose a distinct, nonempty prefix to separate this job’s output from other objects.',
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_image_job', ...discoveryOperations] },
      tooltip: 'Job name on create; exact display-name filter on discovery lists.',
    },
    {
      id: 'isZipOutputEnabled',
      title: 'ZIP Batch Output',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_image_job' },
    },
    {
      id: 'retryToken',
      title: 'Stable Retry Token',
      type: 'short-input',
      placeholder: 'Optional stable token, up to 64 characters',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_image_job' },
      tooltip:
        'Reuse for the same creation request across retries. OCI tokens normally expire after 24 hours and can be invalidated earlier.',
    },
    {
      id: 'imageJobId',
      title: 'Image Job OCID',
      type: 'short-input',
      condition: { field: 'operation', value: [...jobOperations] },
      required: { field: 'operation', value: [...jobOperations] },
    },
    {
      id: 'modelId',
      title: 'Model OCID',
      type: 'short-input',
      condition: { field: 'operation', value: 'get_model' },
      required: { field: 'operation', value: 'get_model' },
    },
    {
      id: 'outputObjectName',
      title: 'Output Object Name',
      type: 'short-input',
      placeholder: 'Exact object name returned by List Image Job Outputs',
      condition: { field: 'operation', value: 'download_image_job_output' },
      required: { field: 'operation', value: 'download_image_job_output' },
    },
    {
      id: 'ifMatch',
      title: 'If-Match ETag',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: ['cancel_image_job', 'download_image_job_output'] },
    },
    {
      id: 'limit',
      title: 'Page Size',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '10 (1–100)',
      condition: { field: 'operation', value: [...discoveryOperations, 'list_image_job_outputs'] },
    },
    {
      id: 'page',
      title: 'Vision Page Token',
      type: 'short-input',
      placeholder: 'nextPage from the preceding list response',
      mode: 'advanced',
      condition: { field: 'operation', value: [...discoveryOperations] },
    },
    {
      id: 'start',
      title: 'Object Storage Start Cursor',
      type: 'short-input',
      placeholder: 'nextStartWith from the preceding output list',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_image_job_outputs' },
    },
    {
      id: 'id',
      title: 'Resource OCID Filter',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: [...discoveryOperations] },
    },
    {
      id: 'lifecycleState',
      title: 'Lifecycle Filter',
      type: 'dropdown',
      options: ['CREATING', 'UPDATING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED'].map((id) => ({
        id,
        label: id,
      })),
      emptyIsValid: true,
      mode: 'advanced',
      condition: { field: 'operation', value: [...discoveryOperations] },
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { id: 'timeCreated', label: 'Creation Time' },
        { id: 'displayName', label: 'Display Name' },
      ],
      emptyIsValid: true,
      mode: 'advanced',
      condition: { field: 'operation', value: [...discoveryOperations] },
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { id: 'ASC', label: 'Ascending' },
        { id: 'DESC', label: 'Descending' },
      ],
      emptyIsValid: true,
      mode: 'advanced',
      condition: { field: 'operation', value: [...discoveryOperations] },
    },
  ],
  tools: {
    access: [
      'oci_vision_analyze_image',
      'oci_vision_create_image_job',
      'oci_vision_get_image_job',
      'oci_vision_cancel_image_job',
      'oci_vision_list_projects',
      'oci_vision_get_project',
      'oci_vision_list_models',
      'oci_vision_get_model',
      'oci_vision_list_image_job_outputs',
      'oci_vision_download_image_job_output',
    ],
    config: {
      tool: (params) => `oci_vision_${params.operation || 'analyze_image'}`,
      params: (params) => {
        const operation = (params.operation || 'analyze_image') as OciVisionOperation
        if (!operationFields[operation]) throw new Error('Unsupported OCI Vision operation')
        const result: Record<string, unknown> = { oauthCredential: params.oauthCredential }
        if (params.region) result.region = params.region
        for (const field of operationFields[operation]) {
          const value = params[field]
          if (value !== undefined && value !== null && value !== '') result[field] = value
        }
        if (analysisOperations.some((value) => value === operation)) {
          let features: unknown
          try {
            features = OCI_VISION_FEATURES.some((feature) => feature === params.features)
              ? [params.features]
              : parseOptionalJsonInput(params.features, 'features')
          } catch {
            throw new Error('Features must be a JSON array of OCI Vision feature types')
          }
          if (!Array.isArray(features)) {
            throw new Error('Select at least one OCI Vision feature')
          }
          result.features = features
          for (const [feature, fields] of [
            ['IMAGE_CLASSIFICATION', ['classificationModelId', 'classificationMaxResults']],
            ['OBJECT_DETECTION', ['objectDetectionModelId', 'objectDetectionMaxResults']],
            ['TEXT_DETECTION', ['language']],
            ['FACE_DETECTION', ['faceMaxResults', 'shouldReturnLandmarks']],
          ] as const) {
            if (!features.includes(feature)) {
              for (const field of fields) delete result[field]
            }
          }
        }
        for (const field of [
          'limit',
          'classificationMaxResults',
          'objectDetectionMaxResults',
          'faceMaxResults',
        ]) {
          if (result[field] !== undefined) {
            result[field] = parseOptionalNumberInput(result[field], field, { min: 1 })
          }
        }
        if (operation === 'analyze_image') {
          result.source = params.source || 'file'
          if (result.source === 'file')
            result.file = normalizeFileInput(params.file, { single: true })
          else {
            result.namespaceName = params.namespaceName
            result.bucketName = params.bucketName
            result.objectName = params.imageObjectName
          }
        }
        if (operation === 'download_image_job_output') result.objectName = params.outputObjectName
        return result
      },
    },
  },
  inputs: {
    oauthCredential: { type: 'string', description: 'Connected OCI signing-key account' },
    region: { type: 'string', description: 'Vision region; defaults to credential region' },
    compartmentId: { type: 'string', description: 'Compartment OCID' },
    source: { type: 'string', description: 'file or object_storage' },
    file: { type: 'json', description: 'Authorized Sim UserFile' },
    namespaceName: { type: 'string', description: 'Image namespace' },
    bucketName: { type: 'string', description: 'Image bucket' },
    imageObjectName: { type: 'string', description: 'Existing image object name' },
    features: { type: 'json', description: 'Selected image feature types' },
    projectId: { type: 'string', description: 'Project OCID or model discovery filter' },
    classificationModelId: {
      type: 'string',
      description: 'Active custom classification model OCID',
    },
    objectDetectionModelId: {
      type: 'string',
      description: 'Active custom object detection model OCID',
    },
    classificationMaxResults: { type: 'number', description: 'Maximum labels, 1–1000' },
    objectDetectionMaxResults: { type: 'number', description: 'Maximum objects, 1–1000' },
    faceMaxResults: { type: 'number', description: 'Maximum faces, 1–1000' },
    shouldReturnLandmarks: { type: 'boolean', description: 'Include facial landmark geometry' },
    language: { type: 'string', description: 'Optional ENG scene-text hint' },
    objectLocations: { type: 'json', description: 'Batch Object Storage references' },
    outputNamespaceName: { type: 'string', description: 'Batch output namespace' },
    outputBucketName: { type: 'string', description: 'Batch output bucket' },
    outputPrefix: { type: 'string', description: 'Nonempty batch output prefix' },
    displayName: { type: 'string', description: 'Job name or exact resource-name filter' },
    isZipOutputEnabled: { type: 'boolean', description: 'Request zipped batch output' },
    retryToken: { type: 'string', description: 'Optional stable job-creation retry token' },
    imageJobId: { type: 'string', description: 'Image job OCID' },
    modelId: { type: 'string', description: 'Model OCID for Get Model' },
    outputObjectName: { type: 'string', description: 'Output object name under the job prefix' },
    ifMatch: { type: 'string', description: 'Optional ETag precondition' },
    limit: { type: 'number', description: 'Page size, 1–100' },
    page: { type: 'string', description: 'Vision nextPage cursor' },
    start: { type: 'string', description: 'Object Storage nextStartWith cursor' },
    id: { type: 'string', description: 'Resource OCID list filter' },
    lifecycleState: { type: 'string', description: 'Project or model lifecycle filter' },
    sortBy: { type: 'string', description: 'timeCreated or displayName' },
    sortOrder: { type: 'string', description: 'ASC or DESC' },
  },
  outputs: {
    labels: { type: 'json', description: 'Classification labels and confidence' },
    objects: { type: 'json', description: 'Detected objects, confidence, and polygons' },
    faces: { type: 'json', description: 'Face geometry, confidence, quality, and landmarks' },
    words: { type: 'json', description: 'Scene-text words with confidence and polygons' },
    lines: { type: 'json', description: 'Scene-text lines with retained word references' },
    ontologyClasses: { type: 'json', description: 'Label parent and synonym names' },
    errors: { type: 'json', description: 'Verified image processing error codes and messages' },
    modelVersions: { type: 'json', description: 'Reported model versions by feature' },
    counts: { type: 'json', description: 'Observed and returned collection counts' },
    truncated: { type: 'boolean', description: 'Whether normalized image results were truncated' },
    job: { type: 'json', description: 'Job state, progress, failure details, and output location' },
    imageJobId: { type: 'string', description: 'Image job OCID' },
    cancellationRequested: { type: 'boolean', description: 'Cancellation accepted, not completed' },
    projects: { type: 'json', description: 'One page of projects' },
    project: { type: 'json', description: 'Project details' },
    models: { type: 'json', description: 'One page of models' },
    model: { type: 'json', description: 'Model details' },
    nextPage: { type: 'string', description: 'Next Vision page token, or null' },
    outputLocation: { type: 'json', description: 'The job’s returned Object Storage location' },
    nextStartWith: { type: 'string', description: 'Next Object Storage start cursor, or null' },
    objectName: { type: 'string', description: 'Downloaded object name' },
    etag: { type: 'string', description: 'Job or downloaded object ETag, or null' },
    contentType: { type: 'string', description: 'Downloaded object content type' },
    size: { type: 'number', description: 'Downloaded file size in bytes' },
    file: { type: 'file', description: 'Downloaded output as a Sim UserFile' },
    opcRequestId: { type: 'string', description: 'Oracle request correlation ID' },
  },
}

export const OciVisionBlockMeta = {
  tags: ['cloud', 'automation'],
  url: 'https://www.oracle.com/artificial-intelligence/vision/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Image asset labeling',
      prompt:
        'Build a workflow that classifies uploaded JPEG or PNG images with OCI Vision and stores labels and confidence in a table for asset search.',
      modules: ['files', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'analysis'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Scene text capture',
      prompt:
        'Read English text from a photo with OCI Vision. Save the returned lines and confidence alongside the source file; route uncertain text for human review.',
      modules: ['files', 'tables', 'workflows'],
      category: 'operations',
      tags: ['analysis'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Object inventory from photos',
      prompt:
        'Detect objects in an OCI Object Storage photo with OCI Vision. Record object names, confidence, and bounding polygons without downloading or restaging the input.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Face geometry review',
      prompt:
        'Detect faces and facial landmarks in an authorized uploaded image using OCI Vision. Return face counts and geometry for image composition review; do not identify people.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['analysis'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Custom model image classifier',
      prompt:
        'Discover active OCI Vision classification models in a compartment and project. Analyze an image with the chosen existing model and store its labels, confidence, and model version.',
      modules: ['files', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Batch photo analysis',
      prompt:
        'Submit up to 2,000 existing OCI Object Storage image references to OCI Vision with a distinct output prefix. Persist the returned job ID immediately and use a caller-supplied stable retry token if creation retries are enabled.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Batch status and output retrieval',
      prompt:
        'Check a saved OCI Vision job ID on a bounded schedule. Stop at success, failure, cancellation, an unknown state, or the configured deadline. Report failure details; list its output prefix and download one selected file as a Sim UserFile without parsing or unpacking it.',
      modules: ['scheduled', 'files', 'tables', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
    },
  ],
  skills: [
    {
      name: 'classify-images',
      description: 'Assign searchable labels to images using pretrained classification.',
      content:
        '# Classify images\n\n## Steps\n1. Choose an authorized JPEG/PNG or explicit OCI image object.\n2. Analyze with IMAGE_CLASSIFICATION.\n3. Retain labels and confidence for indexing, checking truncation.\n\n## Output\nLabels, confidence, model version, and truncation metadata.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/vision/using/pretrained_image_analysis_models.htm',
    },
    {
      name: 'detect-image-objects',
      description: 'Locate objects and preserve their geometry for downstream review.',
      content:
        '# Detect image objects\n\n## Steps\n1. Choose an authorized image.\n2. Select OBJECT_DETECTION.\n3. Review confidence and truncation before using detections.\n\n## Output\nObject names, confidence, and normalized bounding polygons.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/vision/using/pretrained_image_analysis_models.htm',
    },
    {
      name: 'read-scene-text',
      description: 'Read English scene text from images without document extraction.',
      content:
        '# Read scene text\n\n## Steps\n1. Select TEXT_DETECTION for an English photo.\n2. Review typed words and lines, preserving line-to-word indexes.\n3. Use Document Understanding for tables, forms, receipts, and document workflows.\n\n## Output\nScene-text words and lines with confidence, geometry, and truncation metadata.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/vision/using/pretrained_image_analysis_models.htm',
    },
    {
      name: 'inspect-face-geometry',
      description: 'Return face polygons and the five documented landmark positions.',
      content:
        '# Inspect face geometry\n\n## Steps\n1. Choose an authorized image for composition review.\n2. Select FACE_DETECTION and optionally enable landmarks.\n3. Review the geometry without identifying people.\n\n## Output\nFace polygons, confidence, quality, and optional five-point landmarks.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/vision/using/api_models.htm',
    },
    {
      name: 'use-existing-custom-models',
      description: 'Discover active models and run classification or object detection.',
      content:
        '# Use an existing custom model\n\n## Steps\n1. Choose a compartment and optional project.\n2. Select an ACTIVE model of the matching classification or object-detection type.\n3. Analyze the image with that model OCID. Training and model changes are outside this integration.\n\n## Output\nTyped classification or detection results with the reported model version.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/vision/using/custom_model_calling_batch.htm',
    },
    {
      name: 'retrieve-batch-files',
      description: 'Track a batch job and retrieve a bounded output file.',
      content:
        '# Retrieve batch output files\n\n## Steps\n1. Create a job from explicit existing image references and retain its ID.\n2. Read status with a bounded cadence and deadline; do not resubmit failures automatically.\n3. List the returned namespace, bucket, and prefix, following nextStartWith. A reused prefix may contain unrelated objects.\n4. Download one selected file up to 50 MiB without guessing its internal format.\n\n## Output\nJob status and a selected output file as a Sim UserFile.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/vision/using/batch_processing.htm',
    },
  ],
} as const satisfies BlockMeta
