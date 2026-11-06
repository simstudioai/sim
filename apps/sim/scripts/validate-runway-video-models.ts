/**
 * Validates every Runway picker option through the block and tool request path against
 * the live OpenAPI document without creating generation jobs. RUNWAY_SCHEMA_PATH can
 * select a saved document; RUNWAY_REPORT_PATH saves per-model, per-mode results.
 */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import Ajv from 'ajv/dist/2020'
import { videoToolBodySchema } from '@/lib/api/contracts/tools/media/video'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { buildDirectVideoRequest } from '@/lib/internal/video/direct-request'
import { directVideoModels } from '@/lib/media/direct-video-catalog'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { VideoGeneratorV3Block } from '@/blocks/blocks/video_generator'
import { runwayVideoTool } from '@/tools/video/runway'

interface ModelSchema {
  title: string
  properties: Record<string, unknown>
}
interface OpenApi {
  paths: Record<
    string,
    {
      post: {
        requestBody: {
          content: {
            'application/json': { schema: { oneOf: ModelSchema[] } }
          }
        }
      }
    }
  >
}

const logger = createLogger('ValidateRunwayVideoModels')
const api: OpenApi = process.env.RUNWAY_SCHEMA_PATH
  ? JSON.parse(await readFile(process.env.RUNWAY_SCHEMA_PATH, 'utf8'))
  : await (async () => {
      const response = await fetch('https://docs.dev.runwayml.com/openapi.json', {
        signal: AbortSignal.timeout(30_000),
      })
      assert(response.ok, `Runway schema returned ${response.status}`)
      return readResponseJsonWithLimit<OpenApi>(response, {
        maxBytes: 4 * 1024 * 1024,
        label: 'Runway schema',
      })
    })()
const params = VideoGeneratorV3Block.tools.config?.params
assert(params)
const results = []
for (const mode of ['text', 'image'] as const) {
  const path = `/v1/${mode}_to_video`
  const schemas = api.paths[path].post.requestBody.content['application/json'].schema.oneOf
  const models = directVideoModels.filter((model) => model.provider === 'runway' && model[mode])
  assert.deepEqual(
    new Set(models.map((model) => model.id)),
    new Set(schemas.map((schema) => schema.title))
  )
  for (const model of models) {
    const started = performance.now()
    let requests = 0
    try {
      const schema = schemas.find((item) => item.title === model.id)
      assert(schema)
      const validate = new Ajv({ strict: false, validateFormats: false, logger: false }).compile(
        schema
      )
      const base = {
        provider: 'runway' as const,
        apiKey: 'schema-validation',
        model: model.id,
        prompt: 'A red kite rises above a meadow.',
        ...(mode === 'image' && {
          visualReference: {
            id: '',
            key: 'schema-validation/reference.png',
            name: 'reference.png',
            type: 'image/png',
            size: 8,
            url: '',
          },
        }),
      }
      const check = (settings: Record<string, unknown>) => {
        const mapped = params({ ...base, ...settings })
        const input = videoToolBodySchema.parse(
          runwayVideoTool.operation.input({ ...base, ...mapped })
        )
        const request = buildDirectVideoRequest({ ...input, provider: 'runway' })
        assert.equal(request.url, `https://api.dev.runwayml.com${path}`)
        if (mode === 'image') request.body.promptImage = 'data:image/png;base64,iVBORw0KGgo='
        assert(validate(request.body), JSON.stringify(validate.errors))
        assert.equal(request.body.model, model.id)
        const wireKeys: Record<string, string> = {
          prompt: 'promptText',
          duration: 'duration',
          aspectRatio: 'ratio',
          resolution: 'resolution',
          directGenerateAudio: 'audio',
        }
        for (const [field, value] of Object.entries(settings)) {
          if (value !== 'default')
            assert.equal(String(request.body[wireKeys[field]]), String(value), field)
        }
        requests++
      }
      check({})
      const promptSchema = schema.properties.promptText
      assert(isRecordLike(promptSchema) && typeof promptSchema.maxLength === 'number')
      const maxPromptLength = promptSchema.maxLength
      check({ prompt: 'a'.repeat(maxPromptLength) })
      assert.throws(
        () => buildDirectVideoRequest({ ...base, prompt: 'a'.repeat(maxPromptLength + 1) }),
        /Prompt must be between/
      )
      for (const field of VideoGeneratorV3Block.subBlocks) {
        if (
          !['duration', 'aspectRatio', 'resolution', 'directGenerateAudio'].includes(field.id) ||
          !evaluateSubBlockCondition(field.condition, base)
        )
          continue
        const options =
          typeof field.options === 'function' ? field.options({ values: base }) : field.options
        assert(options?.length, `Empty ${field.id} options`)
        for (const option of options) check({ [field.id]: option.id })
      }
      results.push({
        model: model.id,
        mode,
        passed: true,
        requests,
        durationMs: Math.round(performance.now() - started),
      })
    } catch (error) {
      results.push({
        model: model.id,
        mode,
        passed: false,
        requests,
        error: getErrorMessage(error),
        durationMs: Math.round(performance.now() - started),
      })
    }
  }
}
if (process.env.RUNWAY_REPORT_PATH)
  await writeFile(process.env.RUNWAY_REPORT_PATH, JSON.stringify(results, null, 2))
const failures = results.filter((result) => !result.passed)
logger.info('Runway schema validation complete', {
  variants: results.length,
  requests: results.reduce((sum, result) => sum + result.requests, 0),
  failures,
})
if (failures.length) process.exitCode = 1
