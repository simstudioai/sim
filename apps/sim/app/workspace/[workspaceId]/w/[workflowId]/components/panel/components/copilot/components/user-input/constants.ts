/**
 * Constants for user input component
 */

/**
 * Mention menu options in order (matches visual render order)
 */
export const MENTION_OPTIONS = [
  'Chats',
  'Workflows',
  'Knowledge',
  'Blocks',
  'Workflow Blocks',
  'Templates',
  'Logs',
  'Docs',
] as const

/**
 * Model configuration options
 */
export const MODEL_OPTIONS = [
  // { value: 'claude-4-sonnet', label: 'Claude 4 Sonnet' },
  { value: 'claude-4.5-sonnet', label: 'Claude 4.5 Sonnet' },
  { value: 'claude-4.5-haiku', label: 'Claude 4.5 Haiku' },
  { value: 'claude-4.1-opus', label: 'Claude 4.1 Opus' },
  // { value: 'gpt-5-fast', label: 'GPT 5 Fast' },
  // { value: 'gpt-5', label: 'GPT 5' },
  // { value: 'gpt-5.1-fast', label: 'GPT 5.1 Fast' },
  // { value: 'gpt-5.1', label: 'GPT 5.1' },
  { value: 'gpt-5.1-medium', label: 'GPT 5.1 Medium' },
  // { value: 'gpt-5.1-high', label: 'GPT 5.1 High' },
  // { value: 'gpt-5-codex', label: 'GPT 5 Codex' },
  { value: 'gpt-5.1-codex', label: 'GPT 5.1 Codex' },
  // { value: 'gpt-5-high', label: 'GPT 5 High' },
  // { value: 'gpt-4o', label: 'GPT 4o' },
  // { value: 'gpt-4.1', label: 'GPT 4.1' },
  { value: 'o3', label: 'o3' },
] as const

/**
 * Threshold for considering input "near top" of viewport (in pixels)
 */
export const NEAR_TOP_THRESHOLD = 300

/**
 * Scroll tolerance for mention menu positioning (in pixels)
 */
export const SCROLL_TOLERANCE = 8
