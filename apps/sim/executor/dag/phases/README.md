# DAG Builder Phases

The DAG building process is split into discrete phases for maintainability:

## Phase Order

1. **ReachabilityPhase** - Find all blocks reachable from trigger
2. **ConfigFilterPhase** - Filter loop/parallel configs to reachable blocks  
3. **LoopSentinelPhase** - Create sentinel nodes for loops
4. **NodeCreationPhase** - Create DAG nodes (regular + parallel expansion)
5. **EdgeWiringPhase** - Wire all edges between nodes

## Phase Interface

Each phase implements:
```typescript
execute(workflow: SerializedWorkflow, dag: DAG, context: BuildContext): void
```

## Benefits

- **Modularity**: Each phase is ~150-200 lines instead of 1000+
- **Testability**: Phases can be unit tested independently
- **Clarity**: Clear separation of DAG construction steps
- **Extensibility**: Easy to add new phases or modify existing ones

