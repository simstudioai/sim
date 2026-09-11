/**
 * @vitest-environment node
 */
import { createExecutorContext, createSerializedBlock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileManageWriteBodySchema } from '@/lib/api/contracts/tools/file'
import { FileV5Block } from '@/blocks/blocks/file'
import { getBlock } from '@/blocks/index'
import { GenericBlockHandler } from '@/executor/handlers/generic/generic-handler'
import { executeTool } from '@/tools'
import { fileWriteTool } from '@/tools/file/write'
import { getTool } from '@/tools/utils'

vi.mock('@/blocks/index', () => ({ getBlock: vi.fn() }))
vi.mock('@/tools', () => ({ executeTool: vi.fn() }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))

const generatedFile = {
  id: 'generated-file',
  name: 'report.xlsx',
  url: 'https://example.com/report.xlsx',
  size: 16978,
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

async function executeWrite(inputs: Record<string, unknown>) {
  const handler = new GenericBlockHandler()
  await handler.execute(
    createExecutorContext(),
    createSerializedBlock({ type: 'file_v5', tool: 'file_write' }),
    { operation: 'file_write', fileName: 'report.xlsx', ...inputs }
  )
  const [, params] = vi.mocked(executeTool).mock.calls[0]
  return fileManageWriteBodySchema.safeParse(fileWriteTool.operation.input(params))
}

describe('File Write executor inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBlock).mockReturnValue(FileV5Block)
    vi.mocked(getTool).mockReturnValue(fileWriteTool)
    vi.mocked(executeTool).mockResolvedValue({ success: true, output: {} })
  })

  it.each([
    ['empty', { content: '' }],
    ['null', { content: null }],
    ['omitted', {}],
  ])('clears %s Content when storing a generated file', async (_label, contentInput) => {
    const result = await executeWrite({ ...contentInput, writeFileInput: generatedFile })

    expect(result.success).toBe(true)
    if (!result.success) throw result.error
    expect(result.data.content).toBeUndefined()
    expect(result.data.fileInput).toEqual(generatedFile)
  })

  it.each(['text', '   '])('rejects file and populated Content %j', async (content) => {
    const result = await executeWrite({ content, writeFileInput: generatedFile })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected conflicting inputs to fail validation')
    expect(result.error.issues).toEqual([
      expect.objectContaining({
        path: ['content'],
        message:
          'Provide exactly one of content (text to write) or fileInput (an existing file to store).',
      }),
    ])
  })

  it.each([0, false, { text: 'invalid' }, ['invalid']])(
    'rejects non-string Content %j alongside a file',
    async (content) => {
      const result = await executeWrite({ content, writeFileInput: generatedFile })

      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected malformed Content to fail validation')
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['content'], code: 'invalid_type' }),
        ])
      )
    }
  )

  it.each(['', 'text'])('preserves text-only Content %j', async (content) => {
    const result = await executeWrite({ content })

    expect(result.success).toBe(true)
    if (!result.success) throw result.error
    expect(result.data.content).toBe(content)
    expect(result.data.fileInput).toBeUndefined()
  })
})
