/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { quiverImageToSvgTool, quiverImageToSvgV2Tool } from '@/tools/quiver/image_to_svg'
import { quiverTextToSvgTool, quiverTextToSvgV2Tool } from '@/tools/quiver/text_to_svg'

describe('Quiver operation declarations', () => {
  it.each([
    quiverTextToSvgTool,
    quiverImageToSvgTool,
    quiverTextToSvgV2Tool,
    quiverImageToSvgV2Tool,
  ])('$id has typed operation input without HTTP metadata', (tool) => {
    expect(tool.operation.input).toBeTypeOf('function')
    expect('request' in tool).toBe(false)
  })

  it.each([
    [quiverTextToSvgTool, quiverTextToSvgV2Tool],
    [quiverImageToSvgTool, quiverImageToSvgV2Tool],
  ])('versions the file response without changing provider inputs', (legacy, current) => {
    expect(current.id).toBe(`${legacy.id}_v2`)
    expect(current.version).toBe('2.0.0')
    expect(current.operation).toBe(legacy.operation)
    expect(current.params).toBe(legacy.params)
    expect(legacy.outputs?.file).toBeUndefined()
    expect(legacy.outputs?.output.properties?.file.type).toBe('file')
    expect(current.outputs?.file.type).toBe('file')
    expect(current.outputs?.files.type).toBe('file[]')
    expect(current.outputs).not.toHaveProperty('svgContent')
    expect(legacy.outputs?.output.properties?.svgContent.type).toBe('string')
    expect(current.outputs?.output).toBeUndefined()
  })

  it('preserves text projection and private reference paths', () => {
    const modelInput = quiverTextToSvgTool.operation.modelInput
    if (modelInput?.mode !== 'project' || !modelInput.privateInputPaths) {
      throw new Error('Quiver text model-input projection is missing')
    }
    const params = {
      apiKey: 'secret',
      model: 'arrow-preview',
      prompt: 'A compass',
      instructions: 'Minimal',
      references: 'data:image/png;base64,{{PRIVATE_IMAGE}}',
    }

    expect(modelInput.select(params)).toEqual({ prompt: 'A compass', instructions: 'Minimal' })
    expect(modelInput.privateInputPaths(params)).toEqual([['references']])
  })

  it('preserves image-only private provenance selection', () => {
    const modelInput = quiverImageToSvgTool.operation.modelInput
    if (modelInput?.mode !== 'private-provenance') {
      throw new Error('Quiver image private provenance is missing')
    }

    expect(
      modelInput.inputPaths({
        apiKey: 'secret',
        model: 'arrow-preview',
        image: 'data:image/png;base64,{{PRIVATE_IMAGE}}',
      })
    ).toEqual([['image']])
    expect(
      modelInput.inputPaths({
        apiKey: 'secret',
        model: 'arrow-preview',
        image: JSON.stringify({ key: 'workspace/workspace-1/image.png' }),
      })
    ).toEqual([])
  })
})
