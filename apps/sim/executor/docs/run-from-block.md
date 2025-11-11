# Run-From-Block Execution Design

## Background
- Manual debugging and partial reruns currently require executing an entire workflow from the trigger onward.
- We already capture block outputs, router/condition choices, loop scopes, and DAG topology inside `SerializableExecutionState` snapshots.
- The goal is to restart execution at any block while preserving as much prior computation as possible and maintaining true parallel semantics.

## Objectives
- Persist block inputs/outputs, branch decisions, and DAG metadata for every successful execution.
- Given a target block, recompute only the minimal subgraph whose upstream state changed or was explicitly invalidated.
- Hydrate the executor with historical state so unresolved blocks behave exactly as in the full run.
- Preserve orchestrator behaviour for loops, parallels, routers, and pause/resume blocks.
- Provide observability that explains which blocks reran and why.

## Terminology
- **Execution Snapshot** – persisted copy of `SerializableExecutionState` plus workflow metadata for a prior run.
- **Target Block** – block the user wants to “run from”.
- **Start Set** – minimal set of blocks that must be enqueued as new starting points.
- **Resolved Block** – block whose prior output remains valid and is reused without re-executing.
- **Restart Scope** – set of blocks that must be re-executed (includes the target block and any dependent nodes).

## Persisted State Model
- Create migration (separate task) adding `workflow_execution_states` table storing:
  - `execution_id`, `workflow_id`, `trigger_block_id`, `run_version`, `serialized_state`, `resolved_inputs`, `resolved_outputs`, `status`, `attempt_at`.
- Treat `(workflow_id, trigger_block_id)` as the logical key; each trigger maintains its own latest snapshot.
- Extend `BlockExecutor` to persist `resolvedInputs` alongside `blockLogs` so we can diff future inputs accurately.
- Store `dagIncomingEdges` and `remainingEdges` from snapshots to allow edge restoration when pruning.
- Snapshot persistence is limited to executions initiated from the client/manual surface to avoid capturing automation noise.

## High-Level Run-From-Block Flow
1. **Load Context**
   - Fetch latest snapshot (regardless of status) for the requested `(workflow_id, trigger_block_id)` pair, matching deploy/draft version.
   - Build fresh DAG from current workflow definition using `DAGBuilder`.
2. **Analyse Changes**
   - Compute forward impact from target block.
   - Detect upstream changes and build initial Start Set.
   - Run backward pruning from sinks to drop unnecessary starts.
3. **Hydrate Executor**
   - Reconstruct `ExecutionState` from snapshot.
   - Remove state for restart blocks; keep outputs for resolved blocks.
   - Clear loop/parallel scopes for affected constructs.
4. **Seed Queue & Execute**
   - Set `context.metadata.pendingBlocks` to pruned Start Set.
   - Ensure incoming edge sets reflect resolved upstream nodes.
   - Invoke `ExecutionEngine.run()`; existing concurrency model provides parallelism.
   - After execution completes (success, pause, or failure), persist the resulting state as the new snapshot for this trigger, overwriting the previous attempt.
   - Tag `context.metadata.executionMode = 'run_from_block'` so downstream logging, billing, and analytics can classify the run.

## Detecting Blocks to Re-Run

### Step 1: Forward Impact DFS
- Start at the target node ID (branch suffix and sentinel aware).
- Traverse outgoing edges using the current DAG (post-builder).
- Collect every reachable node into `affectedSet`.
- Include sentinel nodes and parallel branch clones (IDs with subscript) to avoid missing orchestrator plumbing.

### Step 2: Upstream Change Detection
- Determine the trigger block by reusing `resolveExecutorStartBlock` logic with current workflow metadata and the snapshot’s trigger info.
- Perform DFS from the trigger through current DAG edges until:
  - Visiting the target block (stop descending past target).
  - Encountering nodes not present in the saved snapshot (mark as changed).
- For each visited node:
  - Compare stored block configuration hash vs. current (hash metadata + params + code).
  - Resolve current inputs via `VariableResolver` with hydrated state; compare with stored `resolvedInputs`.
  - Compare stored outputs if the block ID exists in snapshot; missing outputs imply change.
  - If any mismatch or block is the explicit target, add node ID to `startCandidates`.
  - Propagate a “changed” flag downstream in this DFS so children get marked if a parent changed.

### Step 3: Backward Pruning from Sinks
- Identify sink nodes (no outgoing edges or response blocks).
- Build reverse adjacency map once per run.
- DFS backward from each sink, collecting `ancestorSet`.
- The minimal Start Set is `startCandidates ∩ ancestorSet`.
- Always include target block even if intersection would remove it.
- Remove nodes already in `affectedSet` but whose outputs remain identical and have no path to sinks (defensive guard).

### Step 4: Final Restart Scope
- `restartScope = affectedSet ∪ startSet`.
- Any block not in `restartScope` remains resolved and treated as completed.

## Queue Preparation
- Hydrate `ExecutionState` with stored block states.
- For every node in `restartScope`:
  - Remove entry from `ExecutionState.blockStates` and `executedBlocks`.
  - Delete related router/condition decisions.
  - Restore incoming edges using `dagIncomingEdges` snapshot.
- For each resolved upstream node:
  - Confirm its outgoing edges are processed via `edgeManager.processOutgoingEdges(node, storedOutput, false)` to drop satisfied dependencies and enqueue children when needed.
- Populate `context.metadata.pendingBlocks` with the Start Set (deduped, sorted for determinism).
- ExecutionEngine’s `initializeQueue` path sees `pendingBlocks` and pushes them onto the ready queue.

## Loop Handling
- Loops are restarted from iteration zero when any block inside the loop body requires re-execution.
- Implementation:
  - When diff logic marks a loop body node (or sentinel) as changed, include `loopId` in `loopRestartSet`.
  - Before execution:
    - Drop entries for `loopId` from `context.loopExecutions`.
    - Call `LoopOrchestrator.clearLoopExecutionState(loopId)` and `restoreLoopEdges(loopId)` to reset sentinel edges.
  - Enqueue the sentinel start node if it belongs to Start Set; loop orchestrator will rebuild scopes as nodes run.
- Snapshot values for loops (aggregated outputs) are reused only if loop not in restart scope.

## Parallel Handling
- Parallel branches already map to distinct node IDs (`blockId₍index₎`).
- Forward/backward DFS naturally include affected branch nodes.
- When any branch node re-runs:
  - Clear saved outputs for that branch node only.
  - `ParallelOrchestrator` lazily recreates scope the first time a branch completes (scope removed from `context.parallelExecutions` for impacted `parallelId`).
- Branches outside restart scope retain previous outputs, preserving aggregated results.

## Routers and Conditions
- Decisions stored in `context.decisions.router` / `context.decisions.condition`.
- When a router or condition is in restart scope, remove its decision before queuing so `EdgeManager.shouldActivateEdge` re-evaluates the correct branch.
- For resolved routers/conditions keep decisions to avoid re-activating previously pruned edges.

## Pause/Resume Blocks
- If an approval block lies in restart scope:
  - Strip `_pauseMetadata` before execution so we do not treat stored metadata as fresh pause output.
  - Re-running will register new pause contexts (or skip if configuration changed).
- If outside restart scope:
  - Preserve `_pauseMetadata` in reused outputs but flag them as historical (optional boolean) so UI can show they are not actionable resumes.
- Resume triggers are allowed only when `context.metadata.resumeFromSnapshot` is true; run-from-block will set `allowResumeTriggers = false` to avoid accidental resume nodes unless explicitly in Start Set.

## Variable Resolution
- Hydrate `VariableResolver` with reconstructed `ExecutionState`; resolved blocks provide outputs to satisfy `<block.field>` references.
- For blocks in restart scope, removal from `ExecutionState` forces resolver to recompute when node executes.
- During diffing:
  - Temporarily use hydrated state (before pruning) to resolve current inputs; if resolution fails (missing upstream output), mark block as changed.
- Workflow variables and environment variables come from persisted snapshot metadata to ensure deterministic comparisons.

## Concurrency & Queueing Semantics
- Existing `ExecutionEngine` already executes all ready nodes concurrently; no changes needed for “true parallelism”.
- Optionally expose `maxConcurrency` in `RunFromBlockPlan` for future throttling; default remains unbounded.
- `readyQueue` is seeded exclusively with Start Set; downstream nodes become ready through normal edge processing when dependencies complete.
- Reuse streaming callbacks (`onBlockStart`, `onBlockComplete`, `onStream`) so rerun blocks stream back to the client console in real time; resolved blocks remain silent.

## Error Handling
- Missing snapshot or version mismatch → if no historical state exists, fall back to a full-run plan (Start Set becomes the original trigger).
- Missing target node in current DAG → abort (workflow changed too much).
- If diff fails due to unresolvable reference, treat as changed and re-run from that node.
- Execution failures or aborts overwrite the stored snapshot with the partial state, ensuring subsequent attempts resume from the latest client-visible data.

## Observability
- Add structured logs via `logger.info`:
  - Snapshot metadata (execution ID, createdAt, version).
  - Forward DFS result size (`affectedCount`).
  - Upstream diff summary (block IDs and reasons).
  - Loop/parallel scopes cleared.
  - Start Set list before queueing.
- Emit metrics counters (future) for number of blocks reused vs. re-executed.

## Storage & Migration Plan
- Migration (later task) creates new table; store raw JSON of execution state and run version.
- Repository layer exposes:
  - `saveExecutionState(executionResult)` after each client-initiated run, regardless of outcome.
  - `loadLatestExecutionState(workflowId, runVersion)` when run-from-block invoked.
- Consider TTL or pruning policy to limit history growth.

## Testing Strategy
- Unit tests:
  - Forward/backward DFS utilities with loops/parallels.
  - Diff logic for input/output/config changes.
  - Loop restart logic resets scopes.
  - Pause block behaviour (metadata stripping vs. reuse).
- Integration tests:
  - Full workflow with branches, loops, approvals – run once, mutate input, run-from-block, assert only necessary blocks rerun.
  - Scenario where upstream config change triggers deeper downstream re-execution.
- Regression tests ensuring original full-run path unchanged.

## Open Questions
- Should we expose UI controls to override Start Set suggestions?
- How do we surface “historical” pause blocks to users?
- Should we snapshot tool execution side-effects (e.g., notifications) or always rerun them?

## Future Enhancements
- Cache hashed block configurations to speed change detection.
- Allow selecting older execution snapshots.
- Layer on speculative parallelism controls (per-branch throttling).
- Add dry-run mode that reports Start Set without executing.
- Extend the client block toolbar so hovering a block reveals the “Run from block” action alongside existing controls, invoking the documented flow with proper logging and billing hooks.


