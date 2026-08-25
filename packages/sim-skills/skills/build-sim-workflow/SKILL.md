---
name: build-sim-workflow
description: Create or modify Sim workflows through the sim CLI. Use when translating a workflow request into blocks, inputs, connections, variables, and atomic graph edits; not for only running or deploying an existing workflow.
---

# Build a Sim Workflow

Build the smallest valid graph that satisfies the request, using the Sim CLI as the source of truth
for available resources and accepted shapes.

## Establish context

- Use the profile the user named. If none was named, inspect configured profiles and current context;
  do not silently switch accounts, workspaces, or API origins.
- Find the intended workflow with `sim --output json workflows list`. Create one only when the user
  asked for a new workflow.
- Read an existing draft with `sim --output json workflows state get <workflowId>` before editing it.
  Preserve blocks, edges, variables, and deployment state outside the requested change.

## Discover before composing

- Search the catalog with `sim --output json blocks list`; inspect a candidate with
  `sim --output json blocks get <blockId>`.
- Use the returned block id, operation ids, input ids, modes, conditions, credential fields, and
  outputs exactly. Never invent them from a display name or underlying tool id.
- Inspect `tools list` or `tools get` only when the block response points to a tool and its parameter
  or output contract is needed.
- Resolve credentials and resource identifiers before writing them into a graph. Do not embed raw
  secrets in an operations file.

## Author one semantic batch

Prefer `workflows operations apply` over full-state replacement. One batch can create several
blocks, edit existing blocks, delete blocks, and wire their edges atomically.

Every operation has one of these envelopes:

```json
[
  {
    "operation_type": "add",
    "block_id": "local-label",
    "params": { "type": "<catalog-block-id>", "name": "Display name", "inputs": {} }
  },
  {
    "operation_type": "edit",
    "block_id": "<existing-block-id>",
    "params": { "inputs": {} }
  },
  { "operation_type": "delete", "block_id": "<existing-block-id>" },
  {
    "operation_type": "insert_into_subflow",
    "block_id": "local-child-label",
    "params": {
      "subflowId": "<loop-or-parallel-id>",
      "type": "<catalog-block-id>",
      "name": "Display name",
      "inputs": {}
    }
  },
  {
    "operation_type": "extract_from_subflow",
    "block_id": "<existing-child-id>",
    "params": { "subflowId": "<loop-or-parallel-id>" }
  }
]
```

Block configuration belongs in `params.inputs`, keyed by the catalog's input ids. Put block-level
`retry`, `triggerMode`, and `advancedMode` beside `inputs`, not inside it.

Connections belong on the source block under `params.connections`. Keys are source handles; values
are a target block id, `{ "block": "<target-id>", "handle": "<target-handle>" }`, or an array of
either. `success` aliases the ordinary `source` handle. Re-sending `connections` replaces all of that
block's outgoing edges. To remove only selected edges, edit with `removeEdges` entries containing
`targetBlockId` and, when needed, `sourceHandle`.

A non-UUID `block_id` on a new block is a request-local label. Same-batch references are remapped
automatically; later requests must use the UUID returned in `mintedBlockIds`. Never rediscover a new
block by matching its display name.

## Validate, then commit the same batch

Put a nontrivial batch in a JSON file and dry-run it atomically:

```bash
sim --output json workflows operations apply <workflowId> \
  --operations @operations.json --atomic --dry-run --yes
```

Fail on any skipped operation, dropped input, unresolved reference, or required-field lint issue.
Fix the batch rather than retrying a partial or guessed alternative. When the dry run is clean, send
the exact same file with `--no-dry-run`:

```bash
sim --output json workflows operations apply <workflowId> \
  --operations @operations.json --atomic --no-dry-run --yes
```

Read the state again and verify the requested blocks, inputs, and edges. Report minted ids and any
advisory lint that remains. Do not deploy or execute unless the user asked for that next step.
