const HIDDEN_TOOL_NAMES = new Set(['tool_search_tool_regex', 'load_agent_skill'])

export function isToolHiddenInUi(toolName: string | undefined): boolean {
  return !!toolName && HIDDEN_TOOL_NAMES.has(toolName)
}

export function getHiddenToolNames(): ReadonlySet<string> {
  return HIDDEN_TOOL_NAMES
}
