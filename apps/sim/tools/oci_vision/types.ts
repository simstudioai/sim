import type { OciVisionInput } from '@/lib/internal/oci-vision/schema'
import type { UserFile } from '@/executor/types'
import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

export type OciVisionOperation = OciVisionInput['operation']
type OperationParams<O extends OciVisionOperation> = Omit<
  Extract<OciVisionInput, { operation: O }>,
  'operation' | 'credentialId' | '__resolvedSecretTraceProvenance'
>
export type OciVisionParams<O extends OciVisionOperation> = Omit<OperationParams<O>, 'limit'> & {
  oauthCredential: string
  accessToken?: string
  limit?: number
}

export interface VisionPolygon {
  normalizedVertices: { x: number; y: number }[]
}
export interface VisionLabel {
  name: string
  confidence: number
}
export interface VisionObject extends VisionLabel {
  boundingPolygon: VisionPolygon
}
export interface VisionWord {
  text: string
  confidence: number
  boundingPolygon: VisionPolygon
}
export interface VisionLine extends VisionWord {
  wordIndexes: number[]
  wordIndexesTruncated: boolean
}
export interface VisionFace {
  confidence: number
  boundingPolygon: VisionPolygon
  qualityScore: number
  landmarks: { type: string; x: number; y: number }[]
}
export interface VisionCollectionCount {
  observed: number
  returned: number
  truncated: boolean
}
export interface VisionAnalysis {
  labels: VisionLabel[]
  objects: VisionObject[]
  faces: VisionFace[]
  words: VisionWord[]
  lines: VisionLine[]
  ontologyClasses: { name: string; parentNames: string[]; synonymNames: string[] }[]
  errors: { code: string; message: string }[]
  modelVersions: {
    classification: string | null
    objectDetection: string | null
    textDetection: string | null
    faceDetection: string | null
  }
  counts: Record<
    'labels' | 'objects' | 'faces' | 'words' | 'lines' | 'ontologyClasses' | 'errors',
    VisionCollectionCount
  >
  truncated: boolean
}
export interface VisionOutputLocation {
  namespaceName: string
  bucketName: string
  prefix: string
}
export interface VisionJob {
  id: string
  compartmentId: string
  displayName: string | null
  lifecycleState: string
  lifecycleDetails: string | null
  percentComplete: number | null
  timeAccepted: string
  timeStarted: string | null
  timeFinished: string | null
  outputLocation: VisionOutputLocation
  isZipOutputEnabled: boolean | null
}
export interface VisionProject {
  id: string
  compartmentId: string
  displayName: string | null
  description: string | null
  lifecycleState: string
  lifecycleDetails: string | null
  timeCreated: string
  timeUpdated: string | null
}
export interface VisionModel extends VisionProject {
  projectId: string
  modelType: string
  modelVersion: string
}
export interface VisionOutputObject {
  name: string
  size: number | null
  etag: string | null
  timeModified: string | null
}

interface VisionOutputMap {
  analyze_image: VisionAnalysis
  create_image_job: { job: VisionJob }
  get_image_job: { job: VisionJob; etag: string | null }
  cancel_image_job: { imageJobId: string; cancellationRequested: boolean }
  list_projects: { projects: VisionProject[]; nextPage: string | null }
  get_project: { project: VisionProject }
  list_models: { models: VisionModel[]; nextPage: string | null }
  get_model: { model: VisionModel }
  list_image_job_outputs: {
    imageJobId: string
    outputLocation: VisionOutputLocation
    objects: VisionOutputObject[]
    nextStartWith: string | null
  }
  download_image_job_output: {
    imageJobId: string
    objectName: string
    etag: string | null
    contentType: string
    size: number
    file: UserFile
  }
}
export interface OciVisionResponse<O extends OciVisionOperation = OciVisionOperation>
  extends ToolResponse {
  output: VisionOutputMap[O] & { opcRequestId: string | null }
}

const confidenceOutput = { type: 'number', description: 'Confidence from 0 to 1' } as const
const polygonOutput = {
  type: 'object',
  description: 'Polygon in normalized image coordinates; origin at top-left',
  properties: {
    normalizedVertices: {
      type: 'array',
      items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
    },
  },
} as const satisfies ToolOutputProperty
const labelProperties = { name: { type: 'string' }, confidence: confidenceOutput } as const
const wordProperties = {
  text: { type: 'string' },
  confidence: confidenceOutput,
  boundingPolygon: polygonOutput,
} as const
const nullableString = { type: 'string', optional: true } as const
const countOutput = {
  type: 'object',
  properties: {
    observed: { type: 'number' },
    returned: { type: 'number' },
    truncated: { type: 'boolean' },
  },
} as const
export const OCI_VISION_REQUEST_OUTPUT = {
  opcRequestId: { ...nullableString, description: 'Oracle request correlation ID' },
} satisfies Record<string, ToolOutputProperty>

export const OCI_VISION_ANALYSIS_OUTPUTS = {
  labels: { type: 'array', items: { type: 'object', properties: labelProperties } },
  objects: {
    type: 'array',
    items: { type: 'object', properties: { ...labelProperties, boundingPolygon: polygonOutput } },
  },
  faces: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        confidence: confidenceOutput,
        boundingPolygon: polygonOutput,
        qualityScore: { type: 'number', description: 'Face quality from 0 to 1' },
        landmarks: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } },
          },
        },
      },
    },
  },
  words: { type: 'array', items: { type: 'object', properties: wordProperties } },
  lines: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        ...wordProperties,
        wordIndexes: {
          type: 'array',
          items: { type: 'number' },
          description: 'Indexes into the returned words array',
        },
        wordIndexesTruncated: {
          type: 'boolean',
          description: 'Some associated words were omitted by output limits',
        },
      },
    },
  },
  ontologyClasses: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parentNames: { type: 'array', items: { type: 'string' } },
        synonymNames: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  errors: {
    type: 'array',
    description: 'Verified processing errors for this single image',
    items: {
      type: 'object',
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
  modelVersions: {
    type: 'object',
    properties: {
      classification: nullableString,
      objectDetection: nullableString,
      textDetection: nullableString,
      faceDetection: nullableString,
    },
  },
  counts: {
    type: 'object',
    properties: {
      labels: countOutput,
      objects: countOutput,
      faces: countOutput,
      words: countOutput,
      lines: countOutput,
      ontologyClasses: countOutput,
      errors: countOutput,
    },
  },
  truncated: {
    type: 'boolean',
    description: 'At least one collection or string was limited by Sim',
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_VISION_LOCATION_OUTPUT = {
  type: 'object',
  properties: {
    namespaceName: { type: 'string' },
    bucketName: { type: 'string' },
    prefix: { type: 'string' },
  },
} as const satisfies ToolOutputProperty

export const OCI_VISION_JOB_OUTPUT = {
  type: 'object',
  description: 'Image job status; FAILED may carry PARTIALLY_SUCCEEDED lifecycle details',
  properties: {
    id: { type: 'string' },
    compartmentId: { type: 'string' },
    displayName: nullableString,
    lifecycleState: { type: 'string' },
    lifecycleDetails: nullableString,
    percentComplete: { type: 'number', optional: true },
    timeAccepted: { type: 'string' },
    timeStarted: nullableString,
    timeFinished: nullableString,
    outputLocation: OCI_VISION_LOCATION_OUTPUT,
    isZipOutputEnabled: { type: 'boolean', optional: true },
  },
} as const satisfies ToolOutputProperty

export const OCI_VISION_PROJECT_OUTPUT = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    compartmentId: { type: 'string' },
    displayName: nullableString,
    description: nullableString,
    lifecycleState: { type: 'string' },
    lifecycleDetails: nullableString,
    timeCreated: { type: 'string' },
    timeUpdated: nullableString,
  },
} as const satisfies ToolOutputProperty

export const OCI_VISION_MODEL_OUTPUT = {
  type: 'object',
  properties: {
    ...OCI_VISION_PROJECT_OUTPUT.properties,
    projectId: { type: 'string' },
    modelType: { type: 'string' },
    modelVersion: { type: 'string' },
  },
} as const satisfies ToolOutputProperty

export const OCI_VISION_OBJECT_OUTPUT = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    size: { type: 'number', optional: true },
    etag: nullableString,
    timeModified: nullableString,
  },
} as const satisfies ToolOutputProperty
