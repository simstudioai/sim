import type { ToolConfig } from '@/tools/types'

const HOSTED_API_KEY_NOTE = '<note>API key is hosted by Sim.</note>'

export function getCopilotToolDescription(
  tool: Pick<ToolConfig, 'description' | 'hosting' | 'name'>,
  options?: {
    isHosted?: boolean
    fallbackName?: string
  }
): string {
  const baseDescription = tool.description || tool.name || options?.fallbackName || ''

  if (!options?.isHosted || !tool.hosting) {
    return baseDescription
  }

  if (baseDescription.includes(HOSTED_API_KEY_NOTE)) {
    return baseDescription
  }

  return baseDescription
    ? `${baseDescription} ${HOSTED_API_KEY_NOTE}`
    : HOSTED_API_KEY_NOTE
}
