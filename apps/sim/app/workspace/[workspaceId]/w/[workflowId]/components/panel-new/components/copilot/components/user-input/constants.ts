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
  // { value: 'claude-4-sonnet', label: 'claude-4-sonnet' },
  { value: 'claude-4.5-sonnet', label: 'claude-4.5-sonnet' },
  { value: 'claude-4.5-haiku', label: 'claude-4.5-haiku' },
  { value: 'claude-4.1-opus', label: 'claude-4.1-opus' },
  // { value: 'gpt-5-fast', label: 'gpt-5-fast' },
  // { value: 'gpt-5', label: 'gpt-5' },
  { value: 'gpt-5-medium', label: 'gpt-5-medium' },
  // { value: 'gpt-5-high', label: 'gpt-5-high' },
  // { value: 'gpt-4o', label: 'gpt-4o' },
  // { value: 'gpt-4.1', label: 'gpt-4.1' },
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
