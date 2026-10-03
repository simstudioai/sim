import { isPlainRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { z } from 'zod'
import { OciVisionOperationError } from '@/lib/internal/oci-vision/errors'
import { OCI_VISION_MAX_OUTPUT_BYTES } from '@/tools/oci_vision/shared'
import type {
  VisionAnalysis,
  VisionCollectionCount,
  VisionJob,
  VisionModel,
  VisionOutputObject,
  VisionProject,
} from '@/tools/oci_vision/types'

const text = z.string().max(4096)
const optionalText = text.nullish().transform((value) => value ?? null)
const coordinate = z.number().min(0).max(1)
const polygon = z.object({
  normalizedVertices: z
    .array(z.object({ x: coordinate, y: coordinate }))
    .min(3)
    .max(16),
})
const label = z.object({ name: z.string(), confidence: coordinate })
const word = z.object({ text: z.string(), confidence: coordinate, boundingPolygon: polygon })
const line = word.extend({ wordIndexes: z.array(z.number().int().nonnegative()) })
const face = z.object({
  confidence: coordinate,
  boundingPolygon: polygon,
  qualityScore: coordinate,
  landmarks: z
    .array(
      z.object({
        type: z.enum([
          'LEFT_EYE',
          'RIGHT_EYE',
          'NOSE_TIP',
          'LEFT_EDGE_OF_MOUTH',
          'RIGHT_EDGE_OF_MOUTH',
        ]),
        x: coordinate,
        y: coordinate,
      })
    )
    .max(5)
    .default([]),
})
const project = z.object({
  id: text,
  compartmentId: text,
  displayName: optionalText,
  description: optionalText,
  lifecycleState: text,
  lifecycleDetails: optionalText,
  timeCreated: text,
  timeUpdated: optionalText,
})
const model = project.extend({ projectId: text, modelType: text, modelVersion: text })
const outputLocation = z.object({
  namespaceName: z.string().min(1).max(255),
  bucketName: z.string().min(1).max(255),
  prefix: z.string().max(1024),
})
const job = z.object({
  id: text,
  compartmentId: text,
  displayName: optionalText,
  lifecycleState: text,
  lifecycleDetails: optionalText,
  percentComplete: z
    .number()
    .min(0)
    .max(100)
    .nullish()
    .transform((value) => value ?? null),
  timeAccepted: text,
  timeStarted: optionalText,
  timeFinished: optionalText,
  outputLocation,
  isZipOutputEnabled: z
    .boolean()
    .nullish()
    .transform((value) => value ?? null),
})
const outputObject = z.object({
  name: z.string().min(1).max(1024),
  size: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? null),
  etag: optionalText,
  timeModified: optionalText,
})

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success)
    throw new OciVisionOperationError('Unexpected OCI Vision response shape', 502)
  return parsed.data
}

export function visionRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new OciVisionOperationError('Unexpected OCI response shape', 502)
  return value
}

export function visionArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new OciVisionOperationError('Unexpected OCI collection', 502)
  return value
}

export function normalizeVisionProject(value: unknown): VisionProject {
  return parse(project, value)
}

export function normalizeVisionModel(value: unknown): VisionModel {
  return parse(model, value)
}

export function normalizeVisionJob(value: unknown): VisionJob {
  return parse(job, value)
}

export function normalizeVisionOutputObject(value: unknown): VisionOutputObject {
  return parse(outputObject, value)
}

export function normalizeVisionCursor(value: unknown): string | null {
  return parse(z.string().min(1).max(4096).nullish(), value) ?? null
}

/** Retains only documented fields and explicitly accounts for bounded output collections. */
export function normalizeVisionAnalysis(value: unknown): VisionAnalysis {
  const root = visionRecord(value)
  const imageText = root.imageText == null ? {} : visionRecord(root.imageText)
  const sources = {
    labels: visionArray(root.labels),
    objects: visionArray(root.imageObjects),
    faces: visionArray(root.detectedFaces),
    words: visionArray(imageText.words),
    lines: visionArray(imageText.lines),
    ontologyClasses: visionArray(root.ontologyClasses),
    errors: visionArray(root.errors),
  }
  let textBytes = 0
  let stringTruncated = false
  const boundedText = (value: string, length = 4096) => {
    stringTruncated ||= value.length > length
    return truncate(value, length, '')
  }
  const words = []
  for (const candidate of sources.words.slice(0, 2000)) {
    const parsed = parse(word, candidate)
    const item = { ...parsed, text: boundedText(parsed.text) }
    const bytes = Buffer.byteLength(item.text, 'utf8')
    if (textBytes + bytes > 64 * 1024) break
    textBytes += bytes
    words.push(item)
  }
  const lines = []
  for (const candidate of sources.lines.slice(0, 500)) {
    const parsed = parse(line, candidate)
    const item = { ...parsed, text: boundedText(parsed.text) }
    if (item.wordIndexes.some((index) => index >= sources.words.length)) {
      throw new OciVisionOperationError('OCI text contains an invalid word index', 502)
    }
    const bytes = Buffer.byteLength(item.text, 'utf8')
    if (textBytes + bytes > 64 * 1024) break
    textBytes += bytes
    const wordIndexes = item.wordIndexes.filter((index) => index < words.length)
    lines.push({
      ...item,
      wordIndexes,
      wordIndexesTruncated: wordIndexes.length !== item.wordIndexes.length,
    })
  }
  const boundedErrorText = (value: unknown, length: number) => {
    const input = parse(z.string(), value)
    return boundedText(input, length)
  }
  const output: VisionAnalysis = {
    labels: sources.labels.slice(0, 1000).map((item) => {
      const parsed = parse(label, item)
      return { ...parsed, name: boundedText(parsed.name) }
    }),
    objects: sources.objects.slice(0, 1000).map((item) => {
      const parsed = parse(label.extend({ boundingPolygon: polygon }), item)
      return { ...parsed, name: boundedText(parsed.name) }
    }),
    faces: sources.faces.slice(0, 1000).map((item) => parse(face, item)),
    words,
    lines,
    ontologyClasses: sources.ontologyClasses.slice(0, 1000).map((item) => {
      const parsed = parse(
        z.object({
          name: z.string(),
          parentNames: z.array(z.string()).default([]),
          synonymNames: z.array(z.string()).default([]),
        }),
        item
      )
      stringTruncated ||= parsed.parentNames.length > 100 || parsed.synonymNames.length > 100
      return {
        name: boundedText(parsed.name),
        parentNames: parsed.parentNames.slice(0, 100).map((name) => boundedText(name)),
        synonymNames: parsed.synonymNames.slice(0, 100).map((name) => boundedText(name)),
      }
    }),
    errors: sources.errors.slice(0, 100).map((item) => {
      const error = visionRecord(item)
      return {
        code: boundedErrorText(error.code, 255),
        message: boundedErrorText(error.message, 1024),
      }
    }),
    modelVersions: {
      classification: parse(optionalText, root.imageClassificationModelVersion),
      objectDetection: parse(optionalText, root.objectDetectionModelVersion),
      textDetection: parse(optionalText, root.textDetectionModelVersion),
      faceDetection: parse(optionalText, root.faceDetectionModelVersion),
    },
    counts: {
      labels: { observed: sources.labels.length, returned: 0, truncated: false },
      objects: { observed: sources.objects.length, returned: 0, truncated: false },
      faces: { observed: sources.faces.length, returned: 0, truncated: false },
      words: { observed: sources.words.length, returned: 0, truncated: false },
      lines: { observed: sources.lines.length, returned: 0, truncated: false },
      ontologyClasses: { observed: sources.ontologyClasses.length, returned: 0, truncated: false },
      errors: { observed: sources.errors.length, returned: 0, truncated: false },
    },
    truncated: stringTruncated,
  }
  const keys = [
    'ontologyClasses',
    'labels',
    'objects',
    'faces',
    'words',
    'lines',
    'errors',
  ] as const
  const updateCounts = () => {
    for (const key of keys) {
      const count: VisionCollectionCount = output.counts[key]
      count.returned = output[key].length
      count.truncated = count.returned < count.observed
    }
    output.truncated = stringTruncated || keys.some((key) => output.counts[key].truncated)
  }
  updateCounts()
  /** Reserve space for the request ID and executor's response envelope. */
  while (Buffer.byteLength(JSON.stringify(output), 'utf8') > OCI_VISION_MAX_OUTPUT_BYTES - 4096) {
    const key = keys.find((key) => output[key].length > 0)
    if (!key)
      throw new OciVisionOperationError('OCI analysis metadata exceeds the output limit', 502)
    output[key].splice(Math.floor(output[key].length / 2))
    if (key === 'words') {
      for (const item of output.lines) {
        const indexes = item.wordIndexes.filter((index) => index < output.words.length)
        item.wordIndexesTruncated ||= indexes.length !== item.wordIndexes.length
        item.wordIndexes = indexes
      }
    }
    updateCounts()
  }
  return output
}
