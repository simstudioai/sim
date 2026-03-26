export interface CopilotLogContext {
  requestId?: string
  messageId?: string
}

/**
 * Appends copilot request identifiers to a log message.
 */
export function appendCopilotLogContext(message: string, context: CopilotLogContext = {}): string {
  const suffixParts: string[] = []

  if (context.requestId) {
    suffixParts.push(`requestId:${context.requestId}`)
  }

  if (context.messageId) {
    suffixParts.push(`messageId:${context.messageId}`)
  }

  if (suffixParts.length === 0) {
    return message
  }

  return `${message} [${suffixParts.join(' ')}]`
}
