/**
 * ZIP generation utilities for export service.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'

/**
 * Read all template files from the templates directory.
 */
function loadTemplates(): Record<string, string> {
  const templatesDir = join(__dirname, 'templates')
  const templates: Record<string, string> = {}

  function readDir(dir: string, prefix: string = '') {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const relativePath = prefix ? `${prefix}/${entry}` : entry
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        readDir(fullPath, relativePath)
      } else {
        templates[relativePath] = readFileSync(fullPath, 'utf-8')
      }
    }
  }

  readDir(templatesDir)
  return templates
}

// Load templates once at module initialization
let TEMPLATES: Record<string, string> | null = null

function getTemplates(): Record<string, string> {
  if (!TEMPLATES) {
    TEMPLATES = loadTemplates()
  }
  return TEMPLATES
}

export interface WorkflowVariable {
  id: string
  name: string
  type: string
  value: unknown
}

export interface GenerateZipOptions {
  workflowName: string
  workflowState: Record<string, unknown>
  decryptedEnv: Record<string, string>
  workflowVariables: WorkflowVariable[]
}

/**
 * Build the .env file content.
 */
function buildEnvContent(
  workflowName: string,
  decryptedEnv: Record<string, string>,
  workflowVariables: WorkflowVariable[]
): string {
  const lines = [
    `# ${workflowName} - Environment Variables`,
    '# Auto-generated with decrypted values',
    '',
    '# API Keys',
  ]

  // Add API keys from environment
  const apiKeyPatterns = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY']
  for (const key of apiKeyPatterns) {
    if (decryptedEnv[key]) {
      lines.push(`${key}=${decryptedEnv[key]}`)
    }
  }

  // Add any other environment variables
  for (const [key, value] of Object.entries(decryptedEnv)) {
    if (!apiKeyPatterns.includes(key)) {
      lines.push(`${key}=${value}`)
    }
  }

  // Add workflow variables
  lines.push('')
  lines.push('# Workflow Variables (initial values)')
  for (const variable of workflowVariables) {
    const value =
      typeof variable.value === 'object' ? JSON.stringify(variable.value) : variable.value
    lines.push(`WORKFLOW_VAR_${variable.name}=${value}`)
  }

  lines.push('')
  lines.push('# Server Configuration')
  lines.push('# HOST=0.0.0.0')
  lines.push('# PORT=8080')
  lines.push('# WORKFLOW_PATH=workflow.json')
  lines.push('')
  lines.push('# Local File Tools')
  lines.push('# Set WORKSPACE_DIR to enable local file operations')
  lines.push('# All file paths are sandboxed to this directory')
  lines.push('# WORKSPACE_DIR=./workspace')
  lines.push('')
  lines.push('# Command Execution (requires WORKSPACE_DIR)')
  lines.push('# Enable to allow agents to run commands like "python script.py"')
  lines.push('# ENABLE_COMMAND_EXECUTION=true')
  lines.push('')
  lines.push('# File Size Limit (default: 100MB)')
  lines.push('# MAX_FILE_SIZE=104857600')
  lines.push('')

  return lines.join('\n')
}

/**
 * Build the .env.example file content (masked API keys).
 */
function buildEnvExampleContent(envContent: string): string {
  return envContent
    .split('\n')
    .map((line) => {
      if (line.includes('=') && !line.startsWith('#') && !line.startsWith('WORKFLOW_VAR_')) {
        const [key] = line.split('=')
        return `${key}=your-key-here`
      }
      return line
    })
    .join('\n')
}

/**
 * Build the README.md content.
 */
function buildReadmeContent(workflowName: string, serviceName: string): string {
  return `# ${workflowName}

Standalone workflow service exported from Sim Studio.

## Quick Start

\`\`\`bash
# Install dependencies
pip install -r requirements.txt

# Start server
uvicorn main:app --port 8080

# Execute workflow
curl -X POST http://localhost:8080/execute \\
  -H "Content-Type: application/json" \\
  -d '{"your": "input"}'
\`\`\`

## Docker Deployment

\`\`\`bash
# Build and run with Docker Compose
docker compose up -d

# Or build manually
docker build -t ${serviceName} .
docker run -p 8080:8080 --env-file .env ${serviceName}
\`\`\`

## Files

- \`workflow.json\` - Workflow definition
- \`.env\` - Environment variables (API keys included)
- \`.env.example\` - Template without sensitive values
- \`main.py\` - FastAPI server
- \`executor.py\` - DAG execution engine
- \`handlers/\` - Block type handlers
- \`Dockerfile\` - Container configuration
- \`docker-compose.yml\` - Docker Compose setup

## API

- \`GET /health\` - Health check
- \`POST /execute\` - Execute workflow with input

## Security Notice

⚠️ **IMPORTANT**: The \`.env\` file contains sensitive API keys.

- **Never commit \`.env\` to version control** - add it to \`.gitignore\`
- Use \`.env.example\` as a template for team members
- In production, use secure environment variable management (e.g., AWS Secrets Manager, Docker secrets, Kubernetes secrets)
- Consider using environment-specific configurations for different deployments

## File Operations

Agents can perform file operations in two ways:

### Option 1: Local File Tools (WORKSPACE_DIR)

Set the \`WORKSPACE_DIR\` environment variable to enable local file operations:

\`\`\`bash
# In .env
WORKSPACE_DIR=./workspace
\`\`\`

When enabled, agents automatically get access to:
- \`local_write_file\` - Write files to the workspace directory
- \`local_read_file\` - Read files from the workspace directory
- \`local_list_directory\` - List workspace contents

All paths are sandboxed to \`WORKSPACE_DIR\` - agents cannot access files outside this directory.

**With Docker:** The docker-compose.yml mounts \`./output\` to the container workspace:
\`\`\`bash
docker compose up -d
# Files written by agents appear in ./output/
\`\`\`

### Option 2: MCP Filesystem Tools

If your workflow uses MCP filesystem servers, those tools work as configured.
MCP servers handle file operations on their own systems - paths and permissions
are determined by the MCP server's configuration.

### Using Both

You can use both options together. If \`WORKSPACE_DIR\` is set, agents will have
access to both local file tools AND any MCP tools configured in the workflow.
Tool descriptions help the LLM choose the appropriate tool for each operation.

## MCP Tool Support

This service supports MCP (Model Context Protocol) tools via the official Python SDK.
MCP servers must be running and accessible at their configured URLs for tool execution to work.

Exported at: ${new Date().toISOString()}
`
}

/**
 * Generate the service ZIP file.
 */
export async function generateServiceZip(options: GenerateZipOptions): Promise<Buffer> {
  const { workflowName, workflowState, decryptedEnv, workflowVariables } = options

  const templates = getTemplates()
  const zip = new JSZip()
  const serviceName = workflowName.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const folder = zip.folder(serviceName)!

  // Add workflow.json
  folder.file('workflow.json', JSON.stringify(workflowState, null, 2))

  // Add .env
  const envContent = buildEnvContent(workflowName, decryptedEnv, workflowVariables)
  folder.file('.env', envContent)

  // Add .env.example (masked)
  folder.file('.env.example', buildEnvExampleContent(envContent))

  // Add all template files
  for (const [filename, content] of Object.entries(templates)) {
    folder.file(filename, content)
  }

  // Add README.md
  folder.file('README.md', buildReadmeContent(workflowName, serviceName))

  // Generate ZIP buffer
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}

/**
 * Get the service name from workflow name.
 */
export function getServiceName(workflowName: string): string {
  return workflowName.replace(/[^a-z0-9]/gi, '-').toLowerCase()
}
