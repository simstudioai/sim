/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { visionTool, visionToolV2 } from '@/tools/vision/tool'

describe('Vision operation declarations', () => {
  it.each([visionTool, visionToolV2])('$id has operation input and no HTTP metadata', (tool) => {
    expect(tool.operation.input).toBeTypeOf('function')
    expect('request' in tool).toBe(false)
  })

  it('preserves opaque inline-image provenance paths', () => {
    const modelInput = visionTool.operation.modelInput
    if (modelInput?.mode !== 'project' || !modelInput.privateInputPaths) {
      throw new Error('Vision model input projection is missing')
    }

    expect(
      modelInput.privateInputPaths({
        apiKey: 'secret',
        imageFile: {
          id: 'file-1',
          key: 'workspace/workspace-1/image.png',
          name: 'image.png',
          size: 3,
          type: 'image/png',
          base64: '{{PRIVATE_IMAGE}}',
        },
      })
    ).toEqual([['imageFile', 'base64']])
    expect(
      modelInput.privateInputPaths({
        apiKey: 'secret',
        imageUrl: 'data:image/png;base64,{{PRIVATE_IMAGE}}',
      })
    ).toEqual([['imageUrl']])
    expect(
      modelInput.privateInputPaths({
        apiKey: 'secret',
        imageUrl: 'https://images.example.com/image.png',
      })
    ).toEqual([])
  })

  it('keeps v2 input file-only and provider-compatible', () => {
    const input = visionToolV2.operation.input({
      apiKey: 'secret',
      imageFile: {
        id: 'file-1',
        key: 'workspace/workspace-1/image.png',
        name: 'image.png',
        size: 3,
        type: 'image/png',
      },
    })

    expect(input).toEqual({
      apiKey: 'secret',
      imageFile: expect.objectContaining({ key: 'workspace/workspace-1/image.png' }),
      model: 'gpt-5.2',
      prompt: null,
    })
    expect(input).not.toHaveProperty('imageUrl')
  })
})
