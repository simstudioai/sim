# DAG-Based Executor Design

## Current Problems

### Layer-based BFS Execution
- Executes workflow in layers (all blocks with dependencies met)
- Complex virtual block IDs for parallel iterations
- Separate loop/parallel managers with complex state tracking
- Doesn't naturally handle convergence (multiple branches joining)
- Parallel blocks execute in "virtual VMs" with iteration indices

### Loop Implementation
- Loops create virtual execution contexts
- Loop manager tracks iterations separately
- Complex state management for forEach vs for vs while

### Parallel Implementation
- Parallel blocks create virtual block IDs (`block_parallel_iteration_N`)
- Parallel manager tracks execution state
- Doesn't scale well with many parallel branches

---

## New Design: DAG-Based Topological Execution

### Core Concept
Treat the entire workflow as a **Directed Acyclic Graph (DAG)** with special handling for loops:
- Blocks are nodes
- Connections are edges
- Execute by maintaining a **ready queue** of blocks whose dependencies are satisfied
- **Peel off sources** as dependencies complete

### Algorithm (Continuous Queue Processing)

**No layers, no BFS - just continuous queue dequeue!**

```
1. Build DAG:
   - Create node for each enabled block
   - Track incoming edges (dependencies) per node
   - Track outgoing edges per node
   - Expand parallels into N branches

2. Initialize Queue:
   - Add all nodes with inDegree = 0 (no incoming edges)
   - These are typically trigger/start blocks

3. Execution Loop (CONTINUOUS):
   while queue not empty:
     a. Dequeue ONE block (FIFO)
     b. Execute block immediately
     c. Store output
     d. Update DAG:
        - For each outgoing edge from this block:
          * Check if edge should activate (conditionals/errors)
          * If active: Remove edge from target's incoming set
          * If target.incomingEdges.size === 0:
            → Immediately add to queue (ready now!)
     e. Loop backwards-edges:
        - If this is a loop exit node AND condition true:
          → Add loop entry back to queue (cycle!)
     f. Continue immediately (no waiting for "layer")

4. Convergence:
   - Automatic! Block added to queue when last incoming edge removed
   - No special logic needed
```

**Key difference from old executor:**
```
OLD (BFS Layers):
  Execute all blocks in layer 1 → wait for ALL to finish
  → Execute all blocks in layer 2 → wait for ALL to finish
  → etc.
  
NEW (Continuous Queue):
  Dequeue A → execute A → update queue → process immediately
  Dequeue B → execute B → update queue → process immediately
  → etc. (no waiting, continuous flow)
```

**Benefits:**
- ⚡ More responsive (blocks execute as soon as ready)
- ⚡ Better parallelism (don't wait for slowest in layer)
- ⚡ Simpler code (no layer calculation)
- ⚡ Natural flow (like water through pipes)

---

## Parallel Execution - DAG Expansion

### Parallels Expand into Independent Branches

**Key insight:** Parallels are **spatial parallelism** - create N independent branches in the DAG!

**Parallel Config:**
```javascript
{ nodes: [A, B, C], count: 3, distributionItems: [x, y, z] }
```

**Expand to DAG:**
```
         ┌→ A₀ → B₀ → C₀ ─┐
         │                 │
Start →  ├→ A₁ → B₁ → C₁ ─┤→ Converge → End
         │                 │
         └→ A₂ → B₂ → C₂ ─┘

Converge.incomingEdges = [C₀, C₁, C₂]
All branches execute concurrently!
```

**Node Creation:**
```typescript
function expandParallel(parallelConfig, dag) {
  const { nodes, count, distributionItems } = parallelConfig
  const items = distributionItems || Array.from({ length: count }, (_, i) => i)
  
  for (let branchIndex = 0; branchIndex < items.length; branchIndex++) {
    // Create nodes for this branch
    for (const originalNodeId of nodes) {
      const branchNodeId = `${originalNodeId}₍${branchIndex}₎` // Using subscript notation
      
      dag.addNode(branchNodeId, {
        ...cloneBlock(originalNodeId),
        parallelMetadata: {
          parallelId: parallelConfig.id,
          branchIndex,
          branchTotal: items.length,
          item: items[branchIndex],
        }
      })
    }
    
    // Connect nodes within this branch
    for (let i = 0; i < nodes.length - 1; i++) {
      const from = `${nodes[i]}₍${branchIndex}₎`
      const to = `${nodes[i + 1]}₍${branchIndex}₎`
      dag.addEdge(from, to)
    }
  }
  
  // Connect parallel entry to all first nodes
  for (let i = 0; i < items.length; i++) {
    const firstNode = `${nodes[0]}₍${i}₎`
    dag.addEdge(parallelEntryNode, firstNode)
  }
  
  // Connect all last nodes to convergence point
  const convergeNode = getConvergenceNode(parallelConfig)
  for (let i = 0; i < items.length; i++) {
    const lastNode = `${nodes[nodes.length - 1]}₍${i}₎`
    dag.addEdge(lastNode, convergeNode)
  }
}
```

**Resolution:**
```typescript
// Block A₁ references <B.result>
// Since A₁ is in branch 1, resolve to B₁
function resolveParallelReference(reference, currentBlockId) {
  const branchIndex = extractBranchIndex(currentBlockId) // "A₍1₎" → 1
  const targetBaseId = parseReference(reference) // <B.result> → "B"
  
  // Check if target is in same parallel
  if (isInSameParallel(targetBaseId, currentBlockId)) {
    return `${targetBaseId}₍${branchIndex}₎` // B₁
  }
  
  return targetBaseId // Outside parallel
}
```

**Benefits:**
- ✅ True concurrent execution (all branches at once)
- ✅ Natural convergence (wait for all incoming edges)
- ✅ Simple scoping (branch index in node ID)
- ✅ Independent branches (no shared state)
- ✅ Clean aggregation (collect all branch outputs)

---

## Loop Execution - Unified Backwards-Edge Pattern

### Key Insight: All Loops Use Cycles

**No DAG Unrolling!** All loop types (for, forEach, while, doWhile) use the same pattern:
- Conditional back-edge to loop start
- Iteration state tracked in context (not node IDs)
- Original block IDs preserved

### For Loop → While Loop Conversion

**For Loop Config:**
```javascript
{ nodes: [A, B], iterations: 5, loopType: 'for' }
```

**Convert to While:**
```javascript
// In executor, convert for to while:
const whileCondition = `<loop.iteration> < 5`
const loopContext = {
  iteration: 0,      // Start at 0
  maxIterations: 5
}
```

**DAG:**
```
         ┌─────────────────┐
         ↓ (condition true) │
Start → [Condition] → A → B ┘
         ↓ (condition false)
        Exit
```

**Execution:**
```typescript
// Before each iteration
context.loopScopes.set(loopId, {
  iteration: currentIteration,  // e.g., 2
  maxIterations: 5,
  item: undefined  // Not forEach
})

// Blocks in loop can reference:
// <loop.iteration> → 2
// <loop.index> → 2

// After loop body executes
currentIteration++
if (currentIteration < maxIterations) {
  queue.push(loopStartNodeId) // Re-add to queue (cycle!)
} else {
  // Loop exits, activate exit edge
}
```

### ForEach Loop → While Loop Conversion

**ForEach Config:**
```javascript
{ nodes: [A, B], forEachItems: [x, y, z], loopType: 'forEach' }
```

**Convert to While:**
```javascript
const items = [x, y, z]
const whileCondition = `<loop.iteration> < ${items.length}`
const loopContext = {
  iteration: 0,
  items: [x, y, z],
  currentItem: items[0]
}
```

**Execution:**
```typescript
// Before each iteration
context.loopScopes.set(loopId, {
  iteration: i,              // e.g., 1
  maxIterations: items.length,
  item: items[i],            // e.g., y
  items: items               // Full array
})

// Blocks in loop can reference:
// <loop.iteration> → 1
// <loop.index> → 1  
// <loop.item> → y
// <loop.items> → [x, y, z]

// After iteration
currentIteration++
if (currentIteration < items.length) {
  queue.push(loopStartNodeId) // Continue
}
```

### While & DoWhile Loops (Already Have Condition)

**While Config:**
```javascript
{ nodes: [A, B], whileCondition: "<A.count> < 10", loopType: 'while' }
```

**DAG:**
```
         ┌─────────────────┐
         ↓ (condition true) │
Start → [Eval Condition] → A → B ┘
         ↓ (condition false)
        Exit
```

**DoWhile:** Same but first iteration always executes (skip initial condition check)

### Unified Loop Handler

**Single loop execution pattern:**
```typescript
async executeLoop(loopConfig, dag, context) {
  const { nodes, loopType, iterations, forEachItems, whileCondition } = loopConfig
  
  // Convert all loop types to while-style
  let condition: () => boolean
  let prepareIteration: (i: number) => void
  
  switch (loopType) {
    case 'for':
      condition = () => context.loopScopes.get(loopId).iteration < iterations
      prepareIteration = (i) => {
        context.loopScopes.set(loopId, { iteration: i, maxIterations: iterations })
      }
      break
      
    case 'forEach':
      const items = Array.isArray(forEachItems) ? forEachItems : Object.entries(forEachItems)
      condition = () => context.loopScopes.get(loopId).iteration < items.length
      prepareIteration = (i) => {
        context.loopScopes.set(loopId, {
          iteration: i,
          maxIterations: items.length,
          item: items[i],
          items
        })
      }
      break
      
    case 'while':
    case 'doWhile':
      condition = () => evaluateCondition(whileCondition, context)
      prepareIteration = (i) => {
        context.loopScopes.set(loopId, { iteration: i })
      }
      break
  }
  
  // Add loop entry node to DAG
  const loopEntryId = `${loopId}_entry`
  dag.addNode(loopEntryId, {
    type: 'loop_entry',
    execute: async () => {
      const scope = context.loopScopes.get(loopId) || { iteration: 0 }
      
      // Check condition
      if (condition()) {
        // Prepare iteration context
        prepareIteration(scope.iteration)
        
        // Add first node in loop to queue
        queue.push(nodes[0])
      } else {
        // Loop exits - activate exit edge
        activateExitEdge(loopId)
      }
    }
  })
  
  // Add back-edge from last loop node to entry
  dag.addEdge(nodes[nodes.length - 1], loopEntryId, { type: 'loop_back' })
}
```

**Benefits:**
- ✅ No DAG explosion (same 3 blocks for 1000 iterations!)
- ✅ Unified loop handling
- ✅ Easy to reference `<loop.iteration>`, `<loop.item>`
- ✅ Natural cycle representation
- ✅ Works for any loop size

---

## Input Resolution & Scoping Rules

### Scoping With Context (No Iteration Suffixes!)

**Loop contains A→B→C, executing iteration 2:**

Blocks keep their original IDs: `A`, `B`, `C`

**Iteration context stored separately:**
```typescript
context.loopScopes.set(loopId, {
  iteration: 2,
  currentIteration: {
    outputs: Map {
      'A' → { result: 'iter2_A_output' },
      'B' → { result: 'iter2_B_output' },
    }
  }
})
```

### Resolution Rules

**Rule 1: Within loop, use current iteration's outputs**
```typescript
// C executing in iteration 2
C references <A.result>:
  1. Check: Is A in same loop as C? YES
  2. Get current iteration context for this loop
  3. Return currentIteration.outputs.get('A').result
  → Returns iteration 2's A output ✅

C references <B.result>:
  → Returns iteration 2's B output ✅
```

**Rule 2: Blocks after loop see aggregated results only**
```typescript
// After loop completes
NextBlock references <A.result>:
  1. Check: Is A in a loop? YES
  2. Check: Is NextBlock in that loop? NO
  3. A's outputs are NOT visible (sealed in iterations) ❌
  
NextBlock references <loop.results>:
  1. Return aggregated array of final outputs
  → Returns [iter0_output, iter1_output, iter2_output] ✅
```

**Rule 3: Blocks before loop visible to all iterations**
```typescript
// Start → Loop(A→B)
A (in any iteration) references <Start.input>:
  1. Check: Is Start in same loop? NO
  2. Start is before loop, outputs are stable
  → Returns Start.input ✅
```

### Implementation

**Simple Resolution:**
```typescript
function resolveInput(reference: string, currentBlockId: string, context) {
  const targetBlockId = parseReference(reference) // <B.result> → "B"
  
  // Check if we're executing inside a loop
  const currentLoop = getCurrentExecutingLoop(currentBlockId, context)
  
  if (currentLoop) {
    // We're in a loop iteration
    const loopScope = context.loopScopes.get(currentLoop.id)
    
    // Check if target is in same loop
    if (isBlockInLoop(targetBlockId, currentLoop)) {
      // Get output from current iteration's context
      return loopScope.currentIteration.outputs.get(targetBlockId)
    }
  }
  
  // Target is outside loop - use global outputs
  return context.globalOutputs.get(targetBlockId)
}
```

**Output Storage:**
```typescript
// During loop execution
async executeBlockInLoop(block, loopId, context) {
  const output = await handler.execute(block, inputs, context)
  
  // Store in iteration-specific context
  const loopScope = context.loopScopes.get(loopId)
  loopScope.currentIteration.outputs.set(block.id, output)
  
  // NOT in global outputs (sealed!)
}

// When loop iteration completes
function completeLoopIteration(loopId, context) {
  const loopScope = context.loopScopes.get(loopId)
  
  // Aggregate this iteration's final output
  const lastBlock = getLastBlockInLoop(loopId)
  const iterationOutput = loopScope.currentIteration.outputs.get(lastBlock.id)
  
  loopScope.allIterationOutputs.push(iterationOutput)
  
  // Clear iteration outputs for next iteration
  loopScope.currentIteration.outputs.clear()
  loopScope.iteration++
}

// When loop fully completes
function completeLoop(loopId, context) {
  const loopScope = context.loopScopes.get(loopId)
  
  // Make aggregated results available globally
  context.globalOutputs.set(`${loopId}.results`, loopScope.allIterationOutputs)
}
```

**Benefits:**
- ✅ No iteration suffixes on block IDs
- ✅ Original block names preserved
- ✅ Iteration context tracks current state
- ✅ Clean separation: iteration outputs vs global outputs
- ✅ Loop results properly aggregated

---

## Convergence (Multiple Branches)

### The Beauty of DAG

**Example:**
```
     A
   /   \
  B     C
   \   /
     D
```

**Current (Complex):**
- Track which path D came from
- Complex logic to wait for both B and C

**New (Automatic):**
```
D starts with: incomingEdges = [B, C]

When B completes: incomingEdges = [C]  (B removed)
When C completes: incomingEdges = []   (C removed)
                  → D added to queue!
```

**Zero extra logic needed!** The DAG algorithm handles it.

---

## Conditional Routing

### Router Blocks

**Current:**
- PathTracker manages routing decisions
- Complex logic to activate only selected path

**New:**
```typescript
async executeRouter(block, context) {
  const selectedTarget = determineRoute(block, context)
  
  // Mark which edges are active
  for (const [edgeId, edge] of block.outgoingEdges) {
    if (edge.target === selectedTarget) {
      edge.isActive = true  // Activate this edge
    } else {
      edge.isActive = false // Deactivate others
    }
  }
}

// In edge removal step:
if (edge.isActive !== false) {
  // Only remove edge if it's active (or not marked)
  targetNode.incomingEdges.delete(sourceId)
}
```

### Condition Blocks

Same approach - mark selected condition's edge as active, ignore others.

---

## Error Handling

**Error Edges:**
```
Block A → (error) → ErrorHandler
       ↓ (success) → NextBlock
```

**Implementation:**
```typescript
async executeBlock(node, context) {
  try {
    const output = await handler.execute(...)
    
    // Activate success edges only
    for (const edge of node.outgoingEdges) {
      if (edge.sourceHandle !== 'error') {
        edge.isActive = true
      }
    }
  } catch (error) {
    // Activate error edges only
    for (const edge of node.outgoingEdges) {
      if (edge.sourceHandle === 'error') {
        edge.isActive = true
      }
    }
  }
}
```

---

## Data Structures

### DAG Node
```typescript
interface DAGNode {
  blockId: string              // Original or iteration ID (e.g., "A_iter2")
  block: SerializedBlock       // Block config
  incomingEdges: Set<string>   // Source block IDs
  outgoingEdges: Map<string, { 
    target: string
    sourceHandle?: string
    targetHandle?: string
    isActive?: boolean         // For conditional routing
  }>
  metadata: {
    isLoopIteration?: boolean
    iterationIndex?: number
    iterationTotal?: number
    iterationItem?: any        // For forEach
    isParallelBranch?: boolean
  }
}
```

### Execution State
```typescript
interface ExecutionState {
  dag: Map<string, DAGNode>
  readyQueue: string[]
  executedBlocks: Set<string>
  blockOutputs: Map<string, any>
  activeLoops: Map<string, {
    currentIteration: number
    maxIterations: number
  }>
}
```

---

## Benefits

### 1. **Simpler Code**
- No virtual block IDs
- No separate loop/parallel managers
- No complex path tracking
- Natural convergence

### 2. **Better Performance**
- Parallel branches truly execute in parallel (Promise.all on ready queue)
- No iteration overhead
- Simpler state management

### 3. **More Intuitive**
- DAG is exactly what users see in UI
- Clear dependency model
- Easier to reason about

### 4. **Flexible**
- Easy to add new control flow types
- Clean separation of concerns
- Better error propagation

---

## Migration Strategy

### Phase 1: Basic DAG (No Loops/Parallels)
1. Implement queue-based execution
2. Handle simple linear and branching workflows
3. Test convergence

### Phase 2: Add Parallels
1. Implement parallel expansion
2. Test N-way branches
3. Test convergence after parallels

### Phase 3: Add For/ForEach Loops
1. Implement loop unrolling
2. Test iteration sequences
3. Test nested loops

### Phase 4: Add While Loops
1. Implement cycle support
2. Add conditional back-edges
3. Test while loop termination

### Phase 5: Optimize
1. Parallel execution (Promise.all on queue)
2. Streaming support
3. Performance tuning

---

## Open Questions

### 1. **Loop Variable Scope**
How do we handle `<loop.index>` and `<loop.item>` references?

**Proposed:**
```typescript
// Each iteration node carries its metadata
node.metadata.iterationIndex = 2
node.metadata.iterationItem = { name: "value" }

// Resolver checks current block's metadata
resolveLoopVariable(blockId, variable) {
  const node = dag.get(blockId)
  if (variable === 'index') return node.metadata.iterationIndex
  if (variable === 'item') return node.metadata.iterationItem
}
```

### 2. **Parallel Results Collection**
How do we collect `<parallel.results>` for convergence blocks?

**Proposed:**
```typescript
// When parallel branches complete, store in special location
parallelResults[parallelId] = [
  iter0_output,
  iter1_output,
  iter2_output,
]

// Convergence block can reference <parallel.results>
```

### 3. **While Loop Safety**
How do we prevent infinite loops?

**Proposed:**
- Max iteration count (e.g., 500)
- Track cycles per loop
- Throw error if exceeded

### 4. **Nested Loops**
How do we handle loop inside loop?

**Proposed:**
- Unroll outer loop first
- Each outer iteration contains fully unrolled inner loop
- Example: Outer×3, Inner×2 = 6 total inner iterations
```
outer_iter0:
  inner_iter0_outer0
  inner_iter1_outer0
outer_iter1:
  inner_iter0_outer1
  inner_iter1_outer1
outer_iter2:
  inner_iter0_outer2
  inner_iter1_outer2
```

---

## Implementation Checklist

### Core DAG Structure
- [ ] DAGNode interface
- [ ] DAG builder from SerializedWorkflow
- [ ] Queue-based execution engine
- [ ] Edge removal on block completion
- [ ] Automatic convergence detection

### Parallel Expansion
- [ ] Expand parallel config into N branches
- [ ] Connect branches to DAG
- [ ] Collect parallel results
- [ ] Handle parallel convergence

### Loop Unrolling (For/ForEach)
- [ ] Detect for/forEach loops
- [ ] Unroll iterations into sequence
- [ ] Connect iterations (iter0 → iter1 → iter2)
- [ ] Pass iteration metadata (index, item)
- [ ] Connect to external nodes (before/after loop)

### While Loop Cycles
- [ ] Create condition evaluator nodes
- [ ] Add back-edges from loop end to condition
- [ ] Conditional edge activation
- [ ] Max iteration safety check
- [ ] Proper loop exit

### Conditional Routing
- [ ] Condition block evaluation
- [ ] Router block selection
- [ ] Edge activation/deactivation
- [ ] Skip unselected branches

### Input Resolution
- [ ] Scoped resolution for iterations
- [ ] Loop variable access (<loop.index>, <loop.item>)
- [ ] Parallel results access (<parallel.results>)
- [ ] Standard block references (<blockName.output>)

### Error Handling
- [ ] Error edge detection
- [ ] Success vs error path activation
- [ ] Error propagation
- [ ] Graceful failures

### Streaming & Callbacks
- [ ] onBlockStart callback
- [ ] onBlockComplete callback
- [ ] onStream callback
- [ ] SSE event emission

---

## Example Transformations

### Example 1: Simple Parallel

**User Workflow:**
```
Start → Parallel(A, B, C) → Merge
```

**DAG:**
```
Start → A → Merge
     ↘ B ↗
     ↘ C ↗

Merge.incomingEdges = [A, B, C]
When all 3 complete → Merge ready
```

### Example 2: For Loop

**User Workflow:**
```
Start → Loop(A→B, iterations=3) → End
```

**DAG:**
```
Start → A_iter0 → B_iter0 → A_iter1 → B_iter1 → A_iter2 → B_iter2 → End
```

### Example 3: While Loop

**User Workflow:**
```
Start → While(A→B, condition="<A.count> < 10") → End
```

**DAG (with cycle):**
```
Start → Condition → A → B ─┐
         ↓ (false)          │
        End          ←──────┘ (if condition true)
```

### Example 4: Complex - Parallel + Loop + Convergence

**User Workflow:**
```
Start → Parallel(
          Branch1: Loop(A, n=2)
          Branch2: B
        ) → Converge → End
```

**DAG:**
```
Start → A_iter0_branch0 → A_iter1_branch0 ─┐
     ↘ B_branch1 ───────────────────────────┤ → Converge → End
                                            
Converge.incomingEdges = [A_iter1_branch0, B_branch1]
```

---

## Advantages Over Current System

| Feature | Current (BFS Layers) | New (DAG Queue) |
|---------|---------------------|-----------------|
| **Convergence** | Manual tracking, complex | Automatic (inDegree = 0) |
| **Parallels** | Virtual IDs, iteration tracking | Just branches in DAG |
| **Loops** | Loop manager, virtual contexts | Unrolled nodes or cycles |
| **Conditional** | PathTracker, complex state | Edge activation flags |
| **Code Complexity** | ~2600 lines | Est. ~800 lines |
| **Performance** | Sequential layers | True parallelism |
| **Debugging** | Virtual IDs confusing | Real node IDs |

---

## Risks & Mitigation

### Risk 1: Breaking Existing Workflows
**Mitigation:** 
- Keep old executor during migration
- Feature flag to toggle
- Comprehensive test suite
- Gradual rollout

### Risk 2: DAG Explosion (Large Loops)
**Problem:** Loop with 1000 iterations creates 1000 nodes
**Mitigation:**
- Limit max iterations (e.g., 100)
- Consider hybrid: unroll small loops, use iteration tracking for large ones
- Or: lazy unrolling (create next iteration when current completes)

### Risk 3: While Loop Infinite Cycles
**Mitigation:**
- Max iteration count (500)
- Timeout per loop
- Cycle detection

### Risk 4: Reference Resolution Complexity
**Mitigation:**
- Clear scoping rules
- Iteration metadata on nodes
- Comprehensive resolver tests

---

## Migration Strategy

### Phase 1: Cleanup (Remove Old Executor Logic)
**Goal:** Slim down to minimal interface that new executor can implement

1. **Remove complex managers:**
   - Delete `loops/loops.ts` (LoopManager)
   - Delete `parallels/parallels.ts` (ParallelManager)
   - Delete `path/path.ts` (PathTracker)
   - Delete `routing/routing.ts`
   
2. **Keep only:**
   - Block handlers (they work with any executor)
   - Input resolver (will update for new scoping)
   - Types/interfaces
   - Utilities

3. **Result:** Clean interface for new executor to implement

### Phase 2: Build New DAG Executor
**Goal:** Drop-in replacement with same interface

```typescript
// execution-core.ts currently does:
const executorInstance = new Executor({ ... })
const result = await executorInstance.execute(workflowId)

// Will become:
const executorInstance = new DAGExecutor({ ... })
const result = await executorInstance.execute(workflowId)

// Same interface, different implementation!
```

**New executor must provide:**
- Same constructor signature
- Same `execute(workflowId, startBlockId?)` method
- Same `cancel()` method
- Same callbacks: onBlockStart, onBlockComplete, onStream

### Phase 3: Implementation Steps

**Step 1:** Basic DAG (no loops/parallels)
- DAG builder
- Queue-based execution
- Convergence
- Conditional routing

**Step 2:** Parallel expansion
- Expand parallels to branches
- Concurrent execution
- Result aggregation

**Step 3:** Loop backwards-edges
- For → while conversion
- ForEach handling
- While/doWhile execution
- Iteration context management

**Step 4:** Input resolution
- Loop-scoped resolution
- Parallel-scoped resolution
- Global outputs

**Step 5:** Testing & Validation
- Run existing test suite
- Fix any breaking changes
- Performance validation

### Phase 4: Deployment
- Replace `Executor` with `DAGExecutor` in execution-core.ts
- Monitor production
- Remove old executor code

---

## Decision Points ✅ DECIDED

1. **Parallel execution:** ✅ YES explosion - expand into N independent branches in DAG
2. **For/forEach loops:** ✅ NO unrolling - use backwards-edge pattern with iteration context
3. **While loops:** ✅ Backwards-edge with condition evaluation (no cycle limit needed)
4. **Loop limits:** ✅ Keep existing limits (configurable per loop type)
5. **Migration:** ✅ **Remove old executor FIRST, then build new one as drop-in replacement**

### Unified Approach

**Parallels:**
- Expand into N branches: A₀, A₁, A₂
- Execute concurrently (Promise.all on queue)
- Natural convergence via DAG

**Loops:**
- Keep original block IDs
- Use backwards-edge pattern
- Track iteration state in context
- Sequential execution with cycles

---

## Estimated Effort (Revised)

With the simplified backwards-edge approach:

- **Basic DAG + Queue Execution:** ~1-2 days
- **Unified Loop Handler (for/forEach/while/doWhile):** ~2 days
- **Parallel = Concurrent Loop:** ~1 day
- **Input Resolution & Scoping:** ~2 days
- **Conditional Routing & Error Handling:** ~1 day
- **Migration & Testing:** ~2-3 days

**Total:** ~9-11 days for complete DAG executor

**Reduced complexity because:**
- No loop unrolling (no DAG explosion)
- No parallel expansion
- Unified loop/parallel handling
- Simpler scoping (context-based, not ID-based)

---

## Ready to Implement! 🚀

The design is approved. Key benefits:

✅ **Original block IDs preserved** - No _iter suffixes!
✅ **No DAG explosion** - Same nodes reused across iterations
✅ **Unified loops/parallels** - Both use backwards-edge pattern
✅ **Clean scoping** - Iteration context isolated
✅ **True parallelism** - Promise.all for concurrent execution
✅ **Simpler code** - Estimated ~800 lines vs current ~2600

Ready to start implementation!

