export const MAX_MCP_TOOLS_PER_SERVER = 100
export const MAX_MCP_SERVERS_PER_WORKFLOW = 100
export const MCP_TOOL_BRIDGE_HEADER = 'X-Sim-MCP-Tool-Call'
export const MCP_TOOL_BRIDGE_ACTOR_HEADER = 'X-Sim-MCP-Tool-Actor'
export const MAX_MCP_PARAMETER_SCHEMA_BYTES = 2 * 1024 * 1024
export const MAX_MCP_TOOL_DESCRIPTION_BYTES = 64 * 1024
export const MAX_MCP_TOOL_NAME_BYTES = 256
export const MAX_MCP_TOOLS_LIST_RESPONSE_BYTES = 10 * 1024 * 1024
export const MAX_MCP_WORKFLOW_RESPONSE_BYTES = 10 * 1024 * 1024
export const MAX_MCP_SERVER_PARAMETER_SCHEMAS_BYTES = MAX_MCP_PARAMETER_SCHEMA_BYTES
export const MAX_MCP_SERVER_TOOLS_METADATA_BYTES = MAX_MCP_TOOLS_LIST_RESPONSE_BYTES

/**
 * Cap on the persisted `mcp_servers.last_error` text.
 *
 * The failure message can embed a remote response body verbatim — a URL that is
 * not an MCP endpoint answers a `tools/list` POST with whatever it serves, so an
 * entire HTML document would otherwise be stored and re-served by every `list`
 * and `get` of that server. 500 characters holds the whole diagnostic prefix
 * (`Failed to connect to "<name>": <transport error>`) plus the opening of any
 * upstream text, which is the part that identifies the misconfiguration, while
 * bounding the column at half a kilobyte per row.
 */
export const MAX_MCP_LAST_ERROR_LENGTH = 500
