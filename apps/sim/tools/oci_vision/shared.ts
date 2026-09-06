import type { ToolConfig } from '@/tools/types'

export const OCI_VISION_OPERATIONS = [
  'analyze_image',
  'create_image_job',
  'get_image_job',
  'cancel_image_job',
  'list_projects',
  'get_project',
  'list_models',
  'get_model',
  'list_image_job_outputs',
  'download_image_job_output',
] as const

export const OCI_VISION_FEATURES = [
  'IMAGE_CLASSIFICATION',
  'OBJECT_DETECTION',
  'TEXT_DETECTION',
  'FACE_DETECTION',
] as const

/** Published Vision endpoint snapshot from Oracle's API index, September 2026. */
export const OCI_VISION_REGIONS = [
  'af-casablanca-1',
  'af-johannesburg-1',
  'ap-batam-1',
  'ap-chuncheon-1',
  'ap-hyderabad-1',
  'ap-kulai-2',
  'ap-melbourne-1',
  'ap-mumbai-1',
  'ap-osaka-1',
  'ap-seoul-1',
  'ap-singapore-1',
  'ap-singapore-2',
  'ap-sydney-1',
  'ap-tokyo-1',
  'ca-montreal-1',
  'ca-toronto-1',
  'eu-amsterdam-1',
  'eu-frankfurt-1',
  'eu-jovanovac-1',
  'eu-madrid-1',
  'eu-madrid-3',
  'eu-marseille-1',
  'eu-milan-1',
  'eu-stockholm-1',
  'eu-turin-1',
  'eu-zurich-1',
  'il-jerusalem-1',
  'me-abudhabi-1',
  'me-dubai-1',
  'me-jeddah-1',
  'me-riyadh-1',
  'mx-monterrey-1',
  'mx-queretaro-1',
  'sa-bogota-1',
  'sa-santiago-1',
  'sa-saopaulo-1',
  'sa-valparaiso-1',
  'sa-vinhedo-1',
  'uk-cardiff-1',
  'uk-london-1',
  'us-ashburn-1',
  'us-phoenix-1',
  'us-sanjose-1',
] as const

export const OCI_VISION_MAX_IMAGE_BYTES = 5_000_000
export const OCI_VISION_MAX_BATCH_BYTES = 500_000
export const OCI_VISION_MAX_JSON_BYTES = 8 * 1024 * 1024
export const OCI_VISION_MAX_OUTPUT_BYTES = 1024 * 1024
export const OCI_VISION_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024

export const ociVisionAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Connected OCI API signing-key service account',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Executor-authorized OCI credential reference',
  },
  region: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Vision region in the credential realm; defaults to the credential region',
  },
} satisfies ToolConfig['params']

export const ociVisionOAuth = {
  required: true,
  provider: 'oci_vision',
  credentialKind: 'service-account',
} as const

export const ociVisionFeatureParams = {
  features: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Array of IMAGE_CLASSIFICATION, OBJECT_DETECTION, TEXT_DETECTION, FACE_DETECTION; select each feature at most once',
  },
  compartmentId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Compartment OCID for image analysis or job creation',
  },
  classificationModelId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Active custom IMAGE_CLASSIFICATION model OCID; omit for pretrained classification',
  },
  objectDetectionModelId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Active custom OBJECT_DETECTION model OCID; omit for pretrained object detection',
  },
  classificationMaxResults: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Classification labels requested, 1–1000 (Sim limit); defaults to 5',
  },
  objectDetectionMaxResults: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Objects requested, 1–1000 (Sim limit); defaults to 5',
  },
  faceMaxResults: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Faces requested, 1–1000 (Sim limit); defaults to 50',
  },
  shouldReturnLandmarks: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Include the five documented facial landmark positions; defaults to false',
  },
  language: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Optional ENG language hint for scene-text OCR; only English is documented',
  },
} satisfies ToolConfig['params']

export const ociVisionListParams = {
  compartmentId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Compartment OCID to list',
  },
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Items per page, 1–100 (Sim limit); defaults to 10',
  },
  page: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Opaque nextPage from the preceding Vision list response',
  },
  displayName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Exact display-name filter',
  },
  lifecycleState: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'CREATING, UPDATING, ACTIVE, DELETING, DELETED, or FAILED',
  },
  id: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Exact resource OCID filter',
  },
  sortBy: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Sort by timeCreated or displayName',
  },
  sortOrder: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'ASC or DESC',
  },
} satisfies ToolConfig['params']

export const ociVisionJobIdParam = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Image job OCID returned by Create Image Job',
} as const

/** Only the credential reference inserted by the authorized executor crosses this boundary. */
export function createOciVisionOperationInput<T extends { accessToken?: string; region?: string }>(
  params: T,
  fields: readonly (keyof T)[]
) {
  const input: Record<string, unknown> = {
    credentialId: params.accessToken ?? '',
    region: params.region,
  }
  for (const key of fields) {
    if (params[key] !== undefined) input[String(key)] = params[key]
  }
  return input
}

export const OCI_VISION_FEATURE_FIELDS = [
  'features',
  'compartmentId',
  'classificationModelId',
  'objectDetectionModelId',
  'classificationMaxResults',
  'objectDetectionMaxResults',
  'faceMaxResults',
  'shouldReturnLandmarks',
  'language',
] as const

export const OCI_VISION_LIST_FIELDS = [
  'compartmentId',
  'limit',
  'page',
  'displayName',
  'lifecycleState',
  'id',
  'sortBy',
  'sortOrder',
] as const
