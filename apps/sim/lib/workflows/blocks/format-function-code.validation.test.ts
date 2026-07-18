/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'
import { formatFunctionCode } from '@/lib/workflows/blocks/format-function-code'

const { mockFormatJavaScript, mockFormatPython } = vi.hoisted(() => ({
  mockFormatJavaScript: vi.fn(),
  mockFormatPython: vi.fn(),
}))

vi.mock('prettier', () => ({ format: mockFormatJavaScript }))
vi.mock('@wasm-fmt/ruff_fmt/node', () => ({ format: mockFormatPython }))

describe('formatFunctionCode validation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('keeps JavaScript unchanged when formatting changes its syntax tree', async () => {
    mockFormatJavaScript.mockResolvedValue('return 2;\n')

    await expect(formatFunctionCode('return 1;', CodeLanguage.JavaScript)).resolves.toEqual({
      code: 'return 1;',
      changed: false,
      error: expect.stringContaining('syntax'),
    })
  })

  it('keeps JavaScript unchanged when a second formatting pass is not identical', async () => {
    mockFormatJavaScript
      .mockResolvedValueOnce('return 1;\n')
      .mockResolvedValueOnce('return 1; // changed again\n')

    await expect(formatFunctionCode('return 1', CodeLanguage.JavaScript)).resolves.toEqual({
      code: 'return 1',
      changed: false,
      error: expect.stringContaining('stable'),
    })
  })

  it('accepts JavaScript only after an identical second formatting pass', async () => {
    mockFormatJavaScript.mockResolvedValue('return 1;\n')

    await expect(formatFunctionCode('return 1', CodeLanguage.JavaScript)).resolves.toEqual({
      code: 'return 1;',
      changed: true,
      error: null,
    })
    expect(mockFormatJavaScript).toHaveBeenCalledTimes(2)
  })

  it('keeps Python unchanged when formatting loses a Sim reference', async () => {
    mockFormatPython.mockImplementation((code: string) => code.replace(/_0_+/, 'missing_reference'))
    const code = 'value=<start.value>\nreturn value'

    await expect(formatFunctionCode(code, CodeLanguage.Python)).resolves.toEqual({
      code,
      changed: false,
      error: expect.stringContaining('references'),
    })
  })

  it('keeps Python unchanged when formatting reorders Sim references', async () => {
    mockFormatPython.mockImplementation((formattedCode: string) => {
      const [firstToken, secondToken] = formattedCode.match(/_[01]_+/g) ?? []
      if (!firstToken || !secondToken) throw new Error('Expected two protected Sim references')
      return formattedCode
        .replaceAll(firstToken, '__sim_swap__')
        .replaceAll(secondToken, firstToken)
        .replaceAll('__sim_swap__', secondToken)
    })
    const code = 'first=<a.value>\nsecond=<b.value>\nreturn first,second'

    await expect(formatFunctionCode(code, CodeLanguage.Python)).resolves.toEqual({
      code,
      changed: false,
      error: expect.stringContaining('references'),
    })
  })

  it('keeps Python unchanged when a second formatting pass is not identical', async () => {
    mockFormatPython
      .mockReturnValueOnce('def __sim_format_function__():\n    value = 1\n    return value\n')
      .mockReturnValueOnce('def __sim_format_function__():\n    value = 2\n    return value\n')
    const code = 'value=1\nreturn value'

    await expect(formatFunctionCode(code, CodeLanguage.Python)).resolves.toEqual({
      code,
      changed: false,
      error: expect.stringContaining('stable'),
    })
  })
})
