import { describe, expect, it } from 'vitest'
import {
  addModelInputProvenanceToRequest,
  createModelInputProvenanceRequestMetadata,
  markModelInputProjected,
  validateOpaqueModelInputProvenance,
} from '@/lib/execution/model-input-provenance'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { selectModelBoundFileInputPaths } from '@/lib/uploads/utils/model-input'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { projectToolModelInputParams } from '@/tools/request-transport'
import { visionTool } from '@/tools/vision/tool'

function prepareVisionOperation(
  params: Parameters<typeof visionTool.operation.input>[0],
  registry?: ResolvedSecretTraceRegistry
) {
  const projected = projectToolModelInputParams(visionTool, params, registry)
  const input = visionTool.operation.input(projected)
  const inputPaths = visionTool.operation.modelInput?.privateInputPaths?.(projected)
  const metadata = inputPaths
    ? createModelInputProvenanceRequestMetadata(registry, inputPaths)
    : undefined
  const headers = new Headers()
  const payload = addModelInputProvenanceToRequest(input, headers, metadata)
  if (metadata) markModelInputProjected(headers)
  return { headers, payload }
}

describe('model-bound file input selection', () => {
  it('omits internal storage keys and unrelated file metadata', () => {
    expect(
      selectModelBoundFileInputPaths(
        {
          key: 'effective-key',
          path: 'unused-path',
          url: 'unused-url',
          name: 'unused-name',
          metadata: { secret: 'unused-secret' },
        },
        ['file']
      )
    ).toEqual([])
  })

  it('selects an inline payload instead of its unused locator when the route uses base64', () => {
    expect(
      selectModelBoundFileInputPaths(
        {
          base64: 'effective-bytes',
          key: 'unused-key',
          path: 'unused-path',
          type: 'image/png',
          metadata: 'unused-secret',
        },
        ['file'],
        { includeInlineBase64: true }
      )
    ).toEqual([['file', 'base64']])
  })

  it('keeps only explicitly model-visible attachment metadata', () => {
    expect(
      selectModelBoundFileInputPaths(
        [
          {
            key: 'file-key',
            name: 'report.pdf',
            type: 'application/pdf',
            metadata: 'unused-secret',
          },
        ],
        ['files'],
        { includeName: true }
      )
    ).toEqual([['files', '0', 'name']])
  })

  it('omits serialized locators but retains an inline data URL', () => {
    expect(
      selectModelBoundFileInputPaths(
        JSON.stringify({
          key: 'effective-key',
          path: 'unused-path',
          metadata: 'unused-secret',
        }),
        ['file'],
        { parseSerializedFile: true }
      )
    ).toEqual([])

    expect(
      selectModelBoundFileInputPaths('https://example.com/image.png', ['file'], {
        parseSerializedFile: true,
      })
    ).toEqual([])

    expect(
      selectModelBoundFileInputPaths('data:image/png;base64,c2VjcmV0', ['file'], {
        parseSerializedFile: true,
      })
    ).toEqual([['file']])

    expect(
      selectModelBoundFileInputPaths(
        JSON.stringify([
          {
            key: 'workspace/ws-1/image.png',
            base64: 'c2VjcmV0',
          },
        ]),
        ['files'],
        { includeInlineBase64: true, parseSerializedFile: true }
      )
    ).toEqual([['files']])

    expect(
      selectModelBoundFileInputPaths({ url: 'data:image/png;base64,c2VjcmV0' }, ['file'])
    ).toEqual([['file', 'url']])
  })
})

describe('server-resolved model file provenance', () => {
  it('accepts a secret-backed URL locator without rewriting it', () => {
    const locator = 'https://files.example/document.png?token=resolved-locator-secret'
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'FILE_TOKEN',
        plaintext: 'resolved-locator-secret',
        encryptedValue: 'encrypted-file-token',
      },
    ])
    registry.recordResolvedAtInputPath('FILE_TOKEN', 'resolved-locator-secret', ['imageUrl'])
    registry.recordResolvedInputProjection(
      ['imageUrl'],
      locator,
      'https://files.example/document.png?token={{FILE_TOKEN}}'
    )

    const prepared = prepareVisionOperation(
      { apiKey: 'key', imageUrl: locator, prompt: 'Describe this image' },
      registry
    )
    const { payload } = prepared

    expect(payload.imageUrl).toBe(locator)
    expect(payload[RESOLVED_SECRET_PROVENANCE_FIELD]).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
    expect(
      validateOpaqueModelInputProvenance({
        headers: prepared.headers,
        payload,
        isInternalRequest: true,
      })
    ).toEqual({ success: true })
  })

  it('still rejects secret-bearing inline base64', () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'INLINE_BYTES',
        plaintext: 'resolved-inline-secret',
        encryptedValue: 'encrypted-inline-bytes',
      },
    ])
    registry.recordResolvedAtInputPath('INLINE_BYTES', 'resolved-inline-secret', [
      'imageFile',
      'base64',
    ])
    registry.recordResolvedInputProjection(
      ['imageFile', 'base64'],
      'resolved-inline-secret',
      '{{INLINE_BYTES}}'
    )

    const prepared = prepareVisionOperation(
      {
        apiKey: 'key',
        imageFile: {
          key: 'workspace/ws-1/image.png',
          name: 'image.png',
          size: 42,
          type: 'image/png',
          base64: 'resolved-inline-secret',
        },
        prompt: 'Describe this image',
      },
      registry
    )
    const { payload } = prepared

    expect(
      validateOpaqueModelInputProvenance({
        headers: prepared.headers,
        payload,
        isInternalRequest: true,
      })
    ).toEqual({
      success: false,
      error: 'Model input contains a resolved secret that cannot be safely projected',
      status: 400,
    })
  })
})
