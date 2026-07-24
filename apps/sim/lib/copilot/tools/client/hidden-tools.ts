// load_agent_skill and load_custom_tool are retained for historical persisted
// messages; neither is emitted any more. load_custom_tool was renamed
// load_mcp_tool once it became clear that MCP was the only catalog kind it
// could ever match.
// search_integration_tools is gateway plumbing: the discovery step is not a
// user-meaningful action, only the resolved call_integration_tool row is.
const HIDDEN_TOOL_NAMES = new Set([
  'load_agent_skill',
  'load_custom_tool',
  'load_mcp_tool',
  'load_integration_tool',
  'search_integration_tools',
])

export function isToolHiddenInUi(toolName: string | undefined): boolean {
  return !!toolName && HIDDEN_TOOL_NAMES.has(toolName)
}

export function getHiddenToolNames(): ReadonlySet<string> {
  return HIDDEN_TOOL_NAMES
}
