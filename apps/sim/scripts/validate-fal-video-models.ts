/**
 * Checks every visible fal Video Generator option against its published queue schema, with and
 * without a start frame (which targets the model's image-to-video endpoint), without submitting jobs. Run with bun apps/sim/scripts/validate-fal-video-models.ts.
 * FAL_VIDEO_SCHEMA_DIR optionally supplies saved schemas named <endpoint with / replaced by __>.json.
 * FAL_VIDEO_REPORT_PATH optionally saves the per-model results.
 */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import Ajv from 'ajv/dist/2020'
import { videoToolBodySchema } from '@/lib/api/contracts/tools/media/video'
import { buildFalVideoRequest, getFalAIValidationError } from '@/lib/internal/video/fal-request'
import { falVideoModels, getFalVideoModel } from '@/lib/media/fal-video-catalog'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { VideoGeneratorV3Block } from '@/blocks/blocks/video_generator'
import { falaiVideoTool } from '@/tools/video/falai'

const logger = createLogger('ValidateFalVideoModels')
const block = VideoGeneratorV3Block
const picker = block.subBlocks.find(
  (field) =>
    field.id === 'model' && typeof field.condition === 'object' && field.condition.value === 'falai'
)
const options =
  typeof picker?.options === 'function'
    ? picker.options({ values: { provider: 'falai' } })
    : picker?.options
assert(Array.isArray(options))
const visible = options.filter((option) => !option.hidden)
assert.deepEqual(
  new Set(visible.map((option) => option.id)),
  new Set(falVideoModels.map((model) => model.modelId))
)

interface FalSchema {
  properties?: Record<string, FalSchema>
  examples?: unknown[]
  $ref?: string
  allOf?: FalSchema[]
  anyOf?: FalSchema[]
}

interface ModelSchema {
  components: { schemas: Record<string, FalSchema> }
  paths: Record<
    string,
    {
      post?: { requestBody: { content: { 'application/json': { schema: { $ref: string } } } } }
      get?: {
        responses: { '200': { content: { 'application/json': { schema: { $ref: string } } } } }
      }
    }
  >
}

async function loadSchema(endpoint: string): Promise<ModelSchema> {
  if (process.env.FAL_VIDEO_SCHEMA_DIR) {
    const file = join(process.env.FAL_VIDEO_SCHEMA_DIR, `${endpoint.replaceAll('/', '__')}.json`)
    return JSON.parse(await readFile(file, 'utf8'))
  }
  const url = new URL('https://fal.ai/api/openapi/queue/openapi.json')
  url.searchParams.set('endpoint_id', endpoint)
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`fal schema returned HTTP ${response.status}`)
  return response.json()
}

const startFrame = {
  id: 'schema-validation-frame',
  name: 'frame.png',
  url: '',
  size: 1024,
  type: 'image/png',
  key: 'workspace/schema-validation/frame.png',
}

async function checkModel(id: string, withImage: boolean) {
  const model = getFalVideoModel(id)
  assert(model)
  assert.equal(getFalVideoModel(model.endpoint), model)
  const endpoint = withImage ? model.image?.endpoint : model.endpoint
  assert(endpoint)
  const { paths, components } = await loadSchema(endpoint)
  const schemaAt = (ref?: string) => components.schemas[ref?.split('/').pop() ?? '']
  const path = `/${endpoint}`
  const input = schemaAt(paths[path]?.post?.requestBody.content['application/json'].schema.$ref)
  const output = schemaAt(
    paths[`${path}/requests/{request_id}`]?.get?.responses['200'].content['application/json'].schema
      .$ref
  )
  function isFile(schema: FalSchema): boolean {
    if (
      schema.properties?.url ||
      schema.examples?.some((example) => isRecordLike(example) && typeof example.url === 'string')
    )
      return true
    if (schema.$ref) return isFile(schemaAt(schema.$ref))
    return (schema.allOf ?? schema.anyOf ?? []).some(isFile)
  }
  assert(
    input && output?.properties?.video && isFile(output.properties.video),
    'Expected a text prompt and a video file response'
  )
  const validate = new Ajv({ strict: false, validateFormats: false, logger: false }).compile({
    ...input,
    components,
    additionalProperties: false,
  })
  const base = {
    provider: 'falai',
    model: id,
    apiKey: 'schema-validation',
    prompt: 'A red kite rises above a meadow.',
    ...(withImage ? { visualReference: startFrame } : {}),
  }
  const params = block.tools.config?.params
  if (!params) throw new Error('Video Generator must map block settings to tool parameters')
  const wireKeys: Record<string, string | undefined> = {
    duration: 'duration',
    resolution: 'resolution',
    aspectRatio: 'aspect_ratio',
    generateAudio: (withImage ? model.image : model)?.audioField,
    promptOptimizer: 'prompt_optimizer',
  }
  let count = 0
  const check = (settings: Record<string, unknown>, wireKey?: string, expected?: unknown) => {
    const toolInput = falaiVideoTool.operation.input({
      ...base,
      ...params({ ...base, ...settings }),
      provider: 'falai',
    })
    const parsed = videoToolBodySchema.parse(toolInput)
    const request = { ...parsed, provider: 'falai' } as const
    assert.equal(getFalAIValidationError(request), undefined)
    const { body, endpoint: requestEndpoint, imageField } = buildFalVideoRequest(request)
    assert.equal(requestEndpoint, endpoint)
    assert.equal(imageField, withImage ? model?.image?.imageField : undefined)
    if (withImage) {
      assert.deepEqual(parsed.visualReference, startFrame)
      if (imageField) body[imageField] = 'https://example.com/frame.png'
    }
    assert(validate(body), JSON.stringify(validate.errors))
    assert.equal(body.prompt, base.prompt)
    if (expected === 'default' && wireKey) assert(!Object.hasOwn(body, wireKey), wireKey)
    else if (wireKey) {
      const actual = body[wireKey]
      assert.equal(
        wireKey === 'duration' ? Number.parseFloat(String(actual)) : String(actual),
        wireKey === 'duration' ? Number(expected) : String(expected),
        wireKey
      )
    }
    count++
  }
  const startFrameField = block.subBlocks.find((field) => field.id === 'visualReferenceUpload')
  assert.equal(
    evaluateSubBlockCondition(startFrameField?.condition, base),
    Boolean(model.image),
    'Start frame field should show exactly when the model has an image-to-video endpoint'
  )
  check({})
  for (const field of block.subBlocks) {
    const key = field.id.replace(/^fal([A-Z])/, (_, initial: string) => initial.toLowerCase())
    if (!Object.hasOwn(wireKeys, key) || !evaluateSubBlockCondition(field.condition, base)) continue
    const wireKey = wireKeys[key]
    assert(wireKey, `Unexpected ${field.id} for ${id}`)
    const options =
      typeof field.options === 'function' ? field.options({ values: base }) : field.options
    const values = field.type === 'switch' ? [true, false] : options?.map((option) => option.id)
    assert(values?.length, `No choices for ${field.id}`)
    for (const value of values) check({ [field.id]: value }, wireKey, value)
  }
  return count
}

const results = []
for (const option of visible) {
  const variants = getFalVideoModel(option.id)?.image ? [false, true] : [false]
  for (const withImage of variants) {
    const model = withImage ? `${option.id} (start frame)` : option.id
    try {
      results.push({ model, passed: true, requests: await checkModel(option.id, withImage) })
    } catch (error) {
      results.push({ model, passed: false, error: getErrorMessage(error) })
    }
  }
}
if (process.env.FAL_VIDEO_REPORT_PATH) {
  await writeFile(process.env.FAL_VIDEO_REPORT_PATH, JSON.stringify(results, null, 2))
}
const failures = results.filter((result) => !result.passed)
if (failures.length) {
  logger.error('Model schema validation failed', { failures })
  process.exitCode = 1
} else {
  logger.info('All fal video models verified', {
    models: results.length,
    requests: results.reduce((n, result) => n + (result.requests ?? 0), 0),
  })
}
