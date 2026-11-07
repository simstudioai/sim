---
description: Modern shared EMCN components and surface packages
paths:
  - "packages/emcn/**"
  - "packages/emcn-auth/**"
  - "packages/emcn-docs/**"
  - "packages/emcn-platform/**"
---

# Modern EMCN

Read `packages/emcn/AGENTS.md` and `packages/emcn/README.md`. The modern system derives from the new Platform UI. Shared primitives and foundations live in the EMCN package; Auth, Docs and Platform own only their specific compositions. `@sim/emcn-legacy` serves unreplaced routes and cannot enter the new package graph.

Import the public family (`@sim/emcn/button`, `@sim/emcn-auth/shell`) rather than an aggregate or a private source file. Keep each component's CSS and private helpers in its family folder. Use Base UI for complex interaction behavior, shared semantic roles for paint and geometry, and props for supported states. Keep data, permissions, routing and fixtures in the applications.

Unreplaced legacy routes follow `emcn-legacy-components.md` and `sim-styling.md`. Its chip recipes do not describe modern EMCN.
