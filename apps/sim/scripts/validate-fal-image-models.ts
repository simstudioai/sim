/**
 * Checks the Image Generator's fal requests against live provider schemas without submitting jobs.
 * Run with bun apps/sim/scripts/validate-fal-image-models.ts.
 * FAL_IMAGE_SCHEMA_DIR can supply saved schemas named <endpoint with / replaced by __>.json.
 * FAL_IMAGE_REPORT_PATH saves a repeatable per-model validation report.
 */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import Ajv from 'ajv/dist/2020'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { buildImageGenerationRequest } from '@/lib/internal/image/request'
import { imageGenerationInputSchema } from '@/lib/internal/image/schema'
import { imageModels } from '@/lib/media/image-catalog'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { ImageGeneratorV2Block } from '@/blocks/blocks/image_generator'
import { imageGenerateTool } from '@/tools/image/generate'

const logger = createLogger('ValidateFalImageModels')
interface Schema {
  $ref?: string
  properties?: Record<string, Schema>
  items?: Schema
  allOf?: Schema[]
  anyOf?: Schema[]
}
interface ApiSchema {
  components: { schemas: Record<string, Schema> }
  paths: Record<
    string,
    {
      post?: { requestBody: { content: { 'application/json': { schema: Schema } } } }
      get?: { responses: { '200': { content: { 'application/json': { schema: Schema } } } } }
    }
  >
}
async function loadSchema(endpoint: string): Promise<ApiSchema> {
  if (process.env.FAL_IMAGE_SCHEMA_DIR) {
    return JSON.parse(
      await readFile(
        join(process.env.FAL_IMAGE_SCHEMA_DIR, `${endpoint.replaceAll('/', '__')}.json`),
        'utf8'
      )
    )
  }
  const url = new URL('https://fal.ai/api/openapi/queue/openapi.json')
  url.searchParams.set('endpoint_id', endpoint)
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`fal schema returned HTTP ${response.status}`)
  return readResponseJsonWithLimit<ApiSchema>(response, {
    maxBytes: 4 * 1024 * 1024,
    label: 'fal image schema',
  })
}

const results = []
for (const model of imageModels.filter((item) => item.provider === 'falai')) {
  const started = Date.now()
  try {
    assert(model.endpoint)
    const api = await loadSchema(model.endpoint)
    const resolve = (schema: Schema): Schema =>
      schema.$ref ? resolve(api.components.schemas[schema.$ref.split('/').pop() ?? '']) : schema
    const path = `/${model.endpoint}`
    const input = api.paths[path]?.post?.requestBody.content['application/json'].schema
    const output =
      api.paths[`${path}/requests/{request_id}`]?.get?.responses['200'].content['application/json']
        .schema
    assert(input && output && model.output)
    const file = resolve(output).properties?.[model.output]
    assert(file)
    const image = model.output === 'images' ? resolve(file).items : file
    assert(image)
    function hasUrl(schema: Schema): boolean {
      const item = resolve(schema)
      return Boolean(item.properties?.url) || (item.allOf ?? item.anyOf ?? []).some(hasUrl)
    }
    assert(hasUrl(image), 'Expected a downloadable image response')
    const validate = new Ajv({ strict: false, validateFormats: false, logger: false }).compile({
      ...resolve(input),
      components: api.components,
      additionalProperties: false,
    })
    const base = {
      provider: 'falai' as const,
      apiKey: 'schema-validation',
      model: model.id,
      prompt: 'A red kite above a meadow.',
    }
    const mapParams = ImageGeneratorV2Block.tools.config?.params
    assert(mapParams)
    let requests = 0
    const check = (settings: Record<string, unknown>, key?: string, value?: string) => {
      const mapped = mapParams({ ...base, ...settings })
      const toolInput = imageGenerateTool.operation.input({ ...base, ...mapped })
      const parsed = imageGenerationInputSchema.parse(toolInput)
      const request = buildImageGenerationRequest(parsed)
      assert.equal(request.endpoint, `https://queue.fal.run/${model.endpoint}`)
      assert(validate(request.body), JSON.stringify(validate.errors))
      if (key && value !== 'default') assert.equal(String(request.body[key]), value)
      assert.equal(request.body.prompt, base.prompt)
      requests++
    }
    check({})
    for (const field of ImageGeneratorV2Block.subBlocks) {
      if (!evaluateSubBlockCondition(field.condition, base)) continue
      const option = model.options?.[field.id as keyof NonNullable<typeof model.options>]
      const wireKey = option?.field ?? model.booleans?.[field.id]
      if (!wireKey) continue
      const options =
        field.type === 'switch'
          ? [{ id: 'true' }, { id: 'false' }]
          : typeof field.options === 'function'
            ? field.options({ values: base })
            : field.options
      assert(options?.length)
      for (const value of options) check({ [field.id]: value.id }, wireKey, value.id)
    }
    if (model.seed) check({ seed: 42 }, 'seed', '42')
    results.push({
      endpoint: model.endpoint,
      passed: true,
      requests,
      durationMs: Date.now() - started,
    })
  } catch (error) {
    results.push({
      endpoint: model.endpoint,
      passed: false,
      error: getErrorMessage(error),
      durationMs: Date.now() - started,
    })
  }
}
if (process.env.FAL_IMAGE_REPORT_PATH)
  await writeFile(process.env.FAL_IMAGE_REPORT_PATH, JSON.stringify(results, null, 2))
const failures = results.filter((item) => !item.passed)
if (failures.length) {
  logger.error('Image model validation failed', { failures })
  process.exitCode = 1
} else {
  logger.info('All fal image models verified', {
    models: results.length,
    requests: results.reduce((count, item) => count + (item.requests ?? 0), 0),
  })
}
