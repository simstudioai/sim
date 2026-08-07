export const COPILOT_CONTEXT_MODEL_TEXT_KEYS = [
  'content',
  'description',
  'fileName',
  'label',
  'tableName',
  'tag',
  'text',
  'title',
] as const

export const COPILOT_CONTEXT_ROUTING_KEYS = ['path', 'uri', 'url'] as const

export const COPILOT_MESSAGE_DISPLAY_KEYS = [
  'fileName',
  'label',
  'tableName',
  'text',
  'title',
] as const

export const COPILOT_VFS_MODEL_TEXT_KEYS = [
  'description',
  'displayName',
  'email',
  'name',
  'prompt',
  'sourceTaskName',
  'title',
] as const

export const COPILOT_VFS_ROUTING_KEYS = ['folderPath', 'path', 'url'] as const

export const COPILOT_USER_METADATA_MODEL_TEXT_KEYS = ['email', 'name'] as const

export const COPILOT_DESKTOP_MODEL_TEXT_KEYS = ['running'] as const

export function isCopilotModelTextKey(keys: readonly string[], key: string): boolean {
  return keys.includes(key)
}
