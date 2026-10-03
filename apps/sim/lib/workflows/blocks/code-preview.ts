import type { CodePreview, CodePreviewLanguage } from '@sim/workflow-renderer'
import type { SubBlockConfig } from '@/blocks/types'

/** Maps stored editor languages to the Prism grammar used by the shared viewer. */
function resolveCodePreviewLanguage(language: unknown): CodePreviewLanguage {
  switch (language) {
    case 'json':
    case 'python':
    case 'javascript':
      return language
    case 'shell':
      return 'bash'
    default:
      return 'javascript'
  }
}

/** Builds a rich preview only for safe, non-empty code fields on the canvas. */
export function resolveCanvasCodePreview(
  subBlock: SubBlockConfig | undefined,
  rawValue: unknown,
  values: Readonly<Record<string, unknown>>
): CodePreview | undefined {
  if (
    subBlock?.type !== 'code' ||
    subBlock.password === true ||
    typeof rawValue !== 'string' ||
    rawValue.trim().length === 0
  ) {
    return undefined
  }

  const language =
    typeof values.language === 'string' && values.language.length > 0
      ? values.language
      : subBlock.language
  return { code: rawValue, language: resolveCodePreviewLanguage(language) }
}
