const instances: Record<string, any> = {}

export function registerClientTool(toolCallId: string, instance: any) {
  instances[toolCallId] = instance
}

export function getClientTool(toolCallId: string): any | undefined {
  return instances[toolCallId]
}

export function unregisterClientTool(toolCallId: string) {
  delete instances[toolCallId]
} 