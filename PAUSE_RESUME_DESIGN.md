# Pause-Resume Architecture (2025 refresh)

## 1. Overview & Goals

We are introducing a pause-resume block that lets a workflow:
- return an intermediate response,
- persist its full execution state, and
- resume from the exact pause point when an external caller provides input.

Primary goals:
- **Zero regression** for existing executions (latency, logging, telemetry).
- **Layered architecture**: the core execution engine remains deterministic and database-agnostic.
- **Single source of truth**: one snapshot + one database row per execution, even with multiple pauses.
- **Deterministic resume chaining**: only one resume runs at a time; additional resumes queue FIFO.

## 2. Design Principles

1. **Keep the engine pure** – `ExecutionEngine` continues to manage only in-memory DAG traversal. It never talks to the database or queues.
2. **Orchestrate above the engine** – a new `PauseResumeManager` (invoked from `execution-core.ts`) handles persistence and queued resumes once the engine signals a pause.
3. **One snapshot, many pause points** – each execution stores a single serialized snapshot with a JSON map of pause contexts.
4. **Same pipeline for resume** – resume runs flow through `Executor.execute(...)` / `execution-core.ts`, ensuring logging, telemetry, and run-count updates behave identically to initial executions.
5. **Incremental type changes** – extend handler output and execution metadata just enough to describe pauses; non-pausing workflows remain unaffected.

## 3. System Components

### 3.1 Execution Engine (existing)
- Gains the ability to:
  - detect `_pauseMetadata` emitted by handlers,
  - accumulate pause descriptors in-memory,
  - return an `ExecutionResult` with `status: 'paused' | 'completed'` plus `pausePoints` and `snapshotSeed` when pauses are present.
- Stays unaware of persistence, networking, or resume queues.
- Only performs snapshot serialization on demand (when `pausedPoints.length > 0`).

### 3.2 PauseResumeManager (new, orchestrator layer)
- Lives alongside current orchestration in `apps/sim/lib/workflows/executor/execution-core.ts`.
- Responsibilities:
  1. On initial run completion:
     - If `result.status === 'paused'`: serialize snapshot, write to DB, log pause metadata, and enqueue pending resumes if necessary.
     - If `result.status === 'completed'`: update run counts and exit (existing behaviour).
  2. On resume API call:
     - Load paused execution row, validate context, and enqueue/claim a resume queue entry (using `SELECT FOR UPDATE`).
     - If granted immediately, call `executeFromSnapshot(...)` (see §3.3).
  3. After any run finishes (paused or completed):
     - Atomically check the resume queue; if entries exist, claim the next one and invoke another execution.
  4. Update pause point JSON (`resumeStatus`, timestamps, metadata) atomically.
- Exposes a narrow interface used both by API routes and the execution pipeline.

### 3.3 Snapshot Serializer (existing + extensions)
- `ExecutionSnapshot` is extended to include:
  - `pauseTriggerIds: string[]` (all `_trigger` blocks created during DAG transform),
  - `pendingQueue?: string[]` (set only when resuming),
  - complete maps for loop/parallel scopes, routing decisions, variables, etc.
- A helper `SnapshotSerializer` converts between runtime structures (Maps/Sets) and plain JSON.
- Serialization occurs only when pauses are detected, preserving hot-path performance.

### 3.4 Resume-aware Executor API
- Add `Executor.executeFromSnapshot({ snapshot, pendingBlocks, contextExtensions })` that:
  1. Restores block state/metadata into a fresh `ExecutionContext`.
  2. Calls the existing execution pipeline (`Executor.execute`) with a new execution ID.
- `Executor.continueExecution` is implemented atop this helper and used both for pause/resume and future debugger features.

### 3.5 PauseResumeBlock Handler updates
- Handler now returns:
  ```ts
  {
    response: { ... },
    _pauseMetadata: {
      contextId,
      triggerBlockId,
      response,
      blockId,
      timestamp,
    }
  }
  ```
- `BlockExecutor` passes DAG node metadata (loop/parallel context) into handlers that opt-in, enabling `contextId` generation.
- `_pauseMetadata` is optional; other handlers remain unchanged.

### 3.6 DAG Transformation
- NodeConstructor creates two virtual nodes per pause block:
  - `<blockId>__response` (type `pause_resume_response`, terminal block executed during initial run).
  - `<blockId>__trigger` (type `pause_resume_trigger`, dormant until resume).
- Outgoing edges from the original pause block are rewired to originate from `_trigger`.
- `_response` has no outgoing edges.
- `_trigger` is excluded from initial queue seeding (`ExecutionEngine.initializeQueue` skips nodes with `metadata.isResumeTrigger`). The manager injects trigger IDs into `pendingQueue` when resuming.
- Parallel/loop metadata is copied so context IDs remain unique (e.g., `pause₍branch₎__response`).

### 3.7 Type System Extensions
- `NormalizedBlockOutput` gains optional `_pauseMetadata`.
- `ExecutionContext.metadata` includes:
  - `status: 'running' | 'paused' | 'completed'`,
  - `pausePoints?: string[]`,
  - `resumeChain?: { parentExecutionId?: string; depth: number }`.
- `ExecutionResult` adds `status` and optional `pausePoints`, `snapshotSeedId`.
- All additions are optional to avoid impacting existing consumers.

## 4. Execution Lifecycle

### 4.1 Initial Run
1. `execution-core.ts` serializes the workflow and creates an `Executor` instance (unchanged).
2. `Executor.execute(workflowId)` runs the DAG; if the pause block is reached, the handler emits `_pauseMetadata`.
3. The engine drains the queue, aggregates pause metadata, constructs a snapshot, and returns `status: 'paused'` with `pausePoints` and `snapshotSeed`.
4. `execution-core.ts` hands control to `PauseResumeManager`:
   - Persist snapshot + pause points to `paused_executions` (single row per execution).
   - Record `paused` status in execution logs without incrementing run counts.
   - Respond to the caller with the pause payload (HTTP response from the block).

### 4.2 Resume Request
1. Client POSTs `/api/resume/{workflowId}/{executionId}/{contextId}` with optional input.
2. API route delegates to `PauseResumeManager.resume(...)`:
   - Locks the paused execution row,
   - Verifies the pause point is still `paused`,
   - Checks the resume queue for active entries.
3. If another resume is executing, a `pending` entry is inserted and the API responds `{ status: 'queued', queuePosition }`.
4. Otherwise, a `claimed` entry is created and `executeFromSnapshot` is invoked asynchronously (fire-and-forget to keep API latency low).

### 4.3 Resume Execution Flow
1. Manager loads the snapshot, converts it back to runtime structures, and injects the new execution ID.
2. The trigger block corresponding to `contextId` is pre-marked as executed with the resume input, and its node ID is supplied as the pending queue (`pendingBlocks`).
3. Execution proceeds through the same pipeline and can either reach completion or pause again.
4. On completion:
   - Execution logs, telemetry, and run counts update exactly once (for the execution that actually completes the workflow).
   - The manager marks the resume queue entry `completed` and updates pause point JSON (resumeStatus -> `resumed`, timestamps, metadata).
   - If all pause points are resumed, the row transitions to `fully_resumed` and can be deleted or archived later.
5. On a secondary pause:
   - The manager stores a **new** row in `paused_executions` keyed by the new execution ID, preserving the resume chain (`parent_execution_id`).

## 5. Database Schema

### 5.1 `paused_executions`
```sql
CREATE TABLE paused_executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  execution_id TEXT NOT NULL UNIQUE,
  execution_snapshot JSONB NOT NULL,
  pause_points JSONB NOT NULL,               -- { contextId: { response, triggerBlockId, resumeStatus, ... } }
  total_pause_count INTEGER NOT NULL,
  resumed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paused',    -- 'paused' | 'partially_resumed' | 'fully_resumed' | 'expired'
  metadata JSONB DEFAULT '{}',              -- e.g., { "pauseScope": "execution" }
  paused_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP
);
```

### 5.2 `resume_queue`
   ```sql
CREATE TABLE resume_queue (
  id TEXT PRIMARY KEY,
  paused_execution_id TEXT NOT NULL REFERENCES paused_executions(id) ON DELETE CASCADE,
  parent_execution_id TEXT NOT NULL,      -- immediate parent in the resume chain
  new_execution_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  resume_input JSONB,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'claimed' | 'completed' | 'failed'
  queued_at TIMESTAMP NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMP,
  completed_at TIMESTAMP,
  failure_reason TEXT
);

CREATE INDEX resume_queue_parent_idx ON resume_queue(parent_execution_id, status, queued_at);
CREATE INDEX resume_queue_new_exec_idx ON resume_queue(new_execution_id);
```

### 5.3 Execution Logs (`workflow_execution_logs`)
- Gains metadata fields for pause awareness:
  ```json
  {
    "status": "paused",
    "pausePoints": ["pause₍0₎", "pause₍1₎"],
    "resumeChain": {
      "parentExecutionId": "exec_123",
      "depth": 1
  }
}
```
- Only mark `status: 'completed'` when the final resume finishes and no queued resumes remain.

## 6. API & Background Maintenance

### 6.1 Endpoints
- `POST /api/resume/:workflowId/:executionId/:contextId`
  - Handles immediate execution or queueing of resume requests.
- `GET /api/workflows/:workflowId/paused`
  - Lists paused executions and pause point metadata.
- `DELETE /api/resume/:workflowId/:executionId/:contextId`
  - Cancels a pause (future work).

### 6.2 Background Maintenance
- Scheduled task to detect `resume_queue` entries stuck in `claimed` state and mark them failed.
- Optional TTL-based cleanup for `paused_executions` (set via `expires_at`).

## 7. Edge Cases & Scenarios

1. **Multiple concurrent pauses** – engine collects all pause outputs before returning; single snapshot contains all pause points. Resumes may occur in any order; manager enforces sequential execution via queue.
2. **Pause within loop/parallel** – context IDs encode loop iteration and parallel branch (e.g., `pause₍1₎_loop2`). Resume restores loop and parallel scopes from snapshot so aggregation works after remaining branches finish.
3. **Nested pause-resume** – each resume execution can pause again. New paused execution rows represent the new execution ID; resume queue `parent_execution_id` links the chain.
4. **Resume while another resume running** – queued automatically; when the active execution finishes (paused or completed), the manager claims the next queued entry.
5. **Workflow modified between pause and resume** – snapshot includes serialized workflow used at pause time; resume ignores current builder state to guarantee consistency.
6. **Expired / cancelled pauses** – background task can mark rows `expired` based on `expires_at`, and API responds with 410 Gone.
7. **Failure during resume execution** – resume queue entry marked `failed`; pause remains `paused` so callers can retry.

## 8. Implementation Plan

### 8.1 Database Foundations
- Add migrations for `paused_executions` and `resume_queue` with indexes described in §5.
- Implement Drizzle schema + helper methods for atomic JSONB updates (resume status, timestamps).
- Provide repository utilities for locking paused executions and claiming queue entries.

### 8.2 Type System Extensions
- Update executor types (`apps/sim/executor/types.ts`, `execution/types.ts`) to include pause metadata fields.
- Introduce shared `PauseMetadata`, `PausePoint`, `SerializedSnapshot` interfaces.
- Maintain backwards compatibility by keeping all new properties optional where practical.

### 8.3 Handler & Executor Interfaces
- Enhance `BlockExecutor` to supply node metadata to handlers that opt in (new `executeWithNode` overload).
- Rewrite `PauseResumeBlockHandler` to emit `_pauseMetadata` using helpers in `executor/utils/pause-resume.ts`.
- Add targeted unit tests for handler output and context ID generation (parallel + loop scenarios).

### 8.4 DAG Construction Updates
- Modify `NodeConstructor` / `EdgeConstructor` to generate `<id>__response` and `<id>__trigger` nodes, rewiring edges accordingly.
- Ensure resume trigger nodes are flagged (`metadata.isResumeTrigger`) so `ExecutionEngine` never seeds them initially.
- Add graph-level tests verifying pause nodes in linear, loop, and parallel configurations.

### 8.5 Pause Utilities
- Create `pause-resume-utils.ts` with context ID generation + parsing helpers shared by handler and resume logic.
- Cover helper functions with unit tests (branch + loop naming).

### 8.6 Snapshot Serialization Layer
- Implement `SnapshotSerializer` capable of serializing/deserializing execution context maps, loop/parallel scopes, decisions, pending queue, and trigger IDs.
- Extend `ExecutionSnapshot` to delegate to serializer and avoid redundant stringification.
- Add round-trip tests covering varied execution states.

### 8.7 ExecutionEngine Enhancements
- Track `_pauseMetadata` during `handleNodeCompletion`, accumulate in `pausedBlocks` map.
- After queue drain, when pauses exist, generate `snapshotSeed`, populate metadata, and return `ExecutionResult` with `status: 'paused'`.
- Confirm non-pausing workflows retain original performance (benchmark/regression test).

### 8.8 PauseResumeManager
- Implement manager module responsible for persisting pauses, enqueueing/claiming resumes, launching resume executions, and updating queue entries.
- Integrate manager with DB helpers and serializer.
- Unit-test manager logic using mocked repositories (immediate start, queueing, failures).

### 8.9 Execution Core Integration
- Update `execution-core.ts` to:
  - Call manager persistence on `status: 'paused'` results.
  - Invoke new `Executor.executeFromSnapshot` helper for resume entries.
  - After any run, call `manager.processQueuedResumes` to pick up pending entries sequentially.
- Ensure logging session + run-count behaviour remains unchanged for completed runs.

### 8.10 Resume Execution Path
- Implement `Executor.executeFromSnapshot` (`apps/sim/executor/execution/executor.ts`) leveraging serializer output.
- Fill in `continueExecution` atop this helper for future tooling reuse.
- Write integration test executing pause → resume chain entirely in-memory.

### 8.11 API & Background Maintenance
- Build POST `/api/resume/:workflowId/:executionId/:contextId` route that delegates to manager and returns queue status/position.
- Provide optional GET endpoint for listing paused executions.
- Implement scheduled cleanup job for stale `claimed` entries and expired pauses.

### 8.12 Testing & Validation
- Unit: handler, serializer, engine pause detection, manager queue ops, DB JSON updates.
- Integration: single pause/resume, parallel pauses in shuffled order, loop pauses across iterations, nested pause chains, concurrent resume requests.
- Regression/perf: ensure non-pausing workflows match prior latency + metadata.

### 8.13 Documentation & Operational Readiness
- Update internal docs outlining modules, data flow, resume semantics, and runbooks for stuck resumes.
- Add observability hooks (structured logs, metrics, trace tags) per §9.
- Conduct code walkthrough to validate abstractions and naming before merge.

## 9. Observability & Operations

- **Logging** – Structured logs from `PauseResumeManager` capturing pause creation, resume claim, completion/failure, queue length.
- **Metrics** – Counter/timer for pause hits, resume latency, queued resume depth.
- **Tracing** – Extend execution trace spans to note pause/resume transitions and resume chain depth.
- **Dashboards** – Surface number of paused executions per workspace, average resume wait time.

## 10. Summary

This design introduces pause-resume capability by layering new orchestration around the existing executor rather than modifying the core traversal logic. We:
- keep the engine pure and fast,
- store a single snapshot per execution with many pause points,
- reuse the same execution pipeline for resumes,
- guarantee sequential resume execution through a managed queue,
- and integrate the feature directly into the current system with strong abstractions and observability.

With this structure in place, we can evolve towards per-branch concurrency or more advanced scheduling later without revisiting the foundational contracts established here.

## 11. Per-Branch Pause Concurrency (Phase 2 Design)

### 11.1 Goals

- Allow parallel branches with independent pause blocks to continue executing until their individual queues drain without stalling sibling branches.
- Persist pause-point metadata **as soon as each pause block completes**, so the resume API can surface actionable entries while the engine finishes remaining work.
- Preserve deterministic execution: only one resume runs at a time per execution chain, but each branch can be resumed in any order once snapshots are ready.
- Minimise duplicate state by reusing the single execution snapshot captured when the engine idles, while augmenting metadata to mark which pause points are snapshot-ready.

### 11.2 Runtime Adjustments

1. **Immediate pause registration**
   - `PauseResumeBlockHandler` invokes `PauseResumeManager.registerPausePoint` as soon as it emits `_pauseMetadata`.
   - The manager lazily creates the `paused_executions` row on the **first** registration and appends additional pause point entries for subsequent blocks in the same run.
   - Each pause point is recorded with `snapshotReady: false`, `resumeStatus: 'paused'`, and timestamps so the API can list forthcoming resumes immediately.

2. **Engine completion**
   - While other branches continue executing, pause metadata is accumulated both in-memory (for snapshot serialization) and in the database (for visibility).
   - When the engine finally drains the queue, `handlePauseResult` updates all pause points with `snapshotReady: true` and attaches the serialized snapshot seed. This prevents resuming before the snapshot exists while satisfying the requirement that pause information is available early.

3. **Branch-aware orchestration**
   - `PauseResumeManager.registerPausePoint` records optional `parallelScope` metadata: `{ parallelId, branchIndex, branchCount }` sourced from DAG node metadata.
   - On resume, this metadata enables the manager to restore only the targeted branch while leaving sibling branches paused until they are individually resumed.

4. **Selective resume execution**
   - `Executor.executeFromSnapshot` accepts a list of target trigger IDs; by default it processes a single trigger associated with the resume request.
   - When a branch resumes and completes, the parallel orchestrator checks whether other branches remain paused. If so, it persists results and exits without aggregating until all branches resume; once every branch has resumed, aggregation and downstream execution proceed automatically.

### 11.3 Database Extensions

- `paused_executions.pause_points` entries gain additional properties:
  ```json
  {
    "contextId": "pause₍0₎",
    "resumeStatus": "paused",
    "snapshotReady": false,
    "parallelScope": {
      "parallelId": "parallel_123",
      "branchIndex": 0,
      "branchCount": 3
    },
    "loopScope": {
      "loopId": "loop_9",
      "iteration": 2
    },
    "registeredAt": "2025-11-05T10:30:00Z",
    "triggerBlockId": "pause₍0₎__trigger"
  }
  ```
- When the snapshot is committed, `snapshotReady` toggles to `true` and `snapshotVersion` (e.g., the execution snapshot ID) is populated. Resume APIs should reject attempts while `snapshotReady` remains `false`.
- `paused_executions.metadata.pauseScope` transitions from `'execution'` to `'branch'` to signal the UI/API that each pause point can resume independently.

### 11.4 API Behaviour

- `GET /api/workflows/:workflowId/paused` now includes `snapshotReady` and `parallelScope` so clients can surface which pauses are actionable versus waiting for engine completion.
- The resume POST endpoint enforces:
  - `snapshotReady === true` before queueing execution; otherwise it responds with `409 { status: 'snapshot_pending' }`.
  - Standard FIFO ordering still applies—only one resume runs at a time per execution chain—but queue entries are tagged with `parallelScope` to aid operational diagnostics.

### 11.5 Execution Flow Example

```
parallel {
  branch0: [A] -> [pause₀]
  branch1: [B] -> [pause₁]
  branch2: [C] -> [pause₂]
}

T0: branch0 hits pause → handler registers pause₀ (snapshotReady=false)
T1: branch1 hits pause → handler registers pause₁ (snapshotReady=false)
T2: branch2 hits pause → handler registers pause₂ (snapshotReady=false)
T3: no more runnable nodes → engine serializes snapshot, marks all pause points snapshotReady=true, returns status='paused'

Resume sequence:
R1: user resumes pause₁ → manager claims queue, sets pending queue to pause₁ trigger, executes branch1 tail
R2: branch1 completion updates pause₁.resumeStatus='resumed'; parallel orchestrator records branch1 done but defers aggregation
R3: user resumes pause₀; after completion, branch0 marked resumed
R4: user resumes pause₂; with all branches complete, parallel block aggregates and upstream execution continues automatically
```

### 11.6 Implementation Impact Summary

- **Manager** gains `registerPausePoint` lifecycle and updates pause rows incrementally.
- **Serializer** remains single-snapshot; we simply delay resume until the snapshot is ready.
- **Executor** continues to run one resume at a time per execution, but per-branch metadata enables clean aggregation once all paused branches resume.
- **Testing** should cover resuming branches in every permutation, validating `snapshotReady` gating and ensuring aggregation only fires after the final branch resumes.

