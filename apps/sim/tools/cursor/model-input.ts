type CursorPromptTextField = 'promptText' | 'followupPromptText'

interface CursorPromptModelInputParams {
  promptImages?: unknown
  promptText?: unknown
  followupPromptText?: unknown
}

function parseEffectiveCursorPromptImages(value: unknown): unknown | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.length === 0 ? undefined : parsed
  } catch {
    return undefined
  }
}

/** Selects prompt text for projection and effective image payloads for byte-preserving validation. */
export function selectCursorPromptModelInput(
  params: CursorPromptModelInputParams,
  textField: CursorPromptTextField
): Record<string, unknown> {
  const promptImages = parseEffectiveCursorPromptImages(params.promptImages)
  return {
    [textField]: params[textField],
    ...(promptImages === undefined ? {} : { promptImages }),
  }
}

/** Reapplies projected prompt text while preserving an unchanged serialized image payload. */
export function applyProjectedCursorPromptModelInput(
  selectedParams: CursorPromptModelInputParams,
  projectedSelection: Record<string, unknown>,
  textField: CursorPromptTextField
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    [textField]: projectedSelection[textField],
  }
  if (!Object.hasOwn(selectedParams, 'promptImages')) return patch

  const originalImages = parseEffectiveCursorPromptImages(selectedParams.promptImages)
  if (
    originalImages === undefined ||
    !Object.hasOwn(projectedSelection, 'promptImages') ||
    JSON.stringify(originalImages) !== JSON.stringify(projectedSelection.promptImages)
  ) {
    throw new Error('Cursor prompt image payloads cannot be safely projected')
  }

  patch.promptImages = selectedParams.promptImages
  return patch
}
