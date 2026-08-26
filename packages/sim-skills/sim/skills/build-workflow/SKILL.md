---
name: build-workflow
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
- If the workflow is locked or read-only, stop instead of attempting an alternate mutation path.

## Design before encoding

- Translate the request into an entry point, required transformations or decisions, external
  actions, and an observable terminal result. Decide what successful output should look like before
  choosing blocks.
- Treat the graph as a typed program: block inputs are arguments, block outputs are return values,
  and references are data flow. Inspect an upstream output schema before referencing a field, and
  make sure its shape matches what the downstream input accepts.
- Build the smallest graph that expresses the behavior:
  - Connect blocks directly when there is no real decision to make.
  - Use a Function block for deterministic parsing, validation, calculation, and reshaping. Do not
    spend an Agent block on work that should always produce the same result for the same input.
  - Use an Agent block for language understanding, generation, or dynamic tool use.
  - Use a Condition block for explicit predicates and a Router block for semantic classification.
  - Use a Loop only for iteration. Do not create graph cycles to model repetition.
  - Use Parallel only when branches are independent; keep data-dependent work sequential.
- Every added block must be reachable from the intended entry point and contribute to a terminal
  path. Trace downstream references before editing or deleting an existing producer.

## Configure Agent blocks deliberately

- Use an Agent for generation, summarization, extraction from natural language, diagnosis, or other
  work requiring judgment. Use a Function for mechanical parsing, formatting, calculation, and
  reshaping; do not use canned strings or random selection to imitate a language task. When fuzzy
  classification exists only to choose a branch, prefer a Router over Agent followed by Condition.
- Prefer an integration inside `inputs.tools` when the Agent should decide whether to call it or
  choose its arguments. Use a standalone integration block when the action must execute
  deterministically at that point in the graph. Event sources remain trigger blocks.
- Inspect the Agent and integration block details before configuring them. Choose a model from the
  Agent block's current options. For an integration tool, `type` is the catalog block id and
  `operation` is its catalog operation id, never the underlying executable tool id.
- Store the complete tool list at `params.inputs.tools`. Supported authoring shapes are:

```json
[
  {
    "type": "<catalog-block-id>",
    "operation": "<catalog-operation-id>",
    "usageControl": "auto",
    "params": { "<author-fixed-input>": "<value>" }
  },
  {
    "type": "custom-tool",
    "customToolId": "<custom-tool-id>",
    "usageControl": "auto"
  },
  {
    "type": "mcp",
    "params": { "serverId": "<mcp-server-id>", "toolName": "<mcp-tool-name>" },
    "usageControl": "auto"
  }
]
```

- Put only workflow-author-fixed values in a tool's `params`; omit arguments the model should
  choose. Omit `usageControl` or use `auto` when the model may decide, `force` when every Agent run
  must call it, and `none` to disable it.
- Resolve custom-tool ids with `custom-tools list` and `custom-tools get`. Resolve MCP server and
  tool names with `mcp-servers list` and `mcp-servers tools list <serverId>`. New custom tools should
  use `customToolId`; preserve an existing legacy inline declaration but do not create another.
- Skills are separate from tools: store `[{ "skillId": "<skill-id>" }]` in `params.inputs.skills`,
  never in `inputs.tools`. Both `tools` and `skills` are complete replacement arrays, so read state
  and retain entries the user did not ask to remove.
- When downstream blocks need stable typed fields, configure the Agent's catalog-declared
  structured response format. Structured fields become top-level Agent outputs; inspect the
  effective output schema before referencing them instead of assuming a `content` path.

## Name blocks and write references exactly

- A block-output reference uses the block's `name`, not its catalog type, operation id, UUID, or
  request-local `block_id`. Its prefix is the name lowercased with whitespace and dots removed.
  Nothing is inserted: `AWS Alert` becomes `awsalert`, so use `<awsalert.event.text>`, never
  `<aws_alert.event.text>`. Existing dashes and underscores remain (`AWS_Alert` becomes
  `aws_alert`).
- Prefer plain alphanumeric camelCase names for new blocks, such as `awsAlert`, `parseInput`, and
  `step1`. This keeps the stored name readable and the reference prefix predictable. Do not use the
  reserved normalized names `loop`, `parallel`, or `variable`, and do not create names that collide
  after normalization.
- The field path after the prefix comes from the upstream block's effective output schema and is
  case-sensitive. Function block return values are under `result`, so use `<parseinput.result>` or
  `<parseinput.result.field>` only when the catalog declares that shape.
- Before applying a batch, enumerate every `<block.field>` reference in its inputs. Verify the
  normalized prefix against the exact upstream block name in workflow state, verify the field path
  against the catalog output schema, and verify the source is reachable upstream. A clean workflow
  operations lint does not prove block-output references resolve; its `unresolvedReferences` report
  covers resource-like references such as credentials, tools, and skills.

## Discover before composing

- Search the catalog with `sim --output json blocks list`; inspect a candidate with
  `sim --output json blocks get <blockId>`.
- Use the returned block id, operation ids, input ids, modes, conditions, credential fields, and
  outputs exactly. Never invent them from a display name or underlying tool id.
- Inspect `tools list` or `tools get` only when the block response points to a tool and its parameter
  or output contract is needed.
- Resolve credentials and resource identifiers before writing them into a graph. Do not embed raw
  secrets in an operations file.
- Discover trigger behavior from the catalog. A service trigger may be an integration block with
  trigger mode enabled, while a built-in trigger may have its own block type; never substitute a
  trigger configuration id for a block id.
- Select models, operations, and modes from the returned schema. Do not guess an id from a label or
  reuse an id from another integration.

## Author one semantic batch

Prefer `workflows operations apply` over full-state replacement. One batch can create several
blocks, edit existing blocks, delete blocks, and wire their edges atomically.

Every operation has one of these envelopes:

```json
[
  {
    "operation_type": "add",
    "block_id": "local-label",
    "params": { "type": "<catalog-block-id>", "name": "referenceSafeName", "inputs": {} }
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
      "name": "referenceSafeName",
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
block by matching its name. The request-local label does not become the block's variable-reference
prefix; `params.name` does.

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
advisory lint that remains. Confirm that changed references resolve, every branch reaches the
intended destination, nested blocks remain in the correct loop or parallel scope, and no block was
orphaned by a replaced connection set. Recompute reference prefixes from the persisted block names;
do not infer them from request-local labels or reformat them as snake_case.

Report the workflow id and its exact `webUrl` from the create or list response, formatting the URL as
a clickable link. Do not construct a workflow URL from ids or the profile's API origin; a missing
`webUrl` is a response-contract failure.

When the request includes a working or tested workflow and execution is safe, use the run skill to
manually test the saved draft with realistic input. Judge the returned values, not only the terminal
status, and fix then rerun when behavior is wrong. Manual runs require a personal API-key profile;
do not deploy merely to test. Do not execute a workflow whose external side effects have not been
authorized.
