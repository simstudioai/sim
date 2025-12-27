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
    '# =============================================================================',
    '# LLM Provider API Keys',
    '# =============================================================================',
    '# Only configure the providers you use. The service auto-detects providers',
    '# based on model names (e.g., claude-* -> Anthropic, gpt-* -> OpenAI)',
    '',
    '# --- Primary Providers ---',
  ]

  // All supported API key patterns
  const allApiKeyPatterns = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GOOGLE_API_KEY',
    'DEEPSEEK_API_KEY',
    'XAI_API_KEY',
    'CEREBRAS_API_KEY',
    'GROQ_API_KEY',
    'MISTRAL_API_KEY',
    'OPENROUTER_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_ENDPOINT',
    'AZURE_OPENAI_API_VERSION',
    'VLLM_BASE_URL',
    'VLLM_API_KEY',
    'OLLAMA_URL',
    'OLLAMA_API_KEY',
  ]

  // Add API keys from environment (primary providers first)
  const primaryKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY']
  for (const key of primaryKeys) {
    if (decryptedEnv[key]) {
      lines.push(`${key}=${decryptedEnv[key]}`)
    }
  }

  // Add secondary providers section
  lines.push('')
  lines.push('# --- Additional Providers (uncomment as needed) ---')

  // DeepSeek
  if (decryptedEnv['DEEPSEEK_API_KEY']) {
    lines.push(`DEEPSEEK_API_KEY=${decryptedEnv['DEEPSEEK_API_KEY']}`)
  } else {
    lines.push('# DEEPSEEK_API_KEY=your-deepseek-key')
  }

  // xAI (Grok)
  if (decryptedEnv['XAI_API_KEY']) {
    lines.push(`XAI_API_KEY=${decryptedEnv['XAI_API_KEY']}`)
  } else {
    lines.push('# XAI_API_KEY=your-xai-key')
  }

  // Cerebras
  if (decryptedEnv['CEREBRAS_API_KEY']) {
    lines.push(`CEREBRAS_API_KEY=${decryptedEnv['CEREBRAS_API_KEY']}`)
  } else {
    lines.push('# CEREBRAS_API_KEY=your-cerebras-key')
  }

  // Groq
  if (decryptedEnv['GROQ_API_KEY']) {
    lines.push(`GROQ_API_KEY=${decryptedEnv['GROQ_API_KEY']}`)
  } else {
    lines.push('# GROQ_API_KEY=your-groq-key')
  }

  // Mistral
  if (decryptedEnv['MISTRAL_API_KEY']) {
    lines.push(`MISTRAL_API_KEY=${decryptedEnv['MISTRAL_API_KEY']}`)
  } else {
    lines.push('# MISTRAL_API_KEY=your-mistral-key')
  }

  // OpenRouter
  if (decryptedEnv['OPENROUTER_API_KEY']) {
    lines.push(`OPENROUTER_API_KEY=${decryptedEnv['OPENROUTER_API_KEY']}`)
  } else {
    lines.push('# OPENROUTER_API_KEY=your-openrouter-key')
  }

  // Azure OpenAI section
  lines.push('')
  lines.push('# --- Azure OpenAI (for azure/* models) ---')
  if (decryptedEnv['AZURE_OPENAI_API_KEY']) {
    lines.push(`AZURE_OPENAI_API_KEY=${decryptedEnv['AZURE_OPENAI_API_KEY']}`)
  } else {
    lines.push('# AZURE_OPENAI_API_KEY=your-azure-key')
  }
  if (decryptedEnv['AZURE_OPENAI_ENDPOINT']) {
    lines.push(`AZURE_OPENAI_ENDPOINT=${decryptedEnv['AZURE_OPENAI_ENDPOINT']}`)
  } else {
    lines.push('# AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com')
  }
  lines.push('# AZURE_OPENAI_API_VERSION=2024-02-01')

  // Self-hosted section
  lines.push('')
  lines.push('# --- Self-Hosted Providers ---')
  lines.push('# Ollama (for ollama/* models)')
  if (decryptedEnv['OLLAMA_URL']) {
    lines.push(`OLLAMA_URL=${decryptedEnv['OLLAMA_URL']}`)
  } else {
    lines.push('# OLLAMA_URL=http://localhost:11434')
  }
  lines.push('# OLLAMA_API_KEY=optional-if-auth-enabled')
  lines.push('')
  lines.push('# vLLM (for vllm/* models)')
  if (decryptedEnv['VLLM_BASE_URL']) {
    lines.push(`VLLM_BASE_URL=${decryptedEnv['VLLM_BASE_URL']}`)
  } else {
    lines.push('# VLLM_BASE_URL=http://localhost:8000')
  }
  lines.push('# VLLM_API_KEY=optional-if-auth-enabled')

  // Add any other environment variables not in our patterns
  const otherEnvVars = Object.entries(decryptedEnv).filter(
    ([key]) => !allApiKeyPatterns.includes(key)
  )
  if (otherEnvVars.length > 0) {
    lines.push('')
    lines.push('# --- Other Environment Variables ---')
    for (const [key, value] of otherEnvVars) {
      lines.push(`${key}=${value}`)
    }
  }

  // Add workflow variables
  lines.push('')
  lines.push('# =============================================================================')
  lines.push('# Workflow Variables (initial values)')
  lines.push('# =============================================================================')
  for (const variable of workflowVariables) {
    const value =
      typeof variable.value === 'object' ? JSON.stringify(variable.value) : variable.value
    lines.push(`WORKFLOW_VAR_${variable.name}=${value}`)
  }

  lines.push('')
  lines.push('# =============================================================================')
  lines.push('# Server Configuration')
  lines.push('# =============================================================================')
  lines.push('# HOST=0.0.0.0')
  lines.push('# PORT=8080')
  lines.push('# WORKFLOW_PATH=workflow.json')
  lines.push('')
  lines.push('# =============================================================================')
  lines.push('# Local File Tools')
  lines.push('# =============================================================================')
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
