# Sim Studio: Workflow Creation and Export Guide

This guide documents how to programmatically create workflows in Sim Studio via direct database operations, and export them as standalone Python services.

## Overview

Sim Studio workflows consist of:
1. **Workflow record** - metadata (name, description, owner)
2. **Blocks** - the nodes in the workflow (start, agent, api, response, etc.)
3. **Edges** - connections between blocks defining execution flow

The workflow creation API requires session authentication (not API keys), so for programmatic creation, direct database operations are the most reliable approach.

---

## Database Schema

### Prerequisites

**Database Connection:**
```bash
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d simstudio
```

**Get User and Workspace IDs:**
```sql
SELECT u.id as user_id, u.name as user_name,
       w.id as workspace_id, w.name as workspace_name
FROM "user" u
JOIN workspace w ON w.owner_id = u.id;
```

### Table: `workflow`

Main workflow metadata table.

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | text | Yes | UUID for the workflow |
| `user_id` | text | Yes | Owner user ID |
| `workspace_id` | text | No | Workspace ID (recommended) |
| `name` | text | Yes | Display name |
| `description` | text | No | Description |
| `color` | text | Yes | Hex color (default: `#3972F6`) |
| `last_synced` | timestamp | Yes | Set to NOW() |
| `created_at` | timestamp | Yes | Set to NOW() |
| `updated_at` | timestamp | Yes | Set to NOW() |
| `is_deployed` | boolean | Yes | Default: false |
| `run_count` | integer | Yes | Default: 0 |
| `variables` | json | No | Workflow variables (default: `{}`) |
| `folder_id` | text | No | Optional folder organization |

### Table: `workflow_blocks`

Blocks are the nodes in a workflow.

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | text | Yes | Unique block ID |
| `workflow_id` | text | Yes | Parent workflow ID |
| `type` | text | Yes | Block type (see below) |
| `name` | text | Yes | Display name |
| `position_x` | numeric | Yes | X coordinate in canvas |
| `position_y` | numeric | Yes | Y coordinate in canvas |
| `enabled` | boolean | Yes | Default: true |
| `horizontal_handles` | boolean | Yes | Default: true |
| `is_wide` | boolean | Yes | Default: false |
| `height` | numeric | Yes | Default: 0 |
| `sub_blocks` | jsonb | Yes | Block configuration (see below) |
| `outputs` | jsonb | Yes | Output definition |
| `data` | jsonb | No | Additional data |

### Table: `workflow_edges`

Edges connect blocks to define execution flow.

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | text | Yes | Unique edge ID |
| `workflow_id` | text | Yes | Parent workflow ID |
| `source_block_id` | text | Yes | Source block ID |
| `target_block_id` | text | Yes | Target block ID |
| `source_handle` | text | No | Usually "source" |
| `target_handle` | text | No | Usually "target" |

---

## Block Types and Configuration

### Supported Block Types for Export

```
start, start_trigger, agent, function, condition, router,
api, variables, response, loop, loop_block
```

### Block: `start`

Entry point for workflow execution.

```json
{
  "sub_blocks": {
    "startValue": {
      "id": "startValue",
      "type": "long-input",
      "value": "Default input value or instructions"
    }
  },
  "outputs": {
    "response": {"type": {"value": "any"}}
  }
}
```

**Reference in other blocks:** `<start.input>` (NOT `<start.response>`)

### Block: `agent`

LLM-powered agent block.

```json
{
  "sub_blocks": {
    "model": {
      "id": "model",
      "type": "combobox",
      "value": "claude-sonnet-4-20250514"
    },
    "apiKey": {
      "id": "apiKey",
      "type": "short-input",
      "value": "{{ANTHROPIC_API_KEY}}"
    },
    "messages": {
      "id": "messages",
      "type": "messages-input",
      "value": [
        {
          "role": "user",
          "content": "Your prompt here. Use <blockname.field> for references."
        }
      ]
    },
    "tools": {
      "id": "tools",
      "type": "tool-input",
      "value": []
    },
    "temperature": {
      "id": "temperature",
      "type": "slider",
      "value": 0.7
    },
    "memoryType": {
      "id": "memoryType",
      "type": "dropdown",
      "value": "none"
    },
    "responseFormat": {
      "id": "responseFormat",
      "type": "code",
      "value": ""
    }
  },
  "outputs": {
    "response": {"type": {"value": "any"}}
  }
}
```

**Supported Models:**

| Provider | Model Patterns | API Key Env Var |
|----------|---------------|-----------------|
| Anthropic | `claude-*` | `ANTHROPIC_API_KEY` |
| OpenAI | `gpt-*`, `o1-*`, `o3-*` | `OPENAI_API_KEY` |
| Google | `gemini-*` | `GOOGLE_API_KEY` |
| DeepSeek | `deepseek-*` | `DEEPSEEK_API_KEY` |
| xAI | `grok-*` | `XAI_API_KEY` |
| Mistral | `mistral-*`, `codestral-*` | `MISTRAL_API_KEY` |
| Groq | `groq/*` | `GROQ_API_KEY` |
| Cerebras | `cerebras/*` | `CEREBRAS_API_KEY` |
| OpenRouter | `openrouter/*` | `OPENROUTER_API_KEY` |
| Azure OpenAI | `azure/*` | `AZURE_OPENAI_API_KEY` |
| Ollama | `ollama/*` | `OLLAMA_API_KEY` (optional) |
| vLLM | `vllm/*` | `VLLM_API_KEY` (optional) |

**Adding MCP Tools to Agent:**

```json
{
  "tools": {
    "id": "tools",
    "type": "tool-input",
    "value": [
      {
        "type": "mcp",
        "title": "write_file",
        "toolId": "mcp-server-id-write_file",
        "usageControl": "auto",
        "params": {
          "serverId": "mcp-server-id",
          "toolName": "write_file",
          "serverUrl": "http://mcp.local:8001/mcp",
          "serverName": "Filesystem"
        },
        "schema": {
          "type": "object",
          "required": ["path", "content"],
          "properties": {
            "path": {"type": "string"},
            "content": {"type": "string"}
          },
          "description": "Write content to a file"
        }
      }
    ]
  }
}
```

### Block: `api`

HTTP request block.

```json
{
  "sub_blocks": {
    "url": {
      "id": "url",
      "type": "short-input",
      "value": "<start.input>"
    },
    "method": {
      "id": "method",
      "type": "dropdown",
      "value": "GET"
    },
    "headers": {
      "id": "headers",
      "type": "code",
      "value": "{\"User-Agent\": \"MyBot/1.0\"}"
    },
    "body": {
      "id": "body",
      "type": "code",
      "value": ""
    },
    "params": {
      "id": "params",
      "type": "code",
      "value": ""
    }
  },
  "outputs": {
    "response": {"type": {"value": "any"}}
  }
}
```

**Reference output:** `<blockname.response.data>` for response body

### Block: `function`

JavaScript code execution block (transpiled to Python in export).

```json
{
  "sub_blocks": {
    "code": {
      "id": "code",
      "type": "code",
      "value": "// JavaScript code\nvar input = <start.input>;\nreturn { processed: input.toUpperCase() };"
    },
    "language": {
      "id": "language",
      "type": "dropdown",
      "value": "javascript"
    }
  },
  "outputs": {
    "response": {"type": {"value": "any"}}
  }
}
```

### Block: `response`

Final output block - terminates the workflow.

```json
{
  "sub_blocks": {
    "responseValue": {
      "id": "responseValue",
      "type": "long-input",
      "value": "<agent_block.response>"
    }
  },
  "outputs": {
    "response": {"type": {"value": "any"}}
  }
}
```

### Block: `variables`

Update workflow variables.

```json
{
  "sub_blocks": {
    "variables": {
      "id": "variables",
      "type": "variables-input",
      "value": [
        {
          "id": "update-1",
          "type": "number",
          "value": "<someblock.result.count>",
          "isExisting": true,
          "variableId": "var-1",
          "variableName": "counter"
        }
      ]
    }
  }
}
```

---

## Variable References

Use `<blockname.field>` syntax to reference outputs from other blocks.

| Reference | Description |
|-----------|-------------|
| `<start.input>` | Input passed to workflow execution |
| `<blockname.response>` | Agent response content |
| `<blockname.response.data>` | API response body |
| `<blockname.result.field>` | Specific field from function return |
| `<variable.varname>` | Workflow variable value |
| `{{ENV_VAR}}` | Environment variable (in apiKey fields) |

**Important:** The start block outputs to `input` key, not `response`. Use `<start.input>`.

---

## Complete Workflow Creation Example

### Step 1: Create the Workflow

```sql
-- Generate a UUID for the workflow
-- Use: SELECT gen_random_uuid(); or uuidgen command

INSERT INTO workflow (
  id, user_id, workspace_id, name, description, color,
  last_synced, created_at, updated_at, is_deployed, run_count, variables
) VALUES (
  'your-workflow-uuid',
  'user-id-here',
  'workspace-id-here',
  'My Workflow',
  'Description of what this workflow does',
  '#10B981',
  NOW(), NOW(), NOW(),
  false, 0, '{}'::jsonb
);
```

### Step 2: Create Blocks

```sql
-- Start block
INSERT INTO workflow_blocks (
  id, workflow_id, type, name, position_x, position_y,
  enabled, horizontal_handles, is_wide, height, sub_blocks, outputs, data
) VALUES (
  'start-001',
  'your-workflow-uuid',
  'start',
  'Start',
  100, 200,
  true, true, false, 0,
  '{"startValue": {"id": "startValue", "type": "long-input", "value": "Enter input here"}}'::jsonb,
  '{"response": {"type": {"value": "any"}}}'::jsonb,
  '{}'::jsonb
);

-- Agent block
INSERT INTO workflow_blocks (
  id, workflow_id, type, name, position_x, position_y,
  enabled, horizontal_handles, is_wide, height, sub_blocks, outputs, data
) VALUES (
  'agent-001',
  'your-workflow-uuid',
  'agent',
  'Assistant',
  400, 200,
  true, true, false, 0,
  '{
    "model": {"id": "model", "type": "combobox", "value": "claude-sonnet-4-20250514"},
    "apiKey": {"id": "apiKey", "type": "short-input", "value": "{{ANTHROPIC_API_KEY}}"},
    "messages": {"id": "messages", "type": "messages-input", "value": [
      {"role": "user", "content": "Process this input: <start.input>"}
    ]},
    "tools": {"id": "tools", "type": "tool-input", "value": []},
    "temperature": {"id": "temperature", "type": "slider", "value": 0.7},
    "memoryType": {"id": "memoryType", "type": "dropdown", "value": "none"},
    "responseFormat": {"id": "responseFormat", "type": "code", "value": ""}
  }'::jsonb,
  '{"response": {"type": {"value": "any"}}}'::jsonb,
  '{}'::jsonb
);

-- Response block
INSERT INTO workflow_blocks (
  id, workflow_id, type, name, position_x, position_y,
  enabled, horizontal_handles, is_wide, height, sub_blocks, outputs, data
) VALUES (
  'response-001',
  'your-workflow-uuid',
  'response',
  'Response',
  700, 200,
  true, true, false, 0,
  '{"responseValue": {"id": "responseValue", "type": "long-input", "value": "<assistant.response>"}}'::jsonb,
  '{"response": {"type": {"value": "any"}}}'::jsonb,
  '{}'::jsonb
);
```

### Step 3: Create Edges

```sql
INSERT INTO workflow_edges (id, workflow_id, source_block_id, target_block_id, source_handle, target_handle)
VALUES
  ('edge-001', 'your-workflow-uuid', 'start-001', 'agent-001', 'source', 'target'),
  ('edge-002', 'your-workflow-uuid', 'agent-001', 'response-001', 'source', 'target');
```

### Step 4: View in Sim Studio

Access the workflow at:
```
http://localhost:3000/workspace/{workspace_id}/w/{workflow_id}
```

---

## Exporting to Standalone Service

### Export API

```bash
curl -s "http://localhost:3000/api/workflows/{workflow_id}/export-service" \
  -H "X-API-Key: your-api-key" \
  -o service.zip
```

**Requirements:**
- Valid API key for the workspace
- Workflow must only contain supported block types
- Agent blocks must use supported LLM providers

### Extract and Run

```bash
# Extract
unzip service.zip -d my-service
cd my-service

# Install dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure environment (API keys are pre-populated from Sim Studio)
# Optionally enable local file tools:
echo "WORKSPACE_DIR=./workspace" >> .env
mkdir -p workspace

# Run
uvicorn main:app --host 0.0.0.0 --port 8080
```

### Service Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with workspace status |
| `/execute` | POST | Execute the workflow |

### Execute Request

```bash
curl -X POST http://localhost:8080/execute \
  -H "Content-Type: application/json" \
  -d '{"input": "Your input here"}'
```

### Response Format

```json
{
  "success": true,
  "output": {
    "data": { "responseValue": "..." }
  },
  "logs": [
    {
      "blockId": "start-001",
      "blockName": "Start",
      "blockType": "start",
      "success": true,
      "output": { "input": "..." }
    }
  ]
}
```

---

## Exported Service Features

### Local File Tools (WORKSPACE_DIR)

When `WORKSPACE_DIR` is set, agents automatically get these tools:

| Tool | Description |
|------|-------------|
| `local_write_file` | Write text to file |
| `local_write_bytes` | Write binary (base64) to file |
| `local_append_file` | Append to file |
| `local_read_file` | Read text file |
| `local_read_bytes` | Read binary as base64 |
| `local_delete_file` | Delete file |
| `local_list_directory` | List directory contents |
| `local_execute_command` | Run commands (requires `ENABLE_COMMAND_EXECUTION=true`) |

All paths are sandboxed to `WORKSPACE_DIR`.

### Docker Deployment

```bash
docker compose up -d
```

Files written by agents appear in `./output/` (mounted to container workspace).

---

## Common Patterns

### Web Scraper Workflow

```
Start (URL) → API (GET) → Agent (parse HTML) → Response
```

### Multi-Agent Pipeline

```
Start → Developer Agent → Reviewer Agent → Response
```

### Data Processing

```
Start → Function (transform) → Agent (analyze) → Response
```

---

## Troubleshooting

### Export Fails with 500

Check server logs for specific error. Common issues:
- Unsupported block type (evaluator, code_interpreter not supported)
- Missing templates directory (Next.js path issue)

### Variable References Return Null

- Verify block name matches exactly (case-sensitive, use lowercase with underscores)
- Use `<start.input>` not `<start.response>` for start block
- Check the previous block actually produced output

### MCP Tools Not Working

- MCP servers must be running and accessible
- Alternative: Use `WORKSPACE_DIR` for local file operations
- Both can be used together

### Agent Not Using Tools

- Ensure tools array is properly configured with schema
- Check `usageControl` is set to "auto"
- Verify the prompt instructs the agent to use tools

---

## Quick Reference: SQL Templates

### Create Workflow
```sql
INSERT INTO workflow (id, user_id, workspace_id, name, description, color, last_synced, created_at, updated_at, is_deployed, run_count, variables)
VALUES ('{uuid}', '{user_id}', '{workspace_id}', '{name}', '{description}', '#3972F6', NOW(), NOW(), NOW(), false, 0, '{}'::jsonb);
```

### Create Block
```sql
INSERT INTO workflow_blocks (id, workflow_id, type, name, position_x, position_y, enabled, horizontal_handles, is_wide, height, sub_blocks, outputs, data)
VALUES ('{block_id}', '{workflow_id}', '{type}', '{name}', {x}, {y}, true, true, false, 0, '{sub_blocks}'::jsonb, '{"response": {"type": {"value": "any"}}}'::jsonb, '{}'::jsonb);
```

### Create Edge
```sql
INSERT INTO workflow_edges (id, workflow_id, source_block_id, target_block_id, source_handle, target_handle)
VALUES ('{edge_id}', '{workflow_id}', '{source_block_id}', '{target_block_id}', 'source', 'target');
```

### Export Workflow
```bash
curl -s "http://localhost:3000/api/workflows/{workflow_id}/export-service" -H "X-API-Key: {api_key}" -o {name}.zip
```

---

## Environment Reference

**Current Setup (as of this documentation):**
- **User ID:** `pKdo3Px3zwXt47LqfUkf0hpHALHtreWh`
- **Workspace ID:** `c777afd2-f9c0-4514-aa23-04cbd24b6da6`
- **Database:** `localhost:5435` (user: postgres, pass: postgres, db: simstudio)
- **Sim Studio:** `http://localhost:3000`
- **API Key:** Check `api_key` table for valid keys
