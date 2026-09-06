/** One chat owns one workbench for code and file access. */
export function chatSandboxSessionKey(chatId: string): string {
  return `mothership-chat:${chatId}`
}
