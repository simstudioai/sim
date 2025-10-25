/**
 * Constants for user input component
 */

/**
 * Mention menu options in order
 */
export const MENTION_OPTIONS = [
  'Chats',
  'Workflows',
  'Workflow Blocks',
  'Blocks',
  'Knowledge',
  'Docs',
  'Templates',
  'Logs',
] as const

/**
 * Model configuration options
 */
export const MODEL_OPTIONS = [
  { value: 'gpt-5-fast', label: 'gpt-5-fast' },
  { value: 'gpt-5', label: 'gpt-5' },
  { value: 'gpt-5-medium', label: 'gpt-5-medium' },
  { value: 'gpt-5-high', label: 'gpt-5-high' },
  { value: 'gpt-4o', label: 'gpt-4o' },
  { value: 'gpt-4.1', label: 'gpt-4.1' },
  { value: 'o3', label: 'o3' },
  { value: 'claude-4-sonnet', label: 'claude-4-sonnet' },
  { value: 'claude-4.5-haiku', label: 'claude-4.5-haiku' },
  { value: 'claude-4.5-sonnet', label: 'claude-4.5-sonnet' },
  { value: 'claude-4.1-opus', label: 'claude-4.1-opus' },
] as const

/**
 * Model categories for icon selection
 */
export const MODEL_CATEGORIES = {
  BRAIN_CIRCUIT: ['gpt-5-high', 'o3', 'claude-4.1-opus'],
  BRAIN: ['gpt-5', 'gpt-5-medium', 'claude-4-sonnet', 'claude-4.5-sonnet'],
  ZAP: ['gpt-4o', 'gpt-4.1', 'gpt-5-fast', 'claude-4.5-haiku'],
} as const

/**
 * Maximum textarea height in pixels
 */
export const MAX_TEXTAREA_HEIGHT = 120

/**
 * Mention menu maximum height in pixels
 */
export const MENTION_MENU_MAX_HEIGHT = 360

/**
 * Threshold for considering input "near top" of viewport (in pixels)
 */
export const NEAR_TOP_THRESHOLD = 300

/**
 * Mention menu width configurations
 */
export const MENTION_MENU_WIDTHS = {
  BLOCKS: 320,
  EXPANDED: 384,
  DEFAULT: 224,
} as const

/**
 * Mention menu margins and spacing
 */
export const MENTION_MENU_MARGINS = {
  VIEWPORT: 8,
  SCROLL_TOLERANCE: 8,
  PORTAL_OFFSET: 4,
} as const
