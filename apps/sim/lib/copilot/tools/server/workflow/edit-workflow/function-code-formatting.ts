import { isRecordLike } from '@sim/utils/object'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/execution/languages'
import {
  type FormattableCodeLanguage,
  formatFunctionCode,
  isFormattableCodeLanguage,
} from '@/lib/workflows/blocks/format-function-code'

interface FunctionCodeField {
  code: string
  codeSubBlock: Record<string, unknown>
  language: string
}

export interface ChangedFunctionCodeFormatResult {
  changedBlockIds: string[]
  errors: Array<{
    blockId: string
    language: FormattableCodeLanguage
    error: string
  }>
}

function createEmptyFormatResult(): ChangedFunctionCodeFormatResult {
  return { changedBlockIds: [], errors: [] }
}

function readFunctionCodeField(block: unknown): FunctionCodeField | undefined {
  if (!isRecordLike(block) || block.type !== 'function' || !isRecordLike(block.subBlocks)) {
    return undefined
  }

  const codeSubBlock = block.subBlocks.code
  if (!isRecordLike(codeSubBlock) || typeof codeSubBlock.value !== 'string') return undefined

  const languageSubBlock = block.subBlocks.language
  const language =
    isRecordLike(languageSubBlock) && typeof languageSubBlock.value === 'string'
      ? languageSubBlock.value
      : DEFAULT_CODE_LANGUAGE

  return { code: codeSubBlock.value, codeSubBlock, language }
}

/**
 * Formats changed JavaScript and Python Function code after the workflow engine resolves operation
 * ordering, nested block identity, and the final code language.
 */
export async function formatChangedFunctionCode(
  functionCodeBlockIds: ReadonlySet<string>,
  modifiedWorkflowState: unknown
): Promise<ChangedFunctionCodeFormatResult> {
  if (functionCodeBlockIds.size === 0) return createEmptyFormatResult()
  if (!isRecordLike(modifiedWorkflowState) || !isRecordLike(modifiedWorkflowState.blocks)) {
    return createEmptyFormatResult()
  }

  const blocks = modifiedWorkflowState.blocks
  const targets = [...functionCodeBlockIds].flatMap((blockId) => {
    const currentField = readFunctionCodeField(blocks[blockId])
    if (!currentField || !isFormattableCodeLanguage(currentField.language)) return []
    return [{ blockId, ...currentField, language: currentField.language }]
  })

  const results = await Promise.all(
    targets.map(async ({ blockId, code, codeSubBlock, language }) => {
      const result = await formatFunctionCode(code, language)
      if (result.changed) codeSubBlock.value = result.code
      return { blockId, language, result }
    })
  )

  return {
    changedBlockIds: results.filter(({ result }) => result.changed).map(({ blockId }) => blockId),
    errors: results.flatMap(({ blockId, language, result }) =>
      result.error ? [{ blockId, language, error: result.error }] : []
    ),
  }
}
