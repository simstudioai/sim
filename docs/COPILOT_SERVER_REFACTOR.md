# Copilot Server-Side Refactor Plan

> **Goal**: Move copilot orchestration logic from the browser (React/Zustand) to the Next.js server, enabling both headless API access and a simplified interactive client.

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture](#current-architecture)
3. [Target Architecture](#target-architecture)
4. [Scope & Boundaries](#scope--boundaries)
5. [Module Design](#module-design)
6. [Implementation Plan](#implementation-plan)
7. [API Contracts](#api-contracts)
8. [Migration Strategy](#migration-strategy)
9. [Testing Strategy](#testing-strategy)
10. [Risks & Mitigations](#risks--mitigations)
11. [File Inventory](#file-inventory)

---

## Executive Summary

### Problem

The current copilot implementation in Sim has all orchestration logic in the browser:
- SSE stream parsing happens in the React client
- Tool execution is triggered from the browser
- OAuth tokens are sent to the client
- No headless/API access is possible
- The Zustand store is ~4,200 lines of complex async logic

### Solution

Move orchestration to the Next.js server:
- Server parses SSE from copilot backend
- Server executes tools directly (no HTTP round-trips)
- Server forwards events to client (if attached)
- Headless API returns JSON response
- Client store becomes a thin UI layer (~600 lines)

### Benefits

| Aspect | Before | After |
|--------|--------|-------|
| Security | OAuth tokens in browser | Tokens stay server-side |
| Headless access | Not possible | Full API support |
| Store complexity | ~4,200 lines | ~600 lines |
| Tool execution | Browser-initiated | Server-side |
| Testing | Complex async | Simple state |
| Bundle size | Large (tool classes) | Minimal |

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (React)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    Copilot Store (4,200 lines)                          ││
│  │                                                                         ││
│  │  • SSE stream parsing (parseSSEStream)                                  ││
│  │  • Event handlers (sseHandlers, subAgentSSEHandlers)                    ││
│  │  • Tool execution logic                                                 ││
│  │  • Client tool instantiation                                            ││
│  │  • Content block processing                                             ││
│  │  • State management                                                     ││
│  │  • UI state                                                             ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│         │                                                                   │
│         │ HTTP calls for tool execution                                     │
│         ▼                                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           NEXT.JS SERVER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  /api/copilot/chat              - Proxy to copilot backend (pass-through)   │
│  /api/copilot/execute-tool      - Execute integration tools                 │
│  /api/copilot/confirm           - Update Redis with tool status             │
│  /api/copilot/tools/mark-complete - Notify copilot backend                  │
│  /api/copilot/execute-copilot-server-tool - Execute server tools            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        COPILOT BACKEND (Go)                                  │
│                         copilot.sim.ai                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  • LLM orchestration                                                        │
│  • Subagent system (plan, edit, debug, etc.)                                │
│  • Tool definitions                                                         │
│  • Conversation management                                                  │
│  • SSE streaming                                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Current Flow (Interactive)

1. User sends message in UI
2. Store calls `/api/copilot/chat`
3. Chat route proxies to copilot backend, streams SSE back
4. **Store parses SSE in browser**
5. On `tool_call` event:
   - Store decides if tool needs confirmation
   - Store calls `/api/copilot/execute-tool` or `/api/copilot/execute-copilot-server-tool`
   - Store calls `/api/copilot/tools/mark-complete`
6. Store updates UI state

### Problems with Current Flow

1. **No headless access**: Must have browser client
2. **Security**: OAuth tokens sent to browser for tool execution
3. **Complexity**: All orchestration logic in Zustand store
4. **Performance**: Multiple HTTP round-trips from browser
5. **Reliability**: Browser can disconnect mid-operation
6. **Testing**: Hard to test async browser logic

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (React)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    Copilot Store (~600 lines)                           ││
│  │                                                                         ││
│  │  • UI state (messages, toolCalls display)                               ││
│  │  • Event listener (receive server events)                               ││
│  │  • User actions (send message, confirm/reject)                          ││
│  │  • Simple API calls                                                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│         │                                                                   │
│         │ SSE events from server                                            │
│         │                                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
          ▲
          │ (Optional - headless mode has no client)
          │
┌─────────────────────────────────────────────────────────────────────────────┐
│                           NEXT.JS SERVER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    Orchestrator Module (NEW)                            ││
│  │                    lib/copilot/orchestrator/                            ││
│  │                                                                         ││
│  │  • SSE stream parsing                                                   ││
│  │  • Event handlers                                                       ││
│  │  • Tool execution (direct function calls)                               ││
│  │  • Response building                                                    ││
│  │  • Event forwarding (to client if attached)                             ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│         │                                                                   │
│  ┌──────┴──────┐                                                            │
│  │             │                                                            │
│  ▼             ▼                                                            │
│  /api/copilot/chat        /api/v1/copilot/chat                              │
│  (Interactive)            (Headless)                                        │
│  - Session auth           - API key auth                                    │
│  - SSE to client          - JSON response                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          │ (Single external HTTP call)
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        COPILOT BACKEND (Go)                                  │
│                    (UNCHANGED - no modifications)                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Target Flow (Headless)

1. External client calls `POST /api/v1/copilot/chat` with API key
2. Orchestrator calls copilot backend
3. **Server parses SSE stream**
4. **Server executes tools directly** (no HTTP)
5. Server notifies copilot backend (mark-complete)
6. Server returns JSON response

### Target Flow (Interactive)

1. User sends message in UI
2. Store calls `/api/copilot/chat`
3. **Server orchestrates everything**
4. Server forwards events to client via SSE
5. Client just updates UI from events
6. Server returns when complete

---

## Scope & Boundaries

### In Scope

| Item | Description |
|------|-------------|
| Orchestrator module | New module in `lib/copilot/orchestrator/` |
| Headless API route | New route `POST /api/v1/copilot/chat` |
| SSE parsing | Move from store to server |
| Tool execution | Direct function calls on server |
| Event forwarding | SSE to client (interactive mode) |
| Store simplification | Reduce to UI-only logic |

### Out of Scope

| Item | Reason |
|------|--------|
| Copilot backend (Go) | Separate repo, working correctly |
| Tool definitions | Already work, just called differently |
| LLM providers | Handled by copilot backend |
| Subagent system | Handled by copilot backend |

### Boundaries

```
                    ┌─────────────────────────────────────┐
                    │         MODIFICATION ZONE           │
                    │                                     │
   ┌────────────────┼─────────────────────────────────────┼────────────────┐
   │                │                                     │                │
   │  UNCHANGED     │   apps/sim/                         │   UNCHANGED    │
   │                │   ├── lib/copilot/orchestrator/     │                │
   │  copilot/      │   │   └── (NEW)                     │   apps/sim/    │
   │  (Go backend)  │   ├── app/api/v1/copilot/           │   tools/       │
   │                │   │   └── (NEW)                     │   (definitions)│
   │                │   ├── app/api/copilot/chat/         │                │
   │                │   │   └── (MODIFIED)                │                │
   │                │   └── stores/panel/copilot/         │                │
   │                │       └── (SIMPLIFIED)              │                │
   │                │                                     │                │
   └────────────────┼─────────────────────────────────────┼────────────────┘
                    │                                     │
                    └─────────────────────────────────────┘
```

---

## Module Design

### Directory Structure

```
apps/sim/lib/copilot/orchestrator/
├── index.ts              # Main orchestrator function
├── types.ts              # Type definitions
├── sse-parser.ts         # Parse SSE stream from copilot backend
├── sse-handlers.ts       # Handle each SSE event type
├── tool-executor.ts      # Execute tools directly (no HTTP)
├── persistence.ts        # Database and Redis operations
└── response-builder.ts   # Build final response
```

### Module Responsibilities

#### `types.ts`

Defines all types used by the orchestrator:

```typescript
// SSE Events
interface SSEEvent { type, data, subagent?, toolCallId?, toolName? }
type SSEEventType = 'content' | 'tool_call' | 'tool_result' | 'done' | ...

// Tool State
interface ToolCallState { id, name, status, params?, result?, error? }
type ToolCallStatus = 'pending' | 'executing' | 'success' | 'error' | 'skipped'

// Streaming Context (internal state during orchestration)
interface StreamingContext { 
  chatId?, conversationId?, messageId
  accumulatedContent, contentBlocks
  toolCalls: Map<string, ToolCallState>
  streamComplete, errors[]
}

// Orchestrator API
interface OrchestratorRequest { message, workflowId, userId, chatId?, mode?, ... }
interface OrchestratorOptions { autoExecuteTools?, onEvent?, timeout?, ... }
interface OrchestratorResult { success, content, toolCalls[], chatId?, error? }

// Execution Context (passed to tool executors)
interface ExecutionContext { userId, workflowId, workspaceId?, decryptedEnvVars? }
```

#### `sse-parser.ts`

Parses SSE stream into typed events:

```typescript
async function* parseSSEStream(
  reader: ReadableStreamDefaultReader,
  decoder: TextDecoder,
  abortSignal?: AbortSignal
): AsyncGenerator<SSEEvent>
```

- Handles buffering for partial lines
- Parses JSON from `data:` lines
- Yields typed `SSEEvent` objects
- Supports abort signal

#### `sse-handlers.ts`

Handles each SSE event type:

```typescript
const sseHandlers: Record<SSEEventType, SSEHandler> = {
  content: (event, context) => { /* append to accumulated content */ },
  tool_call: async (event, context, execContext, options) => { 
    /* track tool, execute if autoExecuteTools */ 
  },
  tool_result: (event, context) => { /* update tool status */ },
  tool_generating: (event, context) => { /* create pending tool */ },
  reasoning: (event, context) => { /* handle thinking blocks */ },
  done: (event, context) => { /* mark stream complete */ },
  error: (event, context) => { /* record error */ },
  // ... etc
}

const subAgentHandlers: Record<SSEEventType, SSEHandler> = {
  // Handlers for events within subagent context
}
```

#### `tool-executor.ts`

Executes tools directly without HTTP:

```typescript
// Main entry point
async function executeToolServerSide(
  toolCall: ToolCallState,
  context: ExecutionContext
): Promise<ToolCallResult>

// Server tools (edit_workflow, search_documentation, etc.)
async function executeServerToolDirect(
  toolName: string,
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult>

// Integration tools (slack_send, gmail_read, etc.)
async function executeIntegrationToolDirect(
  toolCallId: string,
  toolName: string,
  toolConfig: ToolConfig,
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolCallResult>

// Notify copilot backend (external HTTP - required)
async function markToolComplete(
  toolCallId: string,
  toolName: string,
  status: number,
  message?: any,
  data?: any
): Promise<boolean>

// Prepare cached context for tool execution
async function prepareExecutionContext(
  userId: string,
  workflowId: string
): Promise<ExecutionContext>
```

**Key principle**: Internal tool execution uses direct function calls. Only `markToolComplete` makes HTTP call (to copilot backend - external).

#### `persistence.ts`

Database and Redis operations:

```typescript
// Chat persistence
async function createChat(params): Promise<{ id: string }>
async function loadChat(chatId, userId): Promise<Chat | null>
async function saveMessages(chatId, messages, options?): Promise<void>
async function updateChatConversationId(chatId, conversationId): Promise<void>

// Tool confirmation (Redis)
async function setToolConfirmation(toolCallId, status, message?): Promise<boolean>
async function getToolConfirmation(toolCallId): Promise<Confirmation | null>
```

#### `index.ts`

Main orchestrator function:

```typescript
async function orchestrateCopilotRequest(
  request: OrchestratorRequest,
  options: OrchestratorOptions = {}
): Promise<OrchestratorResult> {
  
  // 1. Prepare execution context (cache env vars, etc.)
  const execContext = await prepareExecutionContext(userId, workflowId)
  
  // 2. Handle chat creation/loading
  let chatId = await resolveChat(request)
  
  // 3. Build request payload for copilot backend
  const payload = buildCopilotPayload(request)
  
  // 4. Call copilot backend
  const response = await fetch(COPILOT_URL, { body: JSON.stringify(payload) })
  
  // 5. Create streaming context
  const context = createStreamingContext(chatId)
  
  // 6. Parse and handle SSE stream
  for await (const event of parseSSEStream(response.body)) {
    // Forward to client if attached
    options.onEvent?.(event)
    
    // Handle event
    const handler = getHandler(event)
    await handler(event, context, execContext, options)
    
    if (context.streamComplete) break
  }
  
  // 7. Persist to database
  await persistChat(chatId, context)
  
  // 8. Build and return result
  return buildResult(context)
}
```

---

## Implementation Plan

### Phase 1: Create Orchestrator Module (3-4 days)

**Goal**: Build the orchestrator module that can run independently.

#### Tasks

1. **Create `types.ts`** (~200 lines)
   - [ ] Define SSE event types
   - [ ] Define tool call state types
   - [ ] Define streaming context type
   - [ ] Define orchestrator request/response types
   - [ ] Define execution context type

2. **Create `sse-parser.ts`** (~80 lines)
   - [ ] Extract parsing logic from store.ts
   - [ ] Add abort signal support
   - [ ] Add error handling

3. **Create `persistence.ts`** (~120 lines)
   - [ ] Extract DB operations from chat route
   - [ ] Extract Redis operations from confirm route
   - [ ] Add chat creation/loading
   - [ ] Add message saving

4. **Create `tool-executor.ts`** (~300 lines)
   - [ ] Create `executeToolServerSide()` main entry
   - [ ] Create `executeServerToolDirect()` for server tools
   - [ ] Create `executeIntegrationToolDirect()` for integration tools
   - [ ] Create `markToolComplete()` for copilot backend notification
   - [ ] Create `prepareExecutionContext()` for caching
   - [ ] Handle OAuth token resolution
   - [ ] Handle env var resolution

5. **Create `sse-handlers.ts`** (~350 lines)
   - [ ] Extract handlers from store.ts
   - [ ] Adapt for server-side context
   - [ ] Add tool execution integration
   - [ ] Add subagent handlers

6. **Create `index.ts`** (~250 lines)
   - [ ] Create `orchestrateCopilotRequest()` main function
   - [ ] Wire together all modules
   - [ ] Add timeout handling
   - [ ] Add abort signal support
   - [ ] Add event forwarding

#### Deliverables

- Complete `lib/copilot/orchestrator/` module
- Unit tests for each component
- Integration test for full orchestration

### Phase 2: Create Headless API Route (1 day)

**Goal**: Create API endpoint for headless copilot access.

#### Tasks

1. **Create route** `app/api/v1/copilot/chat/route.ts` (~100 lines)
   - [ ] Add API key authentication
   - [ ] Parse and validate request
   - [ ] Call orchestrator
   - [ ] Return JSON response

2. **Add to API documentation**
   - [ ] Document request format
   - [ ] Document response format
   - [ ] Document error codes

#### Deliverables

- Working `POST /api/v1/copilot/chat` endpoint
- API documentation
- E2E test

### Phase 3: Wire Interactive Route (2 days)

**Goal**: Use orchestrator for existing interactive flow.

#### Tasks

1. **Modify `/api/copilot/chat/route.ts`**
   - [ ] Add feature flag for new vs old flow
   - [ ] Call orchestrator with `onEvent` callback
   - [ ] Forward events to client via SSE
   - [ ] Maintain backward compatibility

2. **Test both flows**
   - [ ] Verify interactive works with new orchestrator
   - [ ] Verify old flow still works (feature flag off)

#### Deliverables

- Interactive route using orchestrator
- Feature flag for gradual rollout
- No breaking changes

### Phase 4: Simplify Client Store (2-3 days)

**Goal**: Remove orchestration logic from client, keep UI-only.

#### Tasks

1. **Create simplified store** (new file or gradual refactor)
   - [ ] Keep: UI state, messages, tool display
   - [ ] Keep: Simple API calls
   - [ ] Keep: Event listener
   - [ ] Remove: SSE parsing
   - [ ] Remove: Tool execution logic
   - [ ] Remove: Client tool instantiators

2. **Update components**
   - [ ] Update components to use simplified store
   - [ ] Remove tool execution from UI components
   - [ ] Simplify tool display components

3. **Remove dead code**
   - [ ] Remove unused imports
   - [ ] Remove unused helper functions
   - [ ] Remove client tool classes (if no longer needed)

#### Deliverables

- Simplified store (~600 lines)
- Updated components
- Reduced bundle size

### Phase 5: Testing & Polish (2-3 days)

#### Tasks

1. **E2E testing**
   - [ ] Test headless API with various prompts
   - [ ] Test interactive with various prompts
   - [ ] Test tool execution scenarios
   - [ ] Test error handling
   - [ ] Test abort/timeout scenarios

2. **Performance testing**
   - [ ] Compare latency (old vs new)
   - [ ] Check memory usage
   - [ ] Check for connection issues

3. **Documentation**
   - [ ] Update developer docs
   - [ ] Add architecture diagram
   - [ ] Document new API

#### Deliverables

- Comprehensive test suite
- Performance benchmarks
- Complete documentation

---

## API Contracts

### Headless API

#### Request

```http
POST /api/v1/copilot/chat
Content-Type: application/json
X-API-Key: sim_xxx

{
  "message": "Create a Slack notification workflow",
  "workflowId": "wf_abc123",
  "chatId": "chat_xyz",           // Optional: continue existing chat
  "mode": "agent",                // Optional: "agent" | "ask" | "plan"
  "model": "claude-4-sonnet",     // Optional
  "autoExecuteTools": true,       // Optional: default true
  "timeout": 300000               // Optional: default 5 minutes
}
```

#### Response (Success)

```json
{
  "success": true,
  "content": "I've created a Slack notification workflow that...",
  "toolCalls": [
    {
      "id": "tc_001",
      "name": "search_patterns",
      "status": "success",
      "params": { "query": "slack notification" },
      "result": { "patterns": [...] },
      "durationMs": 234
    },
    {
      "id": "tc_002",
      "name": "edit_workflow",
      "status": "success",
      "params": { "operations": [...] },
      "result": { "blocksAdded": 3 },
      "durationMs": 1523
    }
  ],
  "chatId": "chat_xyz",
  "conversationId": "conv_123"
}
```

#### Response (Error)

```json
{
  "success": false,
  "error": "Workflow not found",
  "content": "",
  "toolCalls": []
}
```

#### Error Codes

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Invalid request | Missing required fields |
| 401 | Unauthorized | Invalid or missing API key |
| 404 | Workflow not found | Workflow ID doesn't exist |
| 500 | Internal error | Server-side failure |
| 504 | Timeout | Request exceeded timeout |

### Interactive API (Existing - Modified)

The existing `/api/copilot/chat` endpoint continues to work but now uses the orchestrator internally. SSE events forwarded to client remain the same format.

---

## Migration Strategy

### Rollout Plan

```
Week 1: Phase 1 (Orchestrator)
├── Day 1-2: Types + SSE Parser
├── Day 3: Tool Executor
└── Day 4-5: Handlers + Main Orchestrator

Week 2: Phase 2-3 (Routes)
├── Day 1: Headless API route
├── Day 2-3: Wire interactive route
└── Day 4-5: Testing both modes

Week 3: Phase 4-5 (Cleanup)
├── Day 1-3: Simplify store
├── Day 4: Testing
└── Day 5: Documentation
```

### Feature Flags

```typescript
// lib/copilot/config.ts

export const COPILOT_FLAGS = {
  // Use new orchestrator for interactive mode
  USE_SERVER_ORCHESTRATOR: process.env.COPILOT_USE_SERVER_ORCHESTRATOR === 'true',
  
  // Enable headless API
  ENABLE_HEADLESS_API: process.env.COPILOT_ENABLE_HEADLESS_API === 'true',
}
```

### Rollback Plan

If issues arise:
1. Set `COPILOT_USE_SERVER_ORCHESTRATOR=false`
2. Interactive mode falls back to old client-side flow
3. Headless API returns 503 Service Unavailable

---

## Testing Strategy

### Unit Tests

```
lib/copilot/orchestrator/
├── __tests__/
│   ├── sse-parser.test.ts
│   ├── sse-handlers.test.ts
│   ├── tool-executor.test.ts
│   ├── persistence.test.ts
│   └── index.test.ts
```

#### SSE Parser Tests

```typescript
describe('parseSSEStream', () => {
  it('parses content events')
  it('parses tool_call events')
  it('handles partial lines')
  it('handles malformed JSON')
  it('respects abort signal')
})
```

#### Tool Executor Tests

```typescript
describe('executeToolServerSide', () => {
  it('executes server tools directly')
  it('executes integration tools with OAuth')
  it('resolves env var references')
  it('handles tool not found')
  it('handles execution errors')
})
```

### Integration Tests

```typescript
describe('orchestrateCopilotRequest', () => {
  it('handles simple message without tools')
  it('handles message with single tool call')
  it('handles message with multiple tool calls')
  it('handles subagent tool calls')
  it('handles stream errors')
  it('respects timeout')
  it('forwards events to callback')
})
```

### E2E Tests

```typescript
describe('POST /api/v1/copilot/chat', () => {
  it('returns 401 without API key')
  it('returns 400 with invalid request')
  it('executes simple ask query')
  it('executes workflow modification')
  it('handles tool execution')
})
```

---

## Risks & Mitigations

### Risk 1: Breaking Interactive Mode

**Risk**: Refactoring could break existing interactive copilot.

**Mitigation**:
- Feature flag for gradual rollout
- Keep old code path available
- Extensive E2E testing
- Staged deployment (internal → beta → production)

### Risk 2: Tool Execution Differences

**Risk**: Tool behavior differs between client and server execution.

**Mitigation**:
- Reuse existing tool execution logic (same functions)
- Compare outputs in parallel testing
- Log discrepancies for investigation

### Risk 3: Performance Regression

**Risk**: Server-side orchestration could be slower.

**Mitigation**:
- Actually should be faster (no browser round-trips)
- Benchmark before/after
- Profile critical paths

### Risk 4: Memory Usage

**Risk**: Server accumulates state during long-running requests.

**Mitigation**:
- Set reasonable timeouts
- Clean up context after request
- Monitor memory in production

### Risk 5: Connection Issues

**Risk**: Long-running SSE connections could drop.

**Mitigation**:
- Implement reconnection logic
- Save checkpoints to resume
- Handle partial completions gracefully

---

## File Inventory

### New Files

| File | Lines | Description |
|------|-------|-------------|
| `lib/copilot/orchestrator/types.ts` | ~200 | Type definitions |
| `lib/copilot/orchestrator/sse-parser.ts` | ~80 | SSE stream parsing |
| `lib/copilot/orchestrator/sse-handlers.ts` | ~350 | Event handlers |
| `lib/copilot/orchestrator/tool-executor.ts` | ~300 | Tool execution |
| `lib/copilot/orchestrator/persistence.ts` | ~120 | DB/Redis operations |
| `lib/copilot/orchestrator/index.ts` | ~250 | Main orchestrator |
| `app/api/v1/copilot/chat/route.ts` | ~100 | Headless API |
| **Total New** | **~1,400** | |

### Modified Files

| File | Change |
|------|--------|
| `app/api/copilot/chat/route.ts` | Use orchestrator (optional) |
| `stores/panel/copilot/store.ts` | Simplify to ~600 lines |

### Deleted Code (from store.ts)

| Section | Lines Removed |
|---------|---------------|
| SSE parsing logic | ~150 |
| `sseHandlers` object | ~750 |
| `subAgentSSEHandlers` | ~280 |
| Tool execution logic | ~400 |
| Client tool instantiators | ~120 |
| Content block helpers | ~200 |
| Streaming context | ~100 |
| **Total Removed** | **~2,000** |

### Net Change

```
New code:      +1,400 lines (orchestrator module)
Removed code:  -2,000 lines (from store)
Modified code: ~200 lines (route changes)
───────────────────────────────────────
Net change:    -400 lines (cleaner, more maintainable)
```

---

## Appendix: Code Extraction Map

### From `stores/panel/copilot/store.ts`

| Source Lines | Destination | Notes |
|--------------|-------------|-------|
| 900-1050 (parseSSEStream) | `sse-parser.ts` | Adapt for server |
| 1120-1867 (sseHandlers) | `sse-handlers.ts` | Remove Zustand deps |
| 1940-2217 (subAgentSSEHandlers) | `sse-handlers.ts` | Merge with above |
| 1365-1583 (tool execution) | `tool-executor.ts` | Direct calls |
| 330-380 (StreamingContext) | `types.ts` | Clean up |
| 3328-3648 (handleStreamingResponse) | `index.ts` | Main loop |

### From `app/api/copilot/execute-tool/route.ts`

| Source Lines | Destination | Notes |
|--------------|-------------|-------|
| 30-247 (POST handler) | `tool-executor.ts` | Extract core logic |

### From `app/api/copilot/confirm/route.ts`

| Source Lines | Destination | Notes |
|--------------|-------------|-------|
| 28-89 (updateToolCallStatus) | `persistence.ts` | Redis operations |

---

## Approval & Sign-off

- [ ] Technical review complete
- [ ] Security review complete
- [ ] Performance impact assessed
- [ ] Rollback plan approved
- [ ] Testing plan approved

---

*Document created: January 2026*
*Last updated: January 2026*

