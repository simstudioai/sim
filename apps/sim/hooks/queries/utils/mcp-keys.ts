export const mcpKeys = {
  all: ['mcp'] as const,
  presentations: () => [...mcpKeys.all, 'presentation'] as const,
  presentation: (chatId: string, id: string) => [...mcpKeys.presentations(), chatId, id] as const,
  presentationMetadata: (chatId: string, id: string) =>
    [...mcpKeys.presentation(chatId, id), 'metadata'] as const,
  servers: () => [...mcpKeys.all, 'servers'] as const,
  serversList: (workspaceId?: string) => [...mcpKeys.servers(), workspaceId ?? ''] as const,
  managedCatalog: () => [...mcpKeys.all, 'managedCatalog'] as const,
  managedCatalogList: (workspaceId?: string) =>
    [...mcpKeys.managedCatalog(), workspaceId ?? ''] as const,
  serverTools: () => [...mcpKeys.all, 'serverTools'] as const,
  serverToolsWorkspace: (workspaceId?: string) =>
    [...mcpKeys.serverTools(), workspaceId ?? ''] as const,
  serverToolsList: (workspaceId?: string, serverId?: string) =>
    [...mcpKeys.serverToolsWorkspace(workspaceId), serverId ?? ''] as const,
  storedTools: () => [...mcpKeys.all, 'storedTools'] as const,
  storedToolsList: (workspaceId?: string) => [...mcpKeys.storedTools(), workspaceId ?? ''] as const,
  allowedDomains: () => [...mcpKeys.all, 'allowedDomains'] as const,
}
