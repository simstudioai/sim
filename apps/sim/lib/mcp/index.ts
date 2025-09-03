import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { ApiIcon } from '@/components/icons';

const McpToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.any(),
  bgColor: z.string(),
  type: z.string(),
  server: z.string(),
});

export type McpTool = z.infer<typeof McpToolSchema>;

const McpoConfigSchema = z.object({
  mcpServers: z.record(z.object({
    command: z.string(),
    args: z.array(z.string()),
    url: z.string().optional(),
  })),
});

async function readMcpoConfig() {
  const configPath = path.resolve(process.cwd(), 'mcpo-config.json');
  try {
    const fileContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(fileContent);
    return McpoConfigSchema.parse(config);
  } catch (error) {
    console.error('Error reading or parsing mcpo-config.json:', error);
    throw new Error('Could not read or parse mcpo-config.json');
  }
}

export async function getMcpTools(): Promise<McpTool[]> {
  const config = await readMcpoConfig();
  const allTools: McpTool[] = [];

  for (const serverName in config.mcpServers) {
    const serverConfig = config.mcpServers[serverName];
    // For now, let's assume a default URL if not provided.
    // This will be improved in the dynamic configuration step.
    const openapi_url = serverConfig.url || `http://localhost:8000/openapi.json`;

    try {
      const response = await fetch(openapi_url);
      if (!response.ok) {
        console.error(`Error fetching OpenAPI schema from ${serverName}: ${response.statusText}`);
        continue;
      }
      const openapi_spec = await response.json();

      const serverTools = transformOpenAPIToMcpTools(openapi_spec, serverName);
      allTools.push(...serverTools);

    } catch (error) {
      console.error(`Error fetching or parsing OpenAPI schema from ${serverName}:`, error);
    }
  }

  return allTools;
}

function transformOpenAPIToMcpTools(openapi_spec: any, serverName: string): McpTool[] {
  const tools: McpTool[] = [];
  if (!openapi_spec.paths) {
    return tools;
  }

  for (const path in openapi_spec.paths) {
    const pathItem = openapi_spec.paths[path];
    for (const method in pathItem) {
      const operation = pathItem[method];
      if (operation.operationId) {
        tools.push({
          id: operation.operationId,
          name: operation.summary || operation.operationId,
          description: operation.description || '',
          icon: ApiIcon,
          bgColor: '#6B7280', // Default color
          type: operation.operationId,
          server: serverName,
        });
      }
    }
  }

  return tools;
}
