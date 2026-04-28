# Workflow Load Tests

These local-only Artillery scenarios exercise `POST /api/workflows/[id]/execute` in async mode.

## Requirements

- The app should be running locally, for example with `bun run dev:full`
- Each scenario needs valid workflow IDs and API keys
- All scenarios default to `http://localhost:3000`

The default rates are tuned for these local limits:

- `ADMISSION_GATE_MAX_INFLIGHT=500`

The admission gate caps total in-flight requests per pod.

## Baseline Concurrency

Use this to ramp traffic into one workflow and observe normal queueing behavior.

Default profile:

- Starts at `2` requests per second
- Ramps to `8` requests per second
- Holds there for `20` seconds
- Good for validating queueing against a Free workspace concurrency of `5`

```bash
WORKFLOW_ID=<workflow-id> \
SIM_API_KEY=<api-key> \
bun run load:workflow:baseline
```

Optional variables:

- `BASE_URL`
- `WARMUP_DURATION`
- `WARMUP_RATE`
- `PEAK_RATE`
- `HOLD_DURATION`

For higher-plan workspaces, a good local starting point is:

- Pro: `PEAK_RATE=20` to `40`
- Team or Enterprise: `PEAK_RATE=50` to `100`

## Queueing Waves

Use this to send repeated bursts to one workflow in the same workspace.

Default profile:

- Wave 1: `6` requests per second for `10` seconds
- Wave 2: `8` requests per second for `15` seconds
- Wave 3: `10` requests per second for `20` seconds
- Quiet gaps: `5` seconds

```bash
WORKFLOW_ID=<workflow-id> \
SIM_API_KEY=<api-key> \
bun run load:workflow:waves
```

Optional variables:

- `BASE_URL`
- `WAVE_ONE_DURATION`
- `WAVE_ONE_RATE`
- `QUIET_DURATION`
- `WAVE_TWO_DURATION`
- `WAVE_TWO_RATE`
- `WAVE_THREE_DURATION`
- `WAVE_THREE_RATE`

## Two-Workspace Isolation

Use this to send mixed traffic to two workflows from different workspaces and compare whether one workspace's queue pressure appears to affect the other.

Default profile:

- Total rate: `9` requests per second for `30` seconds
- Weight split: `8:1`
- In practice this sends heavy pressure to workspace A while still sending a light stream to workspace B

```bash
WORKFLOW_ID_A=<workspace-a-workflow-id> \
SIM_API_KEY_A=<workspace-a-api-key> \
WORKFLOW_ID_B=<workspace-b-workflow-id> \
SIM_API_KEY_B=<workspace-b-api-key> \
bun run load:workflow:isolation
```

Optional variables:

- `BASE_URL`
- `ISOLATION_DURATION`
- `TOTAL_RATE`
- `WORKSPACE_A_WEIGHT`
- `WORKSPACE_B_WEIGHT`

## Notes

- `load:workflow` is an alias for `load:workflow:baseline`
- All scenarios send `x-execution-mode: async`
- Artillery output will show request counts and response codes, which is usually enough for quick local verification
- At these defaults, you should see `429` responses when approaching `ADMISSION_GATE_MAX_INFLIGHT=500`
- If you still see lots of `429` or `ETIMEDOUT` responses locally, lower the rates again before increasing durations
