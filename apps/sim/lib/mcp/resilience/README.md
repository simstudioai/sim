### Part 1: Telemetry Hooks
Implement the foundation for tracking.
*(Change Rationale: Transitioning to a middleware pattern instead of a monolithic proxy, allowing telemetry to be composed easily).*
#### [NEW] `apps/sim/lib/mcp/resilience/telemetry.ts`
- Implement telemetry middleware hook to capture `latency_ms` and `failure_reason` (e.g., `TIMEOUT`, `VALIDATION_ERROR`, `API_500`).

### Part 2: Circuit Breaker State Machine
Implement the state management logic.
*(Change Rationale: Added a HALF-OPEN concurrency lock (semaphore) to prevent the "thundering herd" issue on the downstream server. Documented that this operates on local, per-instance state using an LRU cache to prevent memory leaks).*
#### [NEW] `apps/sim/lib/mcp/resilience/circuit-breaker.ts`
- Implement the `CircuitBreaker` middleware with states: `CLOSED`, `OPEN`, and `HALF-OPEN`.
- Handle failure thresholds, reset timeouts, and logic for failing fast.
- **Concurrency Lock:** During `HALF-OPEN`, strictly gate the transition so only **one** probe request is allowed through. All other concurrent requests will fail-fast until the probe resolves.
- **Memory & State:** Use an LRU cache or scoped ties for the CircuitBreaker registry, binding the lifecycle of the breaker explicitly to the lifecycle of the MCP connection to prevent memory leaks. Also, this operates on local, per-instance state.

### Part 3: Schema Validation
Implement the Zod validation logic for LLM arguments.
*(Change Rationale: Added schema compilation caching to avoid severe CPU bottlenecking per request, and returning `isError: true` on validation failures to natively trigger LLM self-correction).*
#### [NEW] `apps/sim/lib/mcp/resilience/schema-validator.ts`
- Logic to enforce schemas using `Zod` as a middleware.
- **Schema Caching:** Compile JSON Schemas to Zod schemas and cache them in a registry mapped to `toolId` during the initial discovery phase or lazily on first compile. Flush cached validators dynamically when listening for MCP lifecycle events (e.g., mid-session tool list updates).
- **LLM Self-Correction:** Instead of throwing exceptions that crash the workflow engine when Zod validation fails, intercept validation errors and return a gracefully formatted MCP execution result: `{ isError: true, content: [{ type: "text", text: "Schema validation failed: [Zod Error Details]" }] }`.

### Part 4: Resilience Pipeline Integration
Wrap up the tools via a Pipeline instead of a monolithic proxy.
*(Change Rationale: Switched from a God Object Proxy to a Middleware Pipeline to support granular, per-tool enablement).*
#### [NEW] `apps/sim/lib/mcp/resilience/pipeline.ts`
- Implement a chain of responsibility (interceptor/middleware pipeline) for `executeTool`.
- Provide an API like `executeTool.use(telemetry).use(validate(cachedSchema)).use(circuitBreaker(config))` rather than a sequential sequence inside a rigid class.
- This composable architecture allows enabling or disabling specific middlewares dynamically per tool (e.g., un-trusted vs internal tools).

#### [MODIFY] `apps/sim/lib/mcp/service.ts`
- Update `mcpService.executeTool` to run requests through the configurable `ResiliencePipeline`, rather than hardcoded proxy logic.

## Verification Plan
### Automated Tests
- Create a mock MCP server execution test suite.
- Write tests in `apps/sim/lib/mcp/resilience/pipeline.test.ts` to assert:
  - Circuit Breaker trips to `OPEN` on simulated `API_500` and trips to `HALF-OPEN` after a cooldown.
  - **New Test:** Verify HALF-OPEN strictly allows exactly **one** simulated concurrent probe request through.
  - **New Test:** Schema validation returns `isError: true` standard format for improper LLM args without triggering execution.
- Telemetry correctly logs latency.

### Manual Verification
- Execute tests generating visual output demonstrating the circuit breaker "tripping" and "recovering".
