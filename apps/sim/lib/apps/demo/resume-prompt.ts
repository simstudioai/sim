export const FULLSTACK_CREDENTIAL_RESUME_MESSAGE = 'Continue with the selected connected accounts.'

export function findOriginalBuilderPrompt(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || typeof message !== 'object') continue
    const record = message as Record<string, unknown>
    if (record.role !== 'user' || typeof record.content !== 'string') continue
    const content = record.content.trim()
    if (!content || content === FULLSTACK_CREDENTIAL_RESUME_MESSAGE) continue
    return content
  }
  return null
}
