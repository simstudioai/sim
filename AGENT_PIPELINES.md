# Agent Pipelines Documentation

This document describes all agent pipelines and workflows in Sim Studio, showing how data flows through the system, what prompts are sent to AI models, and how results are processed.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Agent Block Pipeline](#1-agent-block-pipeline)
3. [Router Block Pipeline](#2-router-block-pipeline)
4. [Evaluator Block Pipeline](#3-evaluator-block-pipeline)
5. [Knowledge Base (RAG) Pipeline](#4-knowledge-base-rag-pipeline)
6. [Complete Workflow Example](#5-complete-workflow-example)

---

## Architecture Overview

Sim Studio follows a **Handler-Provider-Tool** architecture:

```
┌────────────────────────────────────────────────────────────┐
│                      DAG Executor                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│  │ DAGBuilder │→ │Execution   │→ │Block       │          │
│  │            │  │Engine      │  │Executor    │          │
│  └────────────┘  └────────────┘  └────────────┘          │
└────────────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────────┐
│                   Block Handlers                           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │ Agent   │ │ Router  │ │Evaluator│ │Workflow │ ...    │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘        │
└────────────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────────┐
│                  Provider Layer                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                     │
│  │Anthropic│ │ OpenAI  │ │ Google  │ ...                 │
│  └─────────┘ └─────────┘ └─────────┘                     │
└────────────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────────┐
│                    Tool System                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                     │
│  │Knowledge│ │   MCP   │ │ Custom  │ ...                 │
│  └─────────┘ └─────────┘ └─────────┘                     │
└────────────────────────────────────────────────────────────┘
```

---

## 1. Agent Block Pipeline

**Handler**: `/apps/sim/executor/handlers/agent/agent-handler.ts`

**Purpose**: Core LLM wrapper that processes prompts, manages conversation history, executes tools, and returns AI-generated responses.

### Data Flow Diagram

```
┌─────────────┐
│   INPUT     │ System Prompt, User Prompt, Memories, Tools, Model
└──────┬──────┘
       │
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: Memory Processing                                  │
│                                                              │
│  memories → convert to messages → add system prompt         │
│                                → add user prompt            │
│                                                              │
│  Output: [                                                   │
│    { role: 'system', content: 'You are...' },               │
│    { role: 'user', content: 'Previous message' },           │
│    { role: 'assistant', content: 'Previous response' },     │
│    { role: 'user', content: 'Current query' }               │
│  ]                                                           │
└──────┬──────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: Tool Preparation                                   │
│                                                              │
│  For each tool in tools:                                    │
│    1. Custom Tool → wrap code in executor                   │
│    2. MCP Tool → discover schema from MCP server            │
│    3. Block Tool → transform to provider format             │
│                                                              │
│  Collect context:                                           │
│    - blockData: all previous block outputs                  │
│    - blockNameMapping: name → ID mappings                   │
│    - environmentVariables: env vars                         │
│    - workflowVariables: workflow vars                       │
└──────┬──────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 3: Provider Request Construction                      │
│                                                              │
│  Build request:                                             │
│    - provider: (anthropic, openai, google, etc.)           │
│    - model: (gpt-4o, claude-3-7-sonnet, etc.)              │
│    - messages: processed conversation history               │
│    - tools: formatted tool definitions                      │
│    - temperature: 0-2                                       │
│    - responseFormat: JSON schema (if structured output)    │
│    - context data for tool execution                        │
└──────┬──────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 4: AI Model Execution (OpenAI Example)                │
│                                                              │
│  STEP 1: Initial API Call                                   │
│  ┌────────────────────────────────────────┐                │
│  │ POST /v1/chat/completions               │                │
│  │ {                                       │                │
│  │   model: "gpt-4o",                      │                │
│  │   messages: [...],                      │                │
│  │   tools: [...],                         │                │
│  │   temperature: 0.7                      │                │
│  │ }                                       │                │
│  └────────────────────────────────────────┘                │
│         │                                                    │
│         ↓                                                    │
│  ┌────────────────────────────────────────┐                │
│  │ Response:                               │                │
│  │ - content: "I'll search for that..."    │                │
│  │ - tool_calls: [                         │                │
│  │     {                                   │                │
│  │       function: "exa_search",           │                │
│  │       arguments: { query: "..." }       │                │
│  │     }                                   │                │
│  │   ]                                     │                │
│  └────────────────────────────────────────┘                │
│         │                                                    │
│         ↓                                                    │
│  STEP 2: Tool Execution Loop (max 10 iterations)            │
│  ┌────────────────────────────────────────┐                │
│  │ For each tool_call:                     │                │
│  │   1. Find tool definition               │                │
│  │   2. Merge pre-filled params            │                │
│  │   3. Execute tool with context:         │                │
│  │      - blockData                        │                │
│  │      - workflowVariables                │                │
│  │      - environmentVariables             │                │
│  │   4. Collect result                     │                │
│  │   5. Add to messages:                   │                │
│  │      { role: 'assistant',               │                │
│  │        tool_calls: [...] }              │                │
│  │      { role: 'tool',                    │                │
│  │        content: result }                │                │
│  └────────────────────────────────────────┘                │
│         │                                                    │
│         ↓                                                    │
│  STEP 3: Next Model Call with Tool Results                  │
│  ┌────────────────────────────────────────┐                │
│  │ POST /v1/chat/completions               │                │
│  │ {                                       │                │
│  │   messages: [...previous, tool results]│                │
│  │ }                                       │                │
│  └────────────────────────────────────────┘                │
│         │                                                    │
│         ↓                                                    │
│  ┌────────────────────────────────────────┐                │
│  │ Final Response:                         │                │
│  │ - content: "Based on the search..."     │                │
│  │ - tool_calls: null (done)               │                │
│  └────────────────────────────────────────┘                │
└──────┬──────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 5: Response Processing                                │
│                                                              │
│  If responseFormat provided:                                │
│    - Parse JSON from content                                │
│    - Spread fields as top-level properties                  │
│  Else:                                                       │
│    - Return standard response structure                     │
│                                                              │
│  Add metadata:                                              │
│    - tokens (prompt, completion, total)                     │
│    - cost (input, output, total)                            │
│    - toolCalls (list and count)                             │
│    - timing (durations, iterations)                         │
└──────┬──────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────┐
│   OUTPUT    │
└─────────────┘
```

### Input Data Structure

```typescript
{
  systemPrompt: string,           // AI behavior instructions
  userPrompt: string,              // User query/input
  memories: Array<Message>,        // Conversation history
  model: string,                   // AI model (e.g., "gpt-4o", "claude-3-7-sonnet")
  tools: Array<ToolInput>,         // Available tools
  temperature: number,             // 0-2, randomness level
  maxTokens: number,              // Token limit
  responseFormat: object,          // JSON schema for structured output
  apiKey: string,                  // Provider API key
  azureEndpoint?: string,         // For Azure OpenAI
  azureApiVersion?: string        // For Azure OpenAI
}
```

### Prompt Construction

**System Prompt** (from `systemPrompt` input):
```
You are a helpful AI assistant for Sim Studio, a powerful workflow automation platform.
```

**User Prompt** (from `userPrompt` input):
```
How do I create a workflow that sends emails when new customers sign up?
```

**Messages Array** (if memories provided):
```typescript
[
  { role: 'system', content: 'You are a helpful AI assistant...' },
  { role: 'user', content: 'What blocks are available?' },
  { role: 'assistant', content: 'We have Agent, API, Webhook, Email...' },
  { role: 'user', content: 'How do I create a workflow that sends emails...' }
]
```

### Tool Execution Context

When a tool is executed, it receives:

```typescript
{
  // Tool-specific parameters (from AI or pre-filled)
  ...toolArguments,

  // Workflow context
  environmentVariables: {
    OPENAI_API_KEY: "sk-...",
    SLACK_TOKEN: "xoxb-..."
  },

  workflowVariables: {
    companyName: "Acme Corp",
    supportEmail: "support@acme.com"
  },

  // All previous block outputs
  blockData: {
    "block-id-1": { content: "...", tokens: {...} },
    "block-id-2": { results: [...] }
  },

  // Name to ID mappings
  blockNameMapping: {
    "Customer Support Agent": "block-id-1",
    "customersupportagent": "block-id-1",
    "Knowledge Search": "block-id-2",
    "knowledgesearch": "block-id-2"
  },

  // Metadata
  _context: {
    workflowId: "wf-123",
    workspaceId: "ws-456"
  }
}
```

### Output Data Structure

**Standard Response** (no responseFormat):
```typescript
{
  content: string,              // AI response text
  model: string,                // Model used
  tokens: {
    prompt: number,             // Input tokens
    completion: number,         // Output tokens
    total: number              // Total tokens
  },
  cost: {
    input: number,              // Cost for input tokens ($)
    output: number,             // Cost for output tokens ($)
    total: number              // Total cost ($)
  },
  toolCalls: {
    list: [{
      name: string,             // Tool name
      arguments: object,        // Arguments passed
      result: any,              // Execution result
      startTime: string,        // ISO timestamp
      endTime: string,          // ISO timestamp
      duration: number          // Milliseconds
    }],
    count: number
  },
  providerTiming: {
    startTime: string,
    endTime: string,
    duration: number,
    modelTime: number,          // Time in AI model
    toolsTime: number,          // Time executing tools
    iterations: number          // Number of model calls
  }
}
```

**Structured Response** (with responseFormat):
```typescript
{
  // All JSON schema fields spread as top-level properties
  title: string,
  description: string,
  tags: string[],

  // Standard metadata
  tokens: object,
  cost: object,
  toolCalls: object
}
```

### Example Execution

**Scenario**: Customer support agent with knowledge base search

**Input**:
```typescript
{
  systemPrompt: "You are a customer support assistant. Use the knowledge base tool to find relevant information before responding.",
  userPrompt: "What is our refund policy?",
  model: "gpt-4o",
  temperature: 0.7,
  tools: [
    {
      type: "knowledge",
      operation: "knowledge_search",
      params: {
        knowledgeBaseId: "kb-policies",
        topK: 3
      }
    }
  ]
}
```

**Execution Flow**:

1. **Initial AI Call**:
   - AI decides to use `knowledge_search` tool
   - Returns: `tool_calls: [{ function: "knowledge_search", arguments: { query: "refund policy" } }]`

2. **Tool Execution**:
   - Executes knowledge search with query "refund policy"
   - Returns: 3 relevant document chunks about refunds

3. **Second AI Call**:
   - AI receives tool results
   - Synthesizes answer based on knowledge base content
   - Returns: Final response text

4. **Output**:
```typescript
{
  content: "Our refund policy allows customers to request a full refund within 30 days of purchase. Refunds are processed within 5-7 business days after we receive the returned item.",
  model: "gpt-4o",
  tokens: { prompt: 245, completion: 48, total: 293 },
  cost: { input: 0.00245, output: 0.00096, total: 0.00341 },
  toolCalls: {
    list: [{
      name: "knowledge_search",
      arguments: { query: "refund policy" },
      result: { results: [...], totalResults: 3 },
      duration: 450
    }],
    count: 1
  }
}
```

---

## 2. Router Block Pipeline

**Handler**: `/apps/sim/executor/handlers/router/router-handler.ts`

**Purpose**: Intelligently routes workflow execution to the most appropriate downstream block based on AI analysis of the input.

### Data Flow Diagram

```
┌─────────────┐
│   INPUT     │ Routing Prompt, Model, Target Blocks
└──────┬──────┘
       │
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: Target Block Discovery                             │
│                                                              │
│  Get all connected blocks from workflow graph:              │
│  ┌────────────────────────────────────────┐                │
│  │ connections                             │                │
│  │   .filter(conn => conn.source == routerBlockId)         │
│  │   .map(conn => find target block)      │                │
│  └────────────────────────────────────────┘                │
│                                                              │
│  For each target block, extract:                            │
│    - id, type, title, description                           │
│    - systemPrompt (if agent block)                          │
│    - configuration                                          │
│    - currentState (previous output if exists)               │
│                                                              │
│  Example:                                                    │
│  [                                                           │
│    {                                                         │
│      id: "agent-sales",                                     │
│      type: "agent",                                         │
│      title: "Sales Agent",                                  │
│      systemPrompt: "You are a sales representative...",    │
│      currentState: null                                     │
│    },                                                        │
│    {                                                         │
│      id: "agent-support",                                   │
│      type: "agent",                                         │
│      title: "Support Agent",                                │
│      systemPrompt: "You are a support specialist...",      │
│      currentState: null                                     │
│    }                                                         │
│  ]                                                           │
└──────┬──────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: Routing Prompt Generation                          │
│                                                              │
│  Base Prompt:                                               │
│  ┌────────────────────────────────────────┐                │
│  │ "You are an intelligent routing agent  │                │
│  │  responsible for directing workflow     │                │
│  │  requests to the most appropriate      │                │
│  │  block."                                │                │
│  └────────────────────────────────────────┘                │
│         │                                                    │
│         ↓                                                    │
│  Add Target Block Information:                              │
│  ┌────────────────────────────────────────┐                │
│  │ "Available Target Blocks:               │                │
│  │                                         │                │
│  │  ID: agent-sales                        │                │
│  │  Type: agent                            │                │
│  │  Title: Sales Agent                     │                │
│  │  System Prompt: You are a sales...     │                │
│  │  ---                                    │                │
│  │  ID: agent-support                      │                │
│  │  Type: agent                            │                │
│  │  Title: Support Agent                   │                │
│  │  System Prompt: You are a support...   │                │
│  │  ---"                                   │                │
│  └────────────────────────────────────────┘                │
│         │                                                    │
│         ↓                                                    │
│  Add Routing Instructions:                                  │
│  ┌────────────────────────────────────────┐                │
│  │ "Routing Request: Route to sales if    │                │
│  │  the message mentions pricing or       │                │
│  │  purchasing, otherwise route to        │                │
│  │  support."                              │                │
│  │                                         │                │
│  │  Return ONLY the block ID.             │                │
│  │  Example: agent-sales                  │                │
│  └────────────────────────────────────────┘                │
└──────┬──────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 3: AI Model Execution                                 │
│                                                              │
│  ┌────────────────────────────────────────┐                │
│  │ POST /api/providers                     │                │
│  │ {                                       │                │
│  │   provider: "openai",                   │                │
│  │   model: "gpt-4o",                      │                │
│  │   systemPrompt: [generated prompt],    │                │
│  │   context: [user routing request],     │                │
│  │   temperature: 0.0  // Low for consistency              │
│  │ }                                       │                │
│  └────────────────────────────────────────┘                │
│         │                                                    │
│         ↓                                                    │
│  ┌────────────────────────────────────────┐                │
│  │ Response:                               │                │
│  │ {                                       │                │
│  │   content: "agent-sales"                │                │
│  │ }                                       │                │
│  └────────────────────────────────────────┘                │
└──────┬──────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 4: Path Selection & Validation                        │
│                                                              │
│  chosenBlockId = response.content.trim().toLowerCase()     │
│  // "agent-sales"                                           │
│                                                              │
│  Validate:                                                   │
│  ┌────────────────────────────────────────┐                │
│  │ chosenBlock = targetBlocks.find(       │                │
│  │   b => b.id === chosenBlockId          │                │
│  │ )                                       │                │
│  │                                         │                │
│  │ if (!chosenBlock) {                     │                │
│  │   throw Error("Invalid routing")       │                │
│  │ }                                       │                │
│  └────────────────────────────────────────┘                │
│                                                              │
│  Update workflow execution graph:                           │
│  ┌────────────────────────────────────────┐                │
│  │ ctx.decisions.router.set(               │                │
│  │   routerBlockId,                        │                │
│  │   chosenBlockId                         │                │
│  │ )                                       │                │
│  │                                         │                │
│  │ // Only the chosen path will execute   │                │
│  └────────────────────────────────────────┘                │
└──────┬──────────────────────────────────────────────────────┘
       │
       ↓
┌─────────────┐
│   OUTPUT    │
└─────────────┘
```

### Input Data Structure

```typescript
{
  prompt: string,                 // Routing criteria/instructions
  model: string,                  // AI model to use
  apiKey: string,                 // Provider API key
  temperature: number,            // Always 0.0 for deterministic routing
  azureEndpoint?: string,        // For Azure OpenAI
  azureApiVersion?: string       // For Azure OpenAI
}
```

### Prompt Construction

**System Prompt** (auto-generated by `generateRouterPrompt`):
```
You are an intelligent routing agent responsible for directing workflow requests to the most appropriate block. Your task is to analyze the input and determine the single most suitable destination based on the request.

Key Instructions:
1. You MUST choose exactly ONE destination from the IDs of the blocks in the workflow. The destination must be a valid block id.

2. Analysis Framework:
   - Carefully evaluate the intent and requirements of the request
   - Consider the primary action needed
   - Match the core functionality with the most appropriate destination

Available Target Blocks:

ID: 2acd9007-27e8-4510-a487-73d3b825e7c1
Type: agent
Title: Sales Agent
Description: Build an agent
System Prompt: "You are a professional sales representative. Help customers with pricing, product recommendations, and purchasing decisions."
Configuration: {
  "model": "gpt-4o",
  "temperature": 0.7
}
---

ID: 3bde0118-38f9-5621-b598-84e4c936f8d2
Type: agent
Title: Support Agent
Description: Build an agent
System Prompt: "You are a technical support specialist. Help customers troubleshoot issues, answer questions about features, and resolve problems."
Configuration: {
  "model": "gpt-4o",
  "temperature": 0.5
}
---

Routing Instructions:
1. Analyze the input request carefully against each block's:
   - Primary purpose (from title, description, and system prompt)
   - Look for keywords in the system prompt that match the user's request
   - Configuration settings
   - Current state (if available)
   - Processing capabilities

2. Selection Criteria:
   - Choose the block that best matches the input's requirements
   - Consider the block's specific functionality and constraints
   - Factor in any relevant current state or configuration
   - Prioritize blocks that can handle the input most effectively

Routing Request: Route to Sales Agent if the message is about pricing, purchasing, or product recommendations. Otherwise route to Support Agent.

Response Format:
Return ONLY the destination id as a single word, lowercase, no punctuation or explanation.
Example: "2acd9007-27e8-4510-a487-73d3b825e7c1"

Remember: Your response must be ONLY the block ID - no additional text, formatting, or explanation.
```

**User Context**:
```
[{ role: "user", content: "Route to Sales Agent if..." }]
```

### Output Data Structure

```typescript
{
  prompt: string,               // Original routing prompt
  model: string,                // Model used
  tokens: {
    prompt: number,
    completion: number,
    total: number
  },
  cost: {
    input: number,
    output: number,
    total: number
  },
  selectedPath: {
    blockId: string,            // Selected block ID
    blockType: string,          // Block type (agent, workflow, etc.)
    blockTitle: string          // Human-readable block name
  },
  selectedRoute: string         // Block ID for edge connection
}
```

### Example Execution

**Scenario**: Customer inquiry routing

**Input**:
```typescript
{
  prompt: "Route to Sales Agent if the message is about pricing or purchasing. Route to Support Agent for technical questions or issues.",
  model: "gpt-4o"
}
```

**Incoming Data** (from previous block):
```typescript
{
  userMessage: "How much does the Pro plan cost?"
}
```

**Execution Flow**:

1. **Discover Target Blocks**:
   - Sales Agent (ID: agent-sales)
   - Support Agent (ID: agent-support)

2. **Generate Routing Prompt**:
   - Include both agents' system prompts
   - Add routing criteria

3. **AI Analysis**:
   - AI analyzes: "How much does the Pro plan cost?"
   - Identifies keywords: "how much", "cost" → pricing question
   - Matches to Sales Agent system prompt

4. **Return Selection**:
   - Response: `"agent-sales"`

5. **Update Execution Graph**:
   - Mark Sales Agent path as active
   - Skip Support Agent path

**Output**:
```typescript
{
  prompt: "Route to Sales Agent if...",
  model: "gpt-4o",
  tokens: { prompt: 420, completion: 8, total: 428 },
  cost: { input: 0.0042, output: 0.00016, total: 0.00436 },
  selectedPath: {
    blockId: "agent-sales",
    blockType: "agent",
    blockTitle: "Sales Agent"
  },
  selectedRoute: "agent-sales"
}
```

**Next Block**: Only "Sales Agent" block executes; "Support Agent" is skipped.

---

## 3. Evaluator Block Pipeline

**Handler**: `/apps/sim/executor/handlers/evaluator/evaluator-handler.ts`

**Purpose**: Evaluates content against customizable metrics using AI-powered scoring with structured JSON output.

### Data Flow Diagram

```
┌─────────────┐
│   INPUT     │ Content, Metrics, Model
└──────┬──────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 1: Content Processing                              │
│                                                           │
│  Normalize content:                                       │
│    - If string + JSON → pretty-print                     │
│    - If object → stringify                               │
│    - Preserve formatting                                  │
│                                                           │
│  Parse metrics array:                                     │
│  [                                                        │
│    {                                                      │
│      name: "Clarity",                                    │
│      description: "How clear and understandable",        │
│      range: { min: 0, max: 10 }                          │
│    },                                                     │
│    {                                                      │
│      name: "Accuracy",                                   │
│      description: "Factually correct information",       │
│      range: { min: 0, max: 10 }                          │
│    }                                                      │
│  ]                                                        │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 2: Response Schema Generation                      │
│                                                           │
│  Build JSON schema for structured scoring:               │
│  {                                                        │
│    name: "evaluation_response",                          │
│    strict: true,                                         │
│    schema: {                                             │
│      type: "object",                                     │
│      properties: {                                       │
│        "clarity": {                                      │
│          type: "number",                                 │
│          description: "How clear... (0-10)"             │
│        },                                                │
│        "accuracy": {                                     │
│          type: "number",                                 │
│          description: "Factually... (0-10)"             │
│        }                                                 │
│      },                                                  │
│      required: ["clarity", "accuracy"],                 │
│      additionalProperties: false                        │
│    }                                                     │
│  }                                                       │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 3: System Prompt Construction                      │
│                                                           │
│  Generate evaluation prompt:                             │
│  ┌──────────────────────────────────────┐               │
│  │ "You are an objective evaluation     │               │
│  │  agent. Analyze the content against  │               │
│  │  the provided metrics and provide    │               │
│  │  detailed scoring.                   │               │
│  │                                       │               │
│  │  Metrics to evaluate:                │               │
│  │  - Clarity (0-10): How clear...      │               │
│  │  - Accuracy (0-10): Factually...     │               │
│  │                                       │               │
│  │  Content to evaluate:                │               │
│  │  [formatted content here]            │               │
│  │                                       │               │
│  │  Return JSON only with metric        │               │
│  │  scores. No explanations."           │               │
│  └──────────────────────────────────────┘               │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 4: AI Model Execution                              │
│                                                           │
│  POST /api/providers                                     │
│  {                                                        │
│    provider: "openai",                                   │
│    model: "gpt-4o",                                      │
│    systemPrompt: [generated prompt],                    │
│    responseFormat: [generated schema],                  │
│    temperature: 0.1  // Low for consistency             │
│  }                                                       │
│                                                           │
│  Response:                                               │
│  {                                                        │
│    content: '{"clarity": 8, "accuracy": 9}'            │
│  }                                                       │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 5: Score Extraction & Mapping                      │
│                                                           │
│  Parse JSON response:                                    │
│  parsed = JSON.parse(response.content)                  │
│  // { clarity: 8, accuracy: 9 }                         │
│                                                           │
│  Map to lowercase metric names:                          │
│  metricScores = {                                        │
│    clarity: 8,                                           │
│    accuracy: 9                                           │
│  }                                                       │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌─────────────┐
│   OUTPUT    │ Spread scores + metadata
└─────────────┘
```

### Output Data Structure

```typescript
{
  content: any,                 // Original content evaluated
  model: string,                // Model used
  tokens: object,               // Token usage
  cost: object,                 // Cost breakdown

  // Dynamic metric scores (lowercase)
  clarity: 8,
  accuracy: 9,
  relevance: 7
}
```

---

## 4. Knowledge Base (RAG) Pipeline

**Files**: `/apps/sim/tools/knowledge/search.ts`, `/apps/sim/lib/guardrails/validate_hallucination.ts`

**Purpose**: Retrieves relevant information from vector knowledge bases using semantic search and validates AI responses against source material.

### Data Flow Diagram

```
┌─────────────┐
│   INPUT     │ Query, Knowledge Base ID, TopK, Filters
└──────┬──────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 1: Search Request Construction                     │
│                                                           │
│  Parse parameters:                                        │
│    - knowledgeBaseId: "kb-123"                           │
│    - query: "What is our refund policy?"                 │
│    - topK: 5 (number of results)                         │
│    - tagFilters: [                                       │
│        { tagName: "category", tagValue: "policies" }    │
│      ]                                                    │
│                                                           │
│  Convert tag filters to OR logic:                        │
│    filters = {                                           │
│      "category": "policies|OR|legal"                     │
│    }                                                      │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 2: Vector Embedding                                │
│                                                           │
│  Generate query embedding:                               │
│  ┌──────────────────────────────────────┐               │
│  │ POST /v1/embeddings                   │               │
│  │ {                                     │               │
│  │   model: "text-embedding-3-small",   │               │
│  │   input: "What is our refund policy?"│               │
│  │ }                                     │               │
│  └──────────────────────────────────────┘               │
│         │                                                 │
│         ↓                                                 │
│  embedding = [0.123, -0.456, 0.789, ...]                │
│  // 1536-dimensional vector                              │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 3: Similarity Search                               │
│                                                           │
│  Apply tag filters:                                       │
│  filteredDocs = documents.filter(doc =>                 │
│    doc.tags.category in ["policies", "legal"]           │
│  )                                                        │
│                                                           │
│  Compute cosine similarity for each chunk:               │
│  for chunk in filteredDocs:                              │
│    similarity = cosineSimilarity(                        │
│      queryEmbedding,                                     │
│      chunk.embedding                                     │
│    )                                                      │
│    results.push({                                        │
│      content: chunk.content,                             │
│      similarity: similarity,                             │
│      metadata: chunk.metadata                            │
│    })                                                     │
│                                                           │
│  Sort by similarity (descending):                        │
│  results.sort((a, b) => b.similarity - a.similarity)    │
│                                                           │
│  Take top K results:                                     │
│  topResults = results.slice(0, topK)                    │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 4 (Optional): Hallucination Validation             │
│                                                           │
│  If guardrails enabled:                                  │
│                                                           │
│  Build context from retrieved chunks:                    │
│  contextText = topResults                                │
│    .map(r => r.content)                                  │
│    .join('\n\n---\n\n')                                  │
│                                                           │
│  Construct validation prompt:                            │
│  ┌──────────────────────────────────────┐               │
│  │ System:                               │               │
│  │ "You are a confidence scoring system. │               │
│  │  Score input on 0-10 scale:          │               │
│  │  - 0-2: Full hallucination            │               │
│  │  - 3-4: Low confidence                │               │
│  │  - 5-6: Medium confidence             │               │
│  │  - 7-8: High confidence               │               │
│  │  - 9-10: Very high confidence         │               │
│  │                                       │               │
│  │  Return JSON: {score, reasoning}"    │               │
│  │                                       │               │
│  │ User:                                 │               │
│  │ "Reference Context:                   │               │
│  │  [contextText]                        │               │
│  │                                       │               │
│  │  User Input to Evaluate:              │               │
│  │  [AI response to validate]"          │               │
│  └──────────────────────────────────────┘               │
│         │                                                 │
│         ↓                                                 │
│  AI Response:                                            │
│  {                                                        │
│    score: 9,                                             │
│    reasoning: "The response is fully supported..."      │
│  }                                                       │
│                                                           │
│  If score < threshold (default: 3):                      │
│    validation.passed = false                             │
│    → Workflow can branch to error handling              │
└──────┬───────────────────────────────────────────────────┘
       │
       ↓
┌─────────────┐
│   OUTPUT    │
└─────────────┘
```

### Output Data Structure

**Knowledge Search Output**:
```typescript
{
  results: [{
    documentId: string,
    documentName: string,
    content: string,              // Chunk text
    chunkIndex: number,
    similarity: number,           // 0-1 cosine similarity
    metadata: {
      tags: object,
      chunkId: string,
      createdAt: string
    }
  }],
  query: string,
  totalResults: number,
  cost: object
}
```

**Hallucination Validation Output**:
```typescript
{
  passed: boolean,               // true if score >= threshold
  score: number,                 // 0-10 confidence score
  reasoning: string,             // AI explanation
  error?: string                 // If validation failed
}
```

---

## 5. Complete Workflow Example

This section demonstrates a complete end-to-end workflow execution showing how all pipelines connect together.

### Workflow Structure

```
[Trigger] → [Knowledge Search] → [Agent] → [Evaluator] → [Router] → [Response A | Response B]
```

**Use Case**: Customer support system that retrieves policy information, generates responses, evaluates quality, and routes based on confidence.

### Step-by-Step Execution Trace

#### **Block 1: Trigger**

**Input** (from user/API):
```json
{
  "query": "What is your refund policy?"
}
```

**Output**:
```json
{
  "query": "What is your refund policy?",
  "timestamp": "2025-11-15T10:00:00.000Z"
}
```

**Execution Time**: 0ms

---

#### **Block 2: Knowledge Search**

**Prompt Construction**:
- **Input Query**: `blockData["trigger-1"].query` → "What is your refund policy?"
- **Knowledge Base**: "kb-policies"
- **TopK**: 5
- **Tag Filters**: `category=policies`

**Execution**:
1. **Generate Embedding**: Query → 1536-dimensional vector
2. **Vector Search**: Cosine similarity against all policy documents
3. **Filter & Rank**: Apply tag filter, sort by similarity
4. **Return Top 5**

**Output**:
```json
{
  "results": [
    {
      "documentName": "refund_policy.pdf",
      "content": "Customers can request a full refund within 30 days of purchase. Refunds are processed within 5-7 business days after we receive the returned item.",
      "similarity": 0.92,
      "chunkIndex": 0
    },
    {
      "documentName": "refund_policy.pdf",
      "content": "To initiate a refund, contact our support team at support@company.com with your order number.",
      "similarity": 0.87,
      "chunkIndex": 1
    },
    {
      "documentName": "refund_policy.pdf",
      "content": "Items must be in original condition with tags attached for refund eligibility.",
      "similarity": 0.81,
      "chunkIndex": 2
    }
  ],
  "query": "What is your refund policy?",
  "totalResults": 3,
  "cost": { "total": 0.00002 }
}
```

**Execution Time**: 450ms

---

#### **Block 3: Agent (Customer Support)**

**Prompt Construction**:

**System Prompt**:
```
You are a customer support assistant. Use the provided knowledge base context to answer user questions accurately. Always base your response on the context provided.
```

**User Prompt** (built from previous blocks):
```
User Query: What is your refund policy?

Knowledge Base Context:
Customers can request a full refund within 30 days of purchase. Refunds are processed within 5-7 business days after we receive the returned item.
---
To initiate a refund, contact our support team at support@company.com with your order number.
---
Items must be in original condition with tags attached for refund eligibility.

Please provide a helpful response based on the context above.
```

**Messages Array**:
```typescript
[
  {
    role: "system",
    content: "You are a customer support assistant..."
  },
  {
    role: "user",
    content: "User Query: What is your refund policy?\n\nKnowledge Base Context:\n..."
  }
]
```

**Execution**:
1. **Initial API Call** → OpenAI GPT-4o
2. **No Tool Calls** (none configured)
3. **Response Generated**

**Output**:
```json
{
  "content": "Our refund policy allows customers to request a full refund within 30 days of purchase. To be eligible, items must be in original condition with tags attached. Refunds are processed within 5-7 business days after we receive the returned item. To initiate a refund, please contact our support team at support@company.com with your order number.",
  "model": "gpt-4o",
  "tokens": {
    "prompt": 245,
    "completion": 58,
    "total": 303
  },
  "cost": {
    "input": 0.00245,
    "output": 0.00116,
    "total": 0.00361
  }
}
```

**Execution Time**: 1250ms

---

#### **Block 4: Evaluator**

**Prompt Construction**:

**Metrics Configuration**:
```json
[
  {
    "name": "Accuracy",
    "description": "Factually correct based on source material",
    "range": { "min": 0, "max": 10 }
  },
  {
    "name": "Completeness",
    "description": "Addresses all aspects of the question",
    "range": { "min": 0, "max": 10 }
  },
  {
    "name": "Clarity",
    "description": "Easy to understand",
    "range": { "min": 0, "max": 10 }
  }
]
```

**System Prompt**:
```
You are an objective evaluation agent. Analyze the content against the provided metrics and provide detailed scoring.

Metrics to evaluate:
- Accuracy (0-10): Factually correct based on source material
- Completeness (0-10): Addresses all aspects of the question
- Clarity (0-10): Easy to understand

Content to evaluate:
Our refund policy allows customers to request a full refund within 30 days of purchase. To be eligible, items must be in original condition with tags attached. Refunds are processed within 5-7 business days after we receive the returned item. To initiate a refund, please contact our support team at support@company.com with your order number.

Return JSON only with metric scores. No explanations.
```

**Response Format**:
```json
{
  "name": "evaluation_response",
  "strict": true,
  "schema": {
    "type": "object",
    "properties": {
      "accuracy": { "type": "number" },
      "completeness": { "type": "number" },
      "clarity": { "type": "number" }
    },
    "required": ["accuracy", "completeness", "clarity"],
    "additionalProperties": false
  }
}
```

**Output**:
```json
{
  "content": "Our refund policy allows...",
  "model": "gpt-4o",
  "accuracy": 9,
  "completeness": 8,
  "clarity": 9,
  "tokens": { "prompt": 180, "completion": 12, "total": 192 },
  "cost": { "total": 0.00204 }
}
```

**Execution Time**: 800ms

---

#### **Block 5: Router**

**Prompt Construction**:

**Routing Instruction**:
```
Route to "Standard Response" if accuracy >= 8, otherwise route to "Needs Review"
```

**Target Blocks**:
```json
[
  {
    "id": "response-standard",
    "type": "response",
    "title": "Standard Response",
    "description": "Send standard response to user",
    "systemPrompt": null
  },
  {
    "id": "response-review",
    "type": "response",
    "title": "Needs Review",
    "description": "Flag for human review",
    "systemPrompt": null
  }
]
```

**System Prompt** (auto-generated):
```
You are an intelligent routing agent responsible for directing workflow requests to the most appropriate block.

Available Target Blocks:

ID: response-standard
Type: response
Title: Standard Response
Description: Send standard response to user
---

ID: response-review
Type: response
Title: Needs Review
Description: Flag for human review
---

Routing Request: Route to "Standard Response" if accuracy >= 8, otherwise route to "Needs Review"

Response Format:
Return ONLY the destination id as a single word, lowercase, no punctuation or explanation.
```

**AI Analysis**:
- Evaluator output shows `accuracy: 9`
- Condition: accuracy >= 8 → **TRUE**
- Selected block: "Standard Response"

**Output**:
```json
{
  "selectedPath": {
    "blockId": "response-standard",
    "blockType": "response",
    "blockTitle": "Standard Response"
  },
  "selectedRoute": "response-standard",
  "model": "gpt-4o",
  "tokens": { "prompt": 320, "completion": 8, "total": 328 },
  "cost": { "total": 0.00336 }
}
```

**Execution Time**: 600ms

**Decision Update**:
```typescript
ctx.decisions.router.set("router-1", "response-standard")
// Only "Standard Response" block will execute
// "Needs Review" block will be skipped
```

---

#### **Block 6: Standard Response** (Chosen Path)

**Input** (from previous blocks):
```typescript
{
  message: blockData["agent-1"].content,
  metadata: {
    accuracy: blockData["evaluator-1"].accuracy,
    completeness: blockData["evaluator-1"].completeness,
    clarity: blockData["evaluator-1"].clarity,
    sources: blockData["knowledge-1"].results.map(r => r.documentName)
  }
}
```

**Output**:
```json
{
  "message": "Our refund policy allows customers to request a full refund within 30 days of purchase. To be eligible, items must be in original condition with tags attached. Refunds are processed within 5-7 business days after we receive the returned item. To initiate a refund, please contact our support team at support@company.com with your order number.",
  "confidence": 0.9,
  "qualityScores": {
    "accuracy": 9,
    "completeness": 8,
    "clarity": 9
  },
  "sources": ["refund_policy.pdf"],
  "timestamp": "2025-11-15T10:00:03.100Z"
}
```

**Execution Time**: 50ms

---

### Workflow Summary

**Total Execution Time**: 3150ms (3.15 seconds)

**Block Execution Order**:
1. Trigger → 0ms
2. Knowledge Search → 450ms
3. Agent → 1250ms
4. Evaluator → 800ms
5. Router → 600ms
6. Standard Response → 50ms

**Total AI Costs**: $0.00901

**Token Usage**:
- Knowledge embedding: ~20 tokens
- Agent: 303 tokens
- Evaluator: 192 tokens
- Router: 328 tokens
- **Total**: 843 tokens

**Data Flow Summary**:
```
User Query
    ↓
Knowledge Base → Retrieved Context
    ↓
Agent (receives context) → AI Response
    ↓
Evaluator (receives response) → Quality Scores
    ↓
Router (receives scores) → Path Selection
    ↓
Standard Response (receives everything) → Final Output
```

**Block Data Available at Each Step**:

```typescript
// At Agent block:
blockData = {
  "trigger-1": { query: "What is your refund policy?" },
  "knowledge-1": { results: [...], query: "..." }
}

// At Evaluator block:
blockData = {
  "trigger-1": { query: "..." },
  "knowledge-1": { results: [...] },
  "agent-1": { content: "Our refund policy...", tokens: {...} }
}

// At Router block:
blockData = {
  "trigger-1": { query: "..." },
  "knowledge-1": { results: [...] },
  "agent-1": { content: "...", tokens: {...} },
  "evaluator-1": { accuracy: 9, completeness: 8, clarity: 9 }
}

// At Final Response block:
blockData = {
  // All previous blocks available
  "trigger-1": { ... },
  "knowledge-1": { ... },
  "agent-1": { ... },
  "evaluator-1": { ... },
  "router-1": { selectedPath: {...} }
}
```

---

## Key Concepts

### 1. Block Data Collection

All previous block outputs are automatically collected and made available to subsequent blocks via `blockData` and `blockNameMapping`:

```typescript
// Access by ID
const prevOutput = blockData["block-id-123"]

// Access by name
const prevOutput = blockData[blockNameMapping["My Block Name"]]
```

### 2. Tool Execution Context

Tools receive comprehensive context:
- `blockData`: All previous outputs
- `environmentVariables`: Env vars
- `workflowVariables`: Workflow-specific vars
- `workflowId`, `workspaceId`: Metadata

### 3. Prompt Construction Patterns

1. **Static Prompts**: Defined in block configuration
2. **Dynamic Prompts**: Generated from previous block data
3. **Meta-Prompts**: Prompts that generate other prompts (wand feature)

### 4. Routing & Branching

- **Router Block**: AI-powered path selection
- **Condition Block**: Boolean logic branching
- **Loop Block**: Iterative execution
- **Parallel Block**: Concurrent execution

### 5. Structured Outputs

Use `responseFormat` (JSON Schema) to enforce structured data:
- Agent responses → structured fields
- Evaluator scores → numeric metrics
- Tool results → typed outputs

---

*Documentation generated on 2025-11-15*

