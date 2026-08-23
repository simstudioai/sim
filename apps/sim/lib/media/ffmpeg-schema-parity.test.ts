/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TOOL_RUNTIME_SCHEMAS } from '@/lib/copilot/generated/tool-schemas-v1'
import { FFMPEG_LIMITS } from '@/lib/media/ffmpeg-limits'

/**
 * The ffmpeg bounds live twice: here, where the executor enforces them, and in
 * the Go tool catalog, where they become the JSON Schema the model reads and
 * Ajv checks at the router. Drift between the two is silent and user-visible —
 * the model is told one ceiling and the transcode refuses at another — so pin
 * the generated schema against the executor's own numbers.
 *
 * When this fails, change `ffmpeg.go` in the copilot repo and regenerate; do
 * not edit the generated schema.
 */
interface SchemaNode {
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  maxItems?: number
  minimum?: number
  maximum?: number
}

const ffmpegParameters = TOOL_RUNTIME_SCHEMAS.ffmpeg?.parameters as SchemaNode | undefined

describe('ffmpeg tool schema parity', () => {
  it('declares the tool in the generated catalog', () => {
    expect(ffmpegParameters?.properties).toBeDefined()
  })

  it('caps inputs.files at the executor limit', () => {
    expect(ffmpegParameters?.properties?.inputs?.properties?.files?.maxItems).toBe(
      FFMPEG_LIMITS.maxInputFiles
    )
  })

  it('bounds the scale dimensions at the executor limits', () => {
    for (const axis of ['width', 'height'] as const) {
      expect(ffmpegParameters?.properties?.[axis]?.minimum).toBe(FFMPEG_LIMITS.minScaleDimension)
      expect(ffmpegParameters?.properties?.[axis]?.maximum).toBe(FFMPEG_LIMITS.maxScaleDimension)
    }
  })

  it('does not offer sandbox-only fields on a tool that runs in this process', () => {
    const inputs = ffmpegParameters?.properties?.inputs?.properties
    expect(Object.keys(inputs ?? {})).toEqual(['files'])
    expect(inputs?.files?.items?.properties).toBeDefined()
    expect(Object.keys(inputs?.files?.items?.properties ?? {})).toEqual(['path'])

    const outputItem = ffmpegParameters?.properties?.outputs?.properties?.files?.items?.properties
    expect(Object.keys(outputItem ?? {}).sort()).toEqual(['mimeType', 'mode', 'path'])
  })
})
