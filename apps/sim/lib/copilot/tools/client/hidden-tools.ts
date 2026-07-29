// load_agent_skill is retained for historical persisted messages; it is no
// longer emitted now that internal skills autoload.
// search_integration_tools is gateway plumbing: the discovery step is not a
// user-meaningful action, only the resolved call_integration_tool row is.
// search_documentation is the deprecated pre-rename id of search_docs, kept
// resolvable for one release so a mixed-version deploy works. A call only ever
// arrives from an older Mothership build and renders as the search_docs it maps
// onto, so it needs no chip of its own. Remove with the rest of the shim.
// get_platform_actions is retired the same way: the tool is gone, the id stays
// in the catalog for one release, and a call from an older build should not
// surface a chip for a capability that no longer exists.
const HIDDEN_TOOL_NAMES = new Set([
  'load_agent_skill',
  'load_custom_tool',
  'load_integration_tool',
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
