/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import {
  applyProjectedModelVisibleFileNames,
  selectModelBoundFileInputPaths,
  selectModelVisibleFileNames,
  selectPreferredModelBoundFileInputPaths,
} from '@/lib/uploads/utils/model-input'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { a2aSendMessageTool } from '@/tools/a2a/send_message'
import { prepareToolRequest } from '@/tools/request-transport'
import { visionTool } from '@/tools/vision/tool'

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

  it('omits a path-first locator without selecting the unused upload', () => {
    expect(
      selectPreferredModelBoundFileInputPaths({
        file: { key: 'unused-key', metadata: 'unused-secret' },
        filePath: '  https://example.com/effective.pdf  ',
        fileInputPath: ['file'],
        filePathInputPath: ['filePath'],
        prefer: 'path',
      })
    ).toEqual([])
  })

  it('mirrors file-first request precedence without selecting the unused path', () => {
    expect(
      selectPreferredModelBoundFileInputPaths({
        file: { key: 'effective-key', metadata: 'unused-secret' },
        filePath: 'https://example.com/unused.pdf',
        fileInputPath: ['file'],
        filePathInputPath: ['filePath'],
        prefer: 'file',
      })
    ).toEqual([])
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

  it('projects file names without rewriting locators or inline content', () => {
    const original = [
      {
        key: 'workspace/ws-1/report.pdf',
        url: 'https://storage.example/report.pdf?signature=private',
        base64: 'raw-inline-content',
        name: 'private-name.pdf',
      },
    ]

    expect(selectModelVisibleFileNames(original)).toEqual([{ name: 'private-name.pdf' }])
    expect(applyProjectedModelVisibleFileNames(original, [{ name: '{{FILE_NAME}}' }])).toEqual([
      {
        key: 'workspace/ws-1/report.pdf',
        url: 'https://storage.example/report.pdf?signature=private',
        base64: 'raw-inline-content',
        name: '{{FILE_NAME}}',
      },
    ])
  })

  it('treats an optional undefined file name as absent', () => {
    const original = [{ key: 'workspace/ws-1/report.pdf', name: undefined }]

    expect(selectModelVisibleFileNames(original)).toEqual([{}])
    expect(applyProjectedModelVisibleFileNames(original, [{}])).toEqual(original)
  })

  it('preserves an optional undefined file name through tool request projection', () => {
    const prepared = prepareToolRequest(
      a2aSendMessageTool,
      {
        agentUrl: 'https://agent.example',
        message: 'Summarize the attachment',
        files: [{ key: 'workspace/ws-1/report.pdf', name: undefined }],
      },
      new ResolvedSecretTraceRegistry()
    )

    expect(JSON.parse(prepared.body ?? '{}')).toEqual({
      agentUrl: 'https://agent.example',
      message: 'Summarize the attachment',
      files: [{ key: 'workspace/ws-1/report.pdf' }],
    })
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

    const prepared = prepareToolRequest(
      visionTool,
      { apiKey: 'key', imageUrl: locator, prompt: 'Describe this image' },
      registry
    )
    const payload = JSON.parse(prepared.body ?? '{}') as Record<string, unknown>

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

    const prepared = prepareToolRequest(
      visionTool,
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
    const payload = JSON.parse(prepared.body ?? '{}') as Record<string, unknown>

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

  it('keeps headerless legacy file requests unchanged', () => {
    const locator = 'https://files.example/legacy.png'
    const prepared = prepareToolRequest(visionTool, {
      apiKey: 'key',
      imageUrl: locator,
      prompt: 'Describe this image',
    })
    const payload = JSON.parse(prepared.body ?? '{}') as Record<string, unknown>

    expect(payload.imageUrl).toBe(locator)
    expect(payload).not.toHaveProperty(RESOLVED_SECRET_PROVENANCE_FIELD)
    expect(
      validateOpaqueModelInputProvenance({
        headers: prepared.headers,
        payload,
        isInternalRequest: true,
      })
    ).toEqual({ success: true })
  })
})
