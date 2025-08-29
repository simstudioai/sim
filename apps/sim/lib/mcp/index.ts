// This file will contain the logic for fetching tools from the mcpo server.

import { getAllBlocks } from '@/blocks'

interface McpTool {
  id: string
  name: string
  description: string
  icon: React.ComponentType<any>
  bgColor: string
  type: string
  server: string
}

export async function getMcpTools(): Promise<McpTool[]> {
  // TODO: Fetch the OpenAPI schema from the mcpo server.
  // The URL for the mcpo server will be something like 'http://mcpo:8000/openapi.json'.
  // This needs to be configurable.

  // TODO: Transform the OpenAPI schema into the McpTool format.
  // Each path in the schema will represent a tool.
  // The server name will be extracted from the server URL.

  // For now, return a mocked list of tools for development purposes.
  const allBlocks = getAllBlocks()
  const tools = allBlocks
    .filter((block) => block.category === 'tools')
    .map(
      (block): McpTool => ({
        id: block.type,
        name: block.name,
        description: block.description || '',
        icon: block.icon,
        bgColor: block.bgColor || '#6B7280',
        type: block.type,
        server: 'Sample Server',
      })
    )
  return Promise.resolve(tools)
}
