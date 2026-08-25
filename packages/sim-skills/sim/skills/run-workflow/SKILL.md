---
name: run-workflow
description: Test and debug Sim workflows through the sim CLI using manual runs, trigger payloads, run-from-block, selected outputs, and run records. Use after authoring or when diagnosing execution; not for graph edits or deployment changes.
---

# Run a Sim Workflow

Choose the execution mode that answers the user's question, then verify the terminal result rather
than treating request acceptance as success.

## Choose saved state or deployment

- Use `sim --output json workflows run <workflowId>` to run the active deployment.
- Add `--manual` to run the current saved draft without deploying it. Manual execution and
  run-from-block require a personal API-key profile; a workspace API key is not permitted.
- Do not deploy a draft merely to test it.

A workflow does not need a Start block for a plain manual run:

```bash
sim --output json workflows run <workflowId> --manual --input @input.json
```

To enter through a runnable trigger, use its block id and provide either explicit input or its
server-derived mock payload:

```bash
sim --output json workflows run <workflowId> \
  --manual --trigger <triggerBlockId> --mock-payload
```

Do not combine `--mock-payload` with `--input`. Do not add `--async` to a manual run.

## Run from a block

Run-from-block resumes a saved draft at one block using persisted upstream state from an exact prior
run:

```bash
sim --output json workflows run <workflowId> \
  --from-block <blockId> --source-run <runId>
```

Do not guess a source run or synthesize upstream outputs. Confirm that the source run belongs to the
workflow and contains the state the selected block needs.

## Keep output focused

- Use repeated `--select-output <blockName.field>` values when only specific outputs matter.
- Use `--follow` for a synchronous live run. Add `--include-thinking` or `--include-tool-calls` only
  when the user needs those diagnostics.
- Use `--async` only for deployed runs that should return immediately. Then wait with
  `workflows runs wait` or inspect with `workflows runs get`; do not poll without a stopping bound.

## Diagnose failures

1. Read the returned run id, status, error, and selected outputs.
2. Inspect the run with
   `sim --output json workflows runs get <runId> --workflow <workflowId> --include-output`.
3. Read the workflow state and confirm the failing block's current inputs and connections.
4. Correct the graph with the build skill. Do not hide a deterministic failure behind retries or a
   different execution mode.

Report which mode ran, the terminal status, and the relevant output or error. Include the run id when
the selected execution mode returns one; `--follow` streams omit it. Never print profile credentials
or raw secrets from block inputs.
