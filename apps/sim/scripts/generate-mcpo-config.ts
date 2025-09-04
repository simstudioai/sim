import { promises as fs } from 'fs';
import path from 'path';

interface ToolServer {
  name: string;
  command: string;
  args: string[];
  url?: string;
}

interface ToolServersConfig {
  servers: ToolServer[];
}

interface McpoServerConfig {
  [key: string]: {
    command: string;
    args: string[];
    url?: string;
  };
}

interface McpoConfig {
  mcpServers: McpoServerConfig;
}

async function generateMcpoConfig() {
  try {
    const toolServersPath = path.resolve(process.cwd(), 'tool-servers.json');
    const toolServersContent = await fs.readFile(toolServersPath, 'utf-8');
    const toolServersConfig: ToolServersConfig = JSON.parse(toolServersContent);

    const mcpServers: McpoServerConfig = {};
    for (const server of toolServersConfig.servers) {
      mcpServers[server.name] = {
        command: server.command,
        args: server.args,
        url: server.url,
      };
    }

    const mcpoConfig: McpoConfig = {
      mcpServers,
    };

    const mcpoConfigPath = path.resolve(process.cwd(), 'mcpo-config.json');
    await fs.writeFile(mcpoConfigPath, JSON.stringify(mcpoConfig, null, 2));

    console.log('Successfully generated mcpo-config.json');
  } catch (error) {
    console.error('Error generating mcpo-config.json:', error);
    process.exit(1);
  }
}

generateMcpoConfig();
