# PI Handler

Implements the PI block executor. Each sub-mode delegates to a dedicated backend while sharing common infrastructure.

## Folder layout

```
pi/
├── pi-handler.ts          # Single dispatcher — reads the block's mode and routes to the correct backend
├── core/                  # Shared contracts and infrastructure
│   ├── backend.ts         # Backend contracts — all run-params types, PiRunContext, PiRunResult, and PiBackendRun
│   ├── context.ts         # Skills-resolution and memory helpers (resolvePiSkills, loadPiMemory, buildPiPrompt, appendPiMemory)
│   ├── events.ts          # Streaming event helpers
│   ├── keys.ts            # API-key resolution utilities
│   ├── pi-sdk.ts          # Thin wrapper around the PI SDK client
│   └── redaction.ts       # Secret redaction for logs and responses
├── cloud/                 # Cloud mode — GitHub-hosted sandboxes
│   ├── shared.ts          # Shared GitHub and sandbox utilities (repo helpers, polling, etc.)
│   ├── github-pr.ts       # Low-level GitHub PR API wrappers
│   ├── authoring/         # Create PR and Update PR implementation
│   │   └── backend.ts
│   ├── review/            # Review Code implementation
│   │   ├── backend.ts
│   │   ├── tools.ts       # Tool definitions injected into the review agent
│   │   └── tools-script.ts
│   └── babysit/           # PR review / check continuation (babysit mode)
│       ├── backend.ts
│       ├── github.ts      # GitHub status/check polling helpers
│       └── round.ts       # Single babysit iteration logic
├── local/                 # Local Dev mode — SSH-connected local machine
│   ├── backend.ts
│   ├── sim-tools.ts       # Sim-side tool implementations
│   └── ssh-tools.ts       # SSH tool implementations
└── search/                # Shared search support used across modes
    ├── tool.ts            # Search tool definition
    ├── normalize.ts       # Result normalisation
    └── extension-source.ts # Extension-based source adapter
```

## Dispatch flow

`pi-handler.ts` is the sole entry point registered in the executor. It inspects the block's `mode` field and calls the matching backend's `run()` method. All backends receive a typed `PiRunContext` (from `core/backend.ts`) and stream incremental events back through `core/events.ts`.
