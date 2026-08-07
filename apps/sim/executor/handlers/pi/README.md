# PI Handler

Implements the PI block executor. Each sub-mode delegates to a dedicated backend while sharing common infrastructure.

## Folder layout

| Path | Responsibility |
| --- | --- |
| `pi-handler.ts` | Single dispatcher — reads the block's mode and routes to the correct backend |
| `core/backend.ts` | Backend contracts — all run-params types, `PiRunContext`, `PiRunResult`, and `PiBackendRun` |
| `core/context.ts` | Skills-resolution and memory helpers (`resolvePiSkills`, `loadPiMemory`, `buildPiPrompt`, `appendPiMemory`) |
| `core/events.ts` | Streaming event helpers |
| `core/keys.ts` | API-key resolution utilities |
| `core/pi-sdk.ts` | Thin wrapper around the PI SDK client |
| `core/redaction.ts` | Secret redaction for logs and responses |
| `cloud/shared.ts` | Shared GitHub and sandbox utilities (repo helpers, polling, etc.) |
| `cloud/github-pr.ts` | Low-level GitHub PR API wrappers |
| `cloud/authoring/backend.ts` | Create PR and Update PR implementation |
| `cloud/review/backend.ts` | Review Code implementation |
| `cloud/review/tools.ts` | Tool definitions injected into the review agent |
| `cloud/review/tools-script.ts` | Script loaded by the review tools |
| `cloud/babysit/backend.ts` | PR review / check continuation (babysit mode) |
| `cloud/babysit/github.ts` | GitHub status/check polling helpers |
| `cloud/babysit/round.ts` | Single babysit iteration logic |
| `local/backend.ts` | Local Dev mode — SSH-connected local machine |
| `local/sim-tools.ts` | Sim-side tool implementations |
| `local/ssh-tools.ts` | SSH tool implementations |
| `search/tool.ts` | Search tool definition |
| `search/normalize.ts` | Result normalisation |
| `search/extension-source.ts` | Extension-based source adapter |

## Dispatch flow

`pi-handler.ts` is the sole entry point registered in the executor. It inspects the block's `mode` field and calls the matching backend's `run()` method. All backends receive a typed `PiRunContext` (from `core/backend.ts`) and stream incremental events back through `core/events.ts`.

<!-- memory-probe: Path | Responsibility -->
