/**
 * Shared rendering types for the block card, copied from the renderer package. They describe the
 * visual state a view needs, resolved by the container and passed in as props.
 */

/** Execution outcome of a block on its run path. */
export type BlockRunStatus = 'success' | 'error' | undefined

/** Syntax languages supported by canvas code previews. */
export type CodePreviewLanguage = 'javascript' | 'json' | 'python' | 'bash'

/** Rich preview payload for a code value on the card. */
export interface CodePreview {
  code: string
  language: CodePreviewLanguage
}
