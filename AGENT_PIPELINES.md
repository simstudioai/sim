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
