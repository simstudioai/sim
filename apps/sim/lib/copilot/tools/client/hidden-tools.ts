// load_agent_skill is retained for historical persisted messages; it is no
// longer emitted now that internal skills autoload. load_user_skill is NOT
// hidden — it renders like the old per-skill loaders so users see the skill load.
const HIDDEN_TOOL_NAMES = new Set(['load_agent_skill', 'load_custom_tool', 'load_integration_tool'])

export function isToolHiddenInUi(toolName: string | undefined): boolean {
  return !!toolName && HIDDEN_TOOL_NAMES.has(toolName)
}

export function getHiddenToolNames(): ReadonlySet<string> {
  return HIDDEN_TOOL_NAMES
}
