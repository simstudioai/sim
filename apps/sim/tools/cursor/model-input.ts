type CursorPromptTextField = 'promptText' | 'followupPromptText'

interface CursorPromptModelInputParams {
  promptImages?: unknown
  promptText?: unknown
  followupPromptText?: unknown
}

function parseCursorPromptImages(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return []
  }
}

/** Selects the rewritable Cursor prompt text. */
export function selectCursorPromptModelInput(
  params: CursorPromptModelInputParams,
  textField: CursorPromptTextField
): Record<string, unknown> {
  return { [textField]: params[textField] }
}

/** Selects the effective image payload exactly as Cursor's request formatter will send it. */
export function selectCursorPromptOpaqueModelInputPaths(
  params: CursorPromptModelInputParams
): readonly (readonly string[])[] {
  const parsed = parseCursorPromptImages(params.promptImages)
  if (parsed === undefined || (Array.isArray(parsed) && parsed.length === 0)) return []
  return [['promptImages']]
}
