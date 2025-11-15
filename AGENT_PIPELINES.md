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
