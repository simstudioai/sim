// load_agent_skill and load_custom_tool are retained for historical persisted
// messages; neither is emitted any more. load_custom_tool was renamed
// load_mcp_tool once it became clear that MCP was the only catalog kind it
// could ever match.
// search_integration_tools is gateway plumbing: the discovery step is not a
// user-meaningful action, only the resolved call_integration_tool row is.
// load_skill is the same shape — the agent pulling in a reference guide before
// doing the work is a step toward the action, not the action.
// search_documentation (the pre-rename id of search_docs) and
// get_platform_actions (retired; the quick reference lives in the docs corpus)
// are fully unregistered server-side, but historical persisted chats still
// contain their tool calls — like load_agent_skill, these entries stay forever
// so replaying an old transcript never renders a chip for a retired tool.
const HIDDEN_TOOL_NAMES = new Set([
  'load_agent_skill',
  'load_custom_tool',
  'load_mcp_tool',
  'load_integration_tool',
  'load_skill',
  'search_integration_tools',
  'search_documentation',
  'get_platform_actions',
])

export function isToolHiddenInUi(toolName: string | undefined): boolean {
  return !!toolName && HIDDEN_TOOL_NAMES.has(toolName)
}

export function getHiddenToolNames(): ReadonlySet<string> {
  return HIDDEN_TOOL_NAMES
}
