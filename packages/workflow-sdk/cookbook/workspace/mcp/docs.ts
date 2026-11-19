// @sim-sdk 1
import { defineMcpServer, env } from '@sim/workflow-sdk/workspace'

// mcp/<key>.ts: an MCP server the workspace's agents call tools on. A workflow names it by key
// and a tool by name: mcp('docs').tool('search_docs'). A credential header holds an env reference,
// never the secret itself; `stored()` keeps the value the server already holds. The server's id
// derives from its URL, so a `url` with another host or path replaces the server; a new query
// string updates it in place.
export default defineMcpServer({
  name: 'Docs',
  url: 'https://docs.example.com/mcp',
  headers: { Authorization: 'Bearer {{DOCS_MCP_TOKEN}}', 'X-Api-Key': env.DOCS_MCP_KEY },
  timeout: 10000,
})
