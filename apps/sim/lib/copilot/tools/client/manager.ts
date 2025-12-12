const instances: Record<string, any> = {}

let syncStateFn: ((toolCallId: string, nextState: any, options?: { result?: any }) => void) | null =
  null

export function registerClientTool(toolCallId: string, instance: any) {
  instances[toolCallId] = instance
}

export function getClientTool(toolCallId: string): any | undefined {
  return instances[toolCallId]
}

export function unregisterClientTool(toolCallId: string) {
  delete instances[toolCallId]
}

export function registerToolStateSync(
  fn: (toolCallId: string, nextState: any, options?: { result?: any }) => void
) {
  syncStateFn = fn
}

export function syncToolState(toolCallId: string, nextState: any, options?: { result?: any }) {
  try {
    syncStateFn?.(toolCallId, nextState, options)
  } catch {}
}
