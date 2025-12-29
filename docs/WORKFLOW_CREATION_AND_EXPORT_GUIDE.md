# Sim Studio: Workflow Creation and Export Guide

This guide documents how to programmatically create workflows in Sim Studio via direct database operations, and export them as standalone Python services.

## Overview

Sim Studio workflows consist of:
1. **Workflow record** - metadata (name, description, owner)
2. **Blocks** - the nodes in the workflow (start, agent, api, response, etc.)
3. **Edges** - connections between blocks defining execution flow

The workflow creation API requires session authentication (not API keys), so for programmatic creation, direct database operations are the most reliable approach.

---

## End-to-End Process

### Creating and Exporting a Workflow

1. **Get user and workspace IDs** from the database
2. **Generate UUIDs** for workflow, blocks, and edges
3. **Insert workflow record** with metadata
4. **Insert blocks** with full configuration (sub_blocks JSON)
5. **Insert edges** to connect blocks in execution order
6. **View in Sim Studio** to verify (refresh page if needed)
7. **Add tools** to agent blocks (file operations, database, MCP)
8. **Export via API** to generate standalone service ZIP
9. **Deploy service** with environment variables

### Re-exporting After Changes

When you modify a workflow in the database:

```bash
# 1. Make changes to workflow_blocks
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d simstudio -c "
UPDATE workflow_blocks SET sub_blocks = ... WHERE id = 'block-id';
"

# 2. Re-export the workflow
curl -s "http://localhost:3000/api/workflows/{workflow_id}/export-service" \
  -H "X-API-Key: {api_key}" -o updated-service.zip

# 3. Update service files (preserve any custom modifications)
unzip -o updated-service.zip -d temp
cp temp/*/workflow.json /path/to/running/service/

# 4. Restart the service
pkill -f "uvicorn main:app.*{port}"
cd /path/to/running/service && uvicorn main:app --port {port}
```

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

---

## Adding Tools to Agent Blocks

Agent blocks can use tools to perform actions like file operations, database queries, API calls, or any MCP-compatible operation. Tools are configured in the `tools` sub-block.

### Tool Configuration Structure

```json
{
  "tools": {
    "id": "tools",
    "type": "tool-input",
    "value": [
      {
        "type": "mcp",
        "title": "tool_display_name",
        "toolId": "unique-tool-identifier",
        "usageControl": "auto",
        "params": {
          "serverId": "server-identifier",
          "toolName": "actual_tool_name",
          "serverUrl": "http://server-url/mcp",
          "serverName": "Human Readable Server Name"
        },
        "schema": {
          "type": "object",
          "required": ["param1"],
          "properties": {
            "param1": {"type": "string", "description": "Description"},
            "param2": {"type": "number", "description": "Optional param"}
          },
          "description": "What this tool does"
        }
      }
    ]
  }
}
```

### Tool Types

| Type | Description | When to Use |
|------|-------------|-------------|
| `mcp` | Model Context Protocol tool | External MCP servers, or native tools exposed as MCP |
| `native` | Direct native implementation | Built-in tools from `tools.py` |

### Native File Tools (Local Filesystem)

For local file operations, use `serverUrl: "local"` and `serverName: "Local Filesystem"`:

```json
{
  "type": "mcp",
  "title": "local_write_file",
  "params": {
    "serverId": "local",
    "toolName": "local_write_file",
    "serverUrl": "local",
    "serverName": "Local Filesystem"
  },
  "schema": {
    "type": "object",
    "required": ["path", "content"],
    "properties": {
      "path": {"type": "string", "description": "File path relative to workspace"},
      "content": {"type": "string", "description": "Content to write"}
    }
  },
  "toolId": "local-write-file",
  "usageControl": "auto"
}
```

### Database Tools

For database operations, define custom tools that map to your database functions:

```json
{
  "type": "mcp",
  "title": "db_insert_record",
  "params": {
    "serverId": "database",
    "toolName": "db_insert_record",
    "serverUrl": "database",
    "serverName": "PostgreSQL Database"
  },
  "schema": {
    "type": "object",
    "required": ["table", "data"],
    "properties": {
      "table": {"type": "string", "description": "Table name"},
      "data": {"type": "object", "description": "Record data as key-value pairs"}
    }
  },
  "toolId": "db-insert-record",
  "usageControl": "auto"
}
```

### Adding Tools via SQL

To add tools to an existing agent block:

```sql
UPDATE workflow_blocks
SET sub_blocks = jsonb_set(
  sub_blocks,
  '{tools,value}',
  '[
    {
      "type": "mcp",
      "title": "local_write_file",
      "params": {
        "serverId": "local",
        "toolName": "local_write_file",
        "serverUrl": "local",
        "serverName": "Local Filesystem"
      },
      "schema": {
        "type": "object",
        "required": ["path", "content"],
        "properties": {
          "path": {"type": "string"},
          "content": {"type": "string"}
        }
      },
      "toolId": "local-write-file",
      "usageControl": "auto"
    }
  ]'::jsonb
)
WHERE id = 'your-agent-block-id';
```

### Important: Tool Deduplication

The exported service auto-registers native tools when environment variables are set (e.g., `WORKSPACE_DIR` enables file tools, `DB_HOST` enables database tools). If your workflow also defines these tools in the block configuration, you may get duplicate tool errors.

**The exported service handles this automatically** by deduplicating tools based on name. Native/environment-based tools take priority, and workflow-defined tools with the same name are skipped.

If you encounter "Tool names must be unique" errors, ensure your `handlers/agent.py` includes deduplication logic in `_build_tools()`:

```python
seen_tool_names = set()
# ... when adding each tool:
if tool_name in seen_tool_names:
    continue  # Skip duplicate
seen_tool_names.add(tool_name)
```

### Prompting the Agent to Use Tools

Tools must be explicitly mentioned in the agent's prompt for reliable usage:

```json
{
  "messages": {
    "value": [
      {
        "role": "user",
        "content": "Process the data and then:\n1. Save results to output.json using local_write_file\n2. Insert records into the database using db_insert_batch\n3. Return a summary"
      }
    ]
  }
}
```

**Best Practices:**
- Name specific tools the agent should use
- Describe expected output format for each tool
- Order operations logically
- Ask for a summary of what was accomplished

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

Use `<blockname.field>` syntax to reference outputs from other blocks. Block names are converted to snake_case (spaces become underscores, lowercase).

### Reference Syntax

| Reference | Description |
|-----------|-------------|
| `<start.input>` | Input passed to workflow execution |
| `<blockname.response>` | Agent response content |
| `<blockname.data>` | API response body (NOT `.response.data`) |
| `<blockname.result.field>` | Specific field from function return |
| `<variable.varname>` | Workflow variable value |
| `{{ENV_VAR}}` | Environment variable (in apiKey fields) |

### Block Name Conversion

Block names in the UI are converted for variable references:
- "Fetch Page" → `fetch_page`
- "My Agent" → `my_agent`
- "API Call" → `api_call`

### Common Gotchas

**Start Block:**
```
✓ <start.input>       - Correct
✗ <start.response>    - Wrong, start outputs to "input" key
```

**API Block:**
```
✓ <fetch_page.data>           - Correct, gets response body directly
✗ <fetch_page.response.data>  - Wrong, extra nesting doesn't exist
```

**Agent Block:**
```
✓ <my_agent.response>         - Gets the agent's text response
✓ <my_agent.response.content> - Also works for content field
```

### Debugging Variable References

If variables resolve to `null`, check:
1. Block name matches exactly (case-insensitive, converted to snake_case)
2. Field path matches actual output structure
3. Previous block executed successfully
4. Check execution logs for actual output structure

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

### Database Tools

When `DB_HOST` or `DB_NAME` environment variables are set, database tools are auto-registered:

| Tool | Description |
|------|-------------|
| `db_insert_quote` | Insert single record (example implementation) |
| `db_insert_quotes_batch` | Batch insert records |
| `db_query_quotes` | Query records |

**Environment Variables:**
```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=postgres
```

---

## Extending the Exported Service

The exported service can be extended with custom tools by modifying two files:

### Adding Custom Tools to `tools.py`

Add your tool functions at the end of `tools.py`:

```python
# Database configuration from environment
DB_HOST = os.environ.get('DB_HOST', 'localhost')
DB_PORT = int(os.environ.get('DB_PORT', 5432))
DB_NAME = os.environ.get('DB_NAME', 'postgres')
DB_USER = os.environ.get('DB_USER', 'postgres')
DB_PASSWORD = os.environ.get('DB_PASSWORD', 'postgres')

def is_database_enabled() -> bool:
    """Check if database tools should be enabled."""
    return bool(os.environ.get('DB_HOST') or os.environ.get('DB_NAME'))

def db_insert_record(table: str, data: dict) -> Dict[str, Any]:
    """Insert a record into the database."""
    try:
        import psycopg2
        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT,
            dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
        )
        cur = conn.cursor()
        columns = ', '.join(data.keys())
        placeholders = ', '.join(['%s'] * len(data))
        cur.execute(
            f"INSERT INTO {table} ({columns}) VALUES ({placeholders}) RETURNING id",
            list(data.values())
        )
        record_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()
        return {'success': True, 'id': record_id}
    except Exception as e:
        return {'success': False, 'error': str(e)}
```

### Registering Tools in `handlers/agent.py`

1. **Import your functions** in `_execute_native_tool()`:

```python
def _execute_native_tool(self, tool_info: Dict, tool_input: Dict) -> str:
    from tools import (
        write_file, read_file, list_directory,
        db_insert_record  # Add your function
    )
```

2. **Add execution case**:

```python
elif tool_name == 'db_insert_record':
    result = db_insert_record(
        tool_input.get('table', ''),
        tool_input.get('data', {})
    )
```

3. **Register in `_get_native_file_tools()`** (add at the end):

```python
# Add database tools if DB is configured
from tools import is_database_enabled
if is_database_enabled():
    tools.append({
        'name': 'db_insert_record',
        'description': 'Insert a record into the PostgreSQL database.',
        'input_schema': {
            'type': 'object',
            'properties': {
                'table': {'type': 'string', 'description': 'Table name'},
                'data': {'type': 'object', 'description': 'Record data'}
            },
            'required': ['table', 'data']
        }
    })
```

### Dependencies

Add required packages to `requirements.txt`:

```
psycopg2-binary>=2.9.9
```

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

- Block names are converted to snake_case: "Fetch Page" → `fetch_page`
- Use `<start.input>` not `<start.response>` for start block
- Use `<blockname.data>` not `<blockname.response.data>` for API blocks
- Check execution logs to see actual output structure
- Verify previous block executed successfully

### Tool Names Must Be Unique Error

This error occurs when tools are registered multiple times. Common causes:
- Workflow defines tools that are also auto-registered via environment variables
- Fix: The exported service should deduplicate tools in `_build_tools()`

```python
seen_tool_names = set()
if tool_name in seen_tool_names:
    continue
seen_tool_names.add(tool_name)
```

### MCP Tools Not Working

- MCP servers must be running and accessible from the service
- Alternative: Use `WORKSPACE_DIR` for local file operations (no external server needed)
- For exported services, prefer native tools over MCP when possible
- Both can be used together

### Agent Not Using Tools

- Ensure tools array is properly configured with schema
- Check `usageControl` is set to "auto"
- **Explicitly name the tools** in the prompt (e.g., "use local_write_file to save")
- Verify tools appear in the execution logs under `toolCalls`

### Database Connection Errors

- Ensure PostgreSQL is running and accessible
- Check `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` env vars
- Install `psycopg2-binary` in requirements
- Verify table exists before running workflow

### Workflow Doesn't Update in UI

After modifying workflow via SQL:
- Refresh the browser page (Cmd+R / F5)
- Check `last_synced` timestamp was updated
- Verify the SQL UPDATE affected the correct block ID

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
