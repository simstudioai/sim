/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  request: vi.fn(),
  prepareEndpoint: vi.fn(),
  readImage: vi.fn(),
  provenance: vi.fn(),
}))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-vision/image-input', () => ({ readOciVisionImage: mocks.readImage }))
vi.mock('@/lib/execution/model-input-provenance', () => ({
  validateOpaqueModelInputProvenance: mocks.provenance,
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({ uploadExecutionFile: vi.fn() }))
vi.mock('@/lib/uploads/contexts/copilot', () => ({ uploadCopilotFile: vi.fn() }))
vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: vi.fn(),
}))

import { normalizeVisionAnalysis, normalizeVisionJob } from '@/lib/internal/oci-vision/normalizers'
import {
  executeOciVisionOperation,
  type OciVisionOperationContext,
  prepareOciVisionClient,
} from '@/lib/internal/oci-vision/operations'
import { ociVisionInputSchema } from '@/lib/internal/oci-vision/schema'
import { OCI_VISION_FEATURES } from '@/tools/oci_vision/shared'

const context: OciVisionOperationContext = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  headers: new Headers(),
  requestId: 'request-1',
}
const endpoint = { region: { id: 'us-ashburn-1', realm: 'oc1' }, origin: 'https://vision.example' }
const object = { namespaceName: 'namespace', bucketName: 'images', objectName: 'photos/a.jpg' }
const analyze = {
  credentialId: 'resolved-credential',
  operation: 'analyze_image',
  source: 'object_storage',
  features: ['IMAGE_CLASSIFICATION'],
  ...object,
}
const batch = {
  credentialId: 'resolved-credential',
  operation: 'create_image_job',
  features: ['OBJECT_DETECTION'],
  objectLocations: [object],
  outputNamespaceName: 'output-namespace',
  outputBucketName: 'output-bucket',
  outputPrefix: 'vision/run/',
}
const job = {
  id: 'job-1',
  compartmentId: 'compartment-1',
  lifecycleState: 'ACCEPTED',
  timeAccepted: '2026-09-01T00:00:00Z',
  outputLocation: {
    namespaceName: 'output-namespace',
    bucketName: 'output-bucket',
    prefix: 'vision/run/',
  },
}
const project = {
  id: 'project-1',
  compartmentId: 'compartment-1',
  displayName: 'Project',
  lifecycleState: 'ACTIVE',
  timeCreated: '2026-09-01T00:00:00Z',
}
const model = {
  ...project,
  id: 'model-1',
  projectId: 'project-1',
  modelType: 'IMAGE_CLASSIFICATION',
  modelVersion: '1',
}
const polygon = {
  normalizedVertices: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
}
const word = { text: 'Hello', confidence: 0.9, boundingPolygon: polygon }

function response(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    status,
    headers,
    body: Buffer.from(JSON.stringify(value)),
    opcRequestId: 'oracle-request-1',
  }
}
function execute(input: unknown) {
  return executeOciVisionOperation(ociVisionInputSchema.parse(input), context)
}

describe('OCI Vision operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockResolvedValue({
      request: mocks.request,
      prepareStaticEndpoint: mocks.prepareEndpoint,
    })
    mocks.prepareEndpoint.mockResolvedValue(endpoint)
    mocks.provenance.mockReturnValue({ success: true })
    mocks.readImage.mockResolvedValue(Buffer.from('authorized-image'))
    mocks.request.mockResolvedValue(response({}))
  })

  it.each(OCI_VISION_FEATURES)('sends %s with one paid attempt', async (feature) => {
    await execute({ ...analyze, features: [feature] })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    const request = mocks.request.mock.calls[0][0]
    expect(request).toMatchObject({
      method: 'POST',
      encodedPath: '/20220125/actions/analyzeImage',
      maxResponseBytes: 8 * 1024 * 1024,
    })
    expect(request.retry).toBeUndefined()
    expect(JSON.parse(Buffer.from(request.body).toString())).toMatchObject({
      image: { source: 'OBJECT_STORAGE', ...object },
      features: [{ featureType: feature }],
    })
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'resolved-credential',
      workspaceId: 'workspace-1',
      serviceId: 'oci_vision',
    })
  })

  it('combines all features with matching custom models and documented feature parameters', async () => {
    mocks.request
      .mockResolvedValueOnce(response(model))
      .mockResolvedValueOnce(
        response({ ...model, id: 'objects-model', modelType: 'OBJECT_DETECTION' })
      )
      .mockResolvedValueOnce(response({}))
    await execute({
      ...analyze,
      features: [...OCI_VISION_FEATURES],
      classificationModelId: 'model-1',
      objectDetectionModelId: 'objects-model',
      classificationMaxResults: 20,
      objectDetectionMaxResults: 30,
      faceMaxResults: 40,
      shouldReturnLandmarks: true,
      language: 'ENG',
    })
    const body = JSON.parse(Buffer.from(mocks.request.mock.calls[2][0].body).toString())
    expect(body.features).toEqual([
      { featureType: 'IMAGE_CLASSIFICATION', modelId: 'model-1', maxResults: 20 },
      { featureType: 'OBJECT_DETECTION', modelId: 'objects-model', maxResults: 30 },
      { featureType: 'TEXT_DETECTION', language: 'ENG' },
      { featureType: 'FACE_DETECTION', maxResults: 40, shouldReturnLandmarks: true },
    ])
  })

  it.each([
    { ...model, lifecycleState: 'CREATING' },
    { ...model, modelType: 'OBJECT_DETECTION' },
    { ...model, id: 'different-model' },
  ])('rejects an incompatible custom model before inference', async (value) => {
    mocks.request.mockResolvedValue(response(value))
    await expect(execute({ ...analyze, classificationModelId: 'model-1' })).rejects.toThrow(
      'Custom model'
    )
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0][0].method).toBe('GET')
  })

  it('reads only the authorized file path and forwards the operation abort signal', async () => {
    const file = { name: 'a.png', key: 'workspace/workspace-1/a.png', size: 42 }
    await execute({
      credentialId: 'resolved-credential',
      operation: 'analyze_image',
      source: 'file',
      file: JSON.stringify(file),
      features: ['TEXT_DETECTION'],
    })
    expect(mocks.readImage).toHaveBeenCalledWith(file, context, expect.any(AbortSignal))
    expect(JSON.parse(Buffer.from(mocks.request.mock.calls[0][0].body).toString()).image).toEqual({
      source: 'INLINE',
      data: Buffer.from('authorized-image').toString('base64'),
    })
  })

  it('fails closed on opaque model provenance before any client or file operation', async () => {
    mocks.provenance.mockReturnValue({
      success: false,
      status: 400,
      error: 'Model input provenance is unavailable',
    })
    await expect(execute(analyze)).rejects.toThrow('provenance')
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.readImage).not.toHaveBeenCalled()
  })

  it.each([undefined, 'stable-token'])(
    'creates immediately with retry token %s',
    async (retryToken) => {
      mocks.request.mockResolvedValue(response(job))
      const result = await execute({ ...batch, retryToken })
      expect(result.output).toMatchObject({ job: { id: 'job-1', lifecycleState: 'ACCEPTED' } })
      expect(mocks.request).toHaveBeenCalledTimes(1)
      const request = mocks.request.mock.calls[0][0]
      expect(request.retry).toEqual(
        retryToken ? { kind: 'tokenized', maxAttempts: 2, retryToken } : undefined
      )
      expect(JSON.parse(Buffer.from(request.body).toString())).toMatchObject({
        inputLocation: {
          sourceType: 'OBJECT_LIST_INLINE_INPUT_LOCATION',
          objectLocations: [object],
        },
        outputLocation: job.outputLocation,
        isZipOutputEnabled: false,
      })
    }
  )

  it('enforces the complete batch JSON byte ceiling before sending', async () => {
    const objectLocations = Array.from({ length: 600 }, () => ({
      ...object,
      objectName: 'x'.repeat(1000),
    }))
    await expect(execute({ ...batch, objectLocations })).rejects.toThrow()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it.each([
    'ACCEPTED',
    'IN_PROGRESS',
    'SUCCEEDED',
    'FAILED',
    'CANCELING',
    'CANCELED',
    'FUTURE_STATE',
  ])('reads %s as a successful job status without polling', async (lifecycleState) => {
    mocks.request.mockResolvedValue(
      response({ ...job, lifecycleState, lifecycleDetails: 'PARTIALLY_SUCCEEDED' })
    )
    const result = await execute({
      credentialId: 'resolved-credential',
      operation: 'get_image_job',
      imageJobId: 'job-1',
    })
    expect(result).toMatchObject({
      success: true,
      output: { job: { lifecycleState, lifecycleDetails: 'PARTIALLY_SUCCEEDED' } },
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('acknowledges a bodyless 202 cancellation without claiming completion', async () => {
    mocks.request.mockResolvedValue({ status: 202, headers: {}, body: new Uint8Array(0) })
    const result = await execute({
      credentialId: 'resolved-credential',
      operation: 'cancel_image_job',
      imageJobId: 'job-1',
      ifMatch: 'etag-1',
    })
    expect(result.output).toEqual({
      imageJobId: 'job-1',
      cancellationRequested: true,
      opcRequestId: null,
    })
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      body: new Uint8Array(0),
      headers: { 'if-match': 'etag-1' },
    })
    expect(mocks.request.mock.calls[0][0].retry).toBeUndefined()
  })

  it('returns the job ETag for guarded cancellation', async () => {
    mocks.request.mockResolvedValueOnce(response(job, 200, { etag: 'job-etag-1' }))
    const result = await execute({
      credentialId: 'resolved-credential',
      operation: 'get_image_job',
      imageJobId: 'job-1',
    })
    expect(result.output).toHaveProperty('etag', 'job-etag-1')
    expect(mocks.request.mock.calls[0][0].responseHeaders).toContain('etag')
  })

  it('rejects an undocumented cancellation response status', async () => {
    mocks.request.mockResolvedValue(response({}, 200))
    await expect(
      execute({
        credentialId: 'resolved-credential',
        operation: 'cancel_image_job',
        imageJobId: 'job-1',
      })
    ).rejects.toThrow('cancellation response')
  })

  it.each(['list_projects', 'list_models'])('uses header pagination for %s', async (operation) => {
    mocks.request.mockResolvedValue(
      response({ items: [operation === 'list_models' ? model : project] }, 200, {
        'opc-next-page': 'page-next',
      })
    )
    const result = await execute({
      credentialId: 'resolved-credential',
      operation,
      compartmentId: 'compartment-1',
      projectId: 'project-1',
      page: 'page-current',
      limit: 1,
    })
    expect(result.output).toHaveProperty('nextPage', 'page-next')
    expect(mocks.request.mock.calls[0][0].queryPairs).toContainEqual(['page', 'page-current'])
    expect(mocks.request.mock.calls[0][0].queryPairs).not.toContainEqual([
      'modelType',
      'IMAGE_CLASSIFICATION',
    ])
  })

  it('keeps Object Storage start pagination separate and rejects objects outside the prefix', async () => {
    mocks.request.mockResolvedValueOnce(response(job)).mockResolvedValueOnce(
      response({
        objects: [{ name: 'vision/run/a.json', size: 12 }],
        nextStartWith: 'vision/run/b.json',
      })
    )
    const input = {
      credentialId: 'resolved-credential',
      operation: 'list_image_job_outputs',
      imageJobId: 'job-1',
      start: 'vision/run/a.json',
      limit: 10,
    }
    const result = await execute(input)
    expect(result.output).toMatchObject({
      nextStartWith: 'vision/run/b.json',
      objects: [{ name: 'vision/run/a.json', size: 12, etag: null }],
    })
    expect(mocks.request.mock.calls[1][0].queryPairs).toContainEqual(['start', 'vision/run/a.json'])
    expect(mocks.request.mock.calls[1][0].queryPairs).toContainEqual(['prefix', 'vision/run/'])
    mocks.request
      .mockResolvedValueOnce(response(job))
      .mockResolvedValueOnce(response({ objects: [{ name: 'another-run/a.json' }] }))
    await expect(execute(input)).rejects.toThrow('outside the output prefix')
  })

  it.each(['ap-hyderabad-1', 'ap-kulai-2'])(
    'prepares the published hostname exception for %s',
    async (region) => {
      mocks.prepareEndpoint.mockResolvedValue({ ...endpoint, region: { id: region, realm: 'oc1' } })
      await prepareOciVisionClient({ credentialId: 'resolved-credential', region }, 'workspace-1')
      expect(mocks.prepareEndpoint).toHaveBeenCalledTimes(2)
    }
  )

  it('rejects unavailable regions and aborted operations before requests', async () => {
    mocks.prepareEndpoint.mockResolvedValueOnce({
      ...endpoint,
      region: { id: 'unknown-region', realm: 'oc1' },
    })
    await expect(execute(analyze)).rejects.toThrow('region')
    const signal = AbortSignal.abort(new Error('Stopped'))
    await expect(
      executeOciVisionOperation(ociVisionInputSchema.parse(analyze), { ...context, signal })
    ).rejects.toThrow('Stopped')
    expect(mocks.request).not.toHaveBeenCalled()
  })
})

describe('OCI Vision contracts and bounded projections', () => {
  it.each([
    { ...analyze, features: [] },
    { ...analyze, features: ['TEXT_DETECTION', 'TEXT_DETECTION'] },
    { ...analyze, language: 'ENG' },
    { ...analyze, features: ['TEXT_DETECTION'], language: 'FRA' },
    { ...analyze, features: ['TEXT_DETECTION'], classificationModelId: 'model-1' },
    { ...analyze, classificationMaxResults: 1001 },
    { ...analyze, file: { name: 'x', size: 1, key: 'workspace/x' } },
    { ...batch, objectLocations: Array.from({ length: 2001 }, () => object) },
    { ...batch, outputPrefix: '' },
    { ...batch, retryToken: 'x'.repeat(65) },
    { credentialId: 'c', operation: 'list_projects', compartmentId: 'c', limit: 101 },
  ])('rejects incompatible input %#', (input) => {
    expect(ociVisionInputSchema.safeParse(input).success).toBe(false)
  })

  it('accepts serialized batch references after resolution', () => {
    const parsed = ociVisionInputSchema.parse({
      ...batch,
      objectLocations: JSON.stringify([object]),
    })
    expect(parsed).toHaveProperty('objectLocations', [object])
  })

  it('projects only documented fields for all feature outputs', () => {
    const output = normalizeVisionAnalysis({
      labels: [{ name: 'vehicle', confidence: 0.8, privateExtra: 'omit' }],
      imageObjects: [{ name: 'car', confidence: 0.7, boundingPolygon: polygon }],
      imageText: { words: [word], lines: [{ ...word, wordIndexes: [0] }] },
      detectedFaces: [
        {
          confidence: 0.9,
          qualityScore: 0.8,
          boundingPolygon: polygon,
          landmarks: [{ type: 'NOSE_TIP', x: 0.5, y: 0.5 }],
        },
      ],
      ontologyClasses: [{ name: 'car', parentNames: ['vehicle'], synonymNames: ['auto'] }],
      errors: [{ code: 'PROCESSING_ERROR', message: 'Synthetic failure', retryable: true }],
      imageClassificationModelVersion: 'classification-v1',
      objectDetectionModelVersion: 'objects-v1',
      textDetectionModelVersion: 'text-v1',
      faceDetectionModelVersion: 'faces-v1',
      privateExtra: 'omit',
    })
    expect(output.labels).toEqual([{ name: 'vehicle', confidence: 0.8 }])
    expect(output.lines[0]).toMatchObject({ wordIndexes: [0], wordIndexesTruncated: false })
    expect(output.faces[0].landmarks).toEqual([{ type: 'NOSE_TIP', x: 0.5, y: 0.5 }])
    expect(output.errors).toEqual([{ code: 'PROCESSING_ERROR', message: 'Synthetic failure' }])
    expect(output.modelVersions).toEqual({
      classification: 'classification-v1',
      objectDetection: 'objects-v1',
      textDetection: 'text-v1',
      faceDetection: 'faces-v1',
    })
    expect(JSON.stringify(output)).not.toContain('privateExtra')
  })

  it('bounds collections and preserves valid line indexes after truncating words', () => {
    const output = normalizeVisionAnalysis({
      labels: Array.from({ length: 1001 }, () => ({ name: 'label', confidence: 0.8 })),
      imageText: {
        words: Array.from({ length: 2001 }, () => word),
        lines: [{ ...word, wordIndexes: [0, 1999, 2000] }],
      },
    })
    expect(output.counts.labels).toEqual({ observed: 1001, returned: 1000, truncated: true })
    expect(output.words).toHaveLength(2000)
    expect(output.lines[0]).toMatchObject({ wordIndexes: [0, 1999], wordIndexesTruncated: true })
    expect(output.truncated).toBe(true)
  })

  it('enforces text and total normalized byte ceilings with explicit truncation', () => {
    const output = normalizeVisionAnalysis({
      labels: Array.from({ length: 1000 }, () => ({ name: '界'.repeat(4000), confidence: 0.8 })),
      imageText: {
        words: Array.from({ length: 2000 }, () => ({ ...word, text: 'x'.repeat(4000) })),
      },
    })
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(1024 * 1024)
    expect(
      output.words.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0)
    ).toBeLessThanOrEqual(64 * 1024)
    expect(output.truncated).toBe(true)
  })

  it('rejects malformed geometry and dangling provider word indexes', () => {
    expect(() =>
      normalizeVisionAnalysis({
        imageObjects: [{ name: 'x', confidence: 2, boundingPolygon: polygon }],
      })
    ).toThrow('response shape')
    expect(() =>
      normalizeVisionAnalysis({
        imageText: { words: [word], lines: [{ ...word, wordIndexes: [1] }] },
      })
    ).toThrow('invalid word index')
  })

  it('truncates valid long OCR text and ontology lists instead of rejecting paid results', () => {
    const output = normalizeVisionAnalysis({
      imageText: {
        words: [{ ...word, text: 'x'.repeat(5000) }],
        lines: [{ ...word, text: 'x'.repeat(5000), wordIndexes: [0] }],
      },
      ontologyClasses: [
        {
          name: 'class',
          parentNames: Array.from({ length: 101 }, (_, index) => `parent-${index}`),
          synonymNames: Array.from({ length: 101 }, (_, index) => `synonym-${index}`),
        },
      ],
    })
    expect(output.words[0].text.length).toBeLessThanOrEqual(4096)
    expect(output.lines[0]).toMatchObject({ wordIndexes: [0], wordIndexesTruncated: false })
    expect(output.ontologyClasses[0].parentNames).toHaveLength(100)
    expect(output.ontologyClasses[0].synonymNames).toHaveLength(100)
    expect(output.truncated).toBe(true)
  })

  it('normalizes missing optional fields without raw provider dumps', () => {
    expect(normalizeVisionAnalysis({})).toMatchObject({
      labels: [],
      errors: [],
      modelVersions: { classification: null },
      truncated: false,
    })
    expect(normalizeVisionJob({ ...job, freeformTags: { privateExtra: 'omit' } })).toMatchObject({
      lifecycleDetails: null,
      percentComplete: null,
    })
    expect(normalizeVisionJob(job)).not.toHaveProperty('freeformTags')
  })
})
