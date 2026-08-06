---
name: add-managed-cli
description: Add or upgrade a curated, immutable managed CLI for Sim Function sandboxes, including client-safe catalog metadata, a pinned server-only installation recipe, checksum and executable verification, provider compatibility, PATH propagation, content-addressed image identity, and tests. Use when adding a CLI to the Sandbox managed-CLI selector or changing an existing managed CLI version or recipe.
---

# Add a Managed CLI

Add CLIs through the curated registry. Never turn this surface into arbitrary commands or package names: system packages already cover validated Debian/APT coordinates, while managed CLIs require immutable artifacts and reproducible recipes.

## Read First

Read these live sources before editing; do not copy their current entries into this skill:

1. `apps/sim/lib/execution/remote-sandbox/cli-tools.ts` — persisted IDs and client-safe metadata.
2. `apps/sim/lib/execution/remote-sandbox/cli-tools.server.ts` — server-only recipes and recipe helpers.
3. `apps/sim/lib/execution/remote-sandbox/cli-tools.test.ts` — catalog and supply-chain invariants.
4. `apps/sim/lib/execution/remote-sandbox/cli-tools-boundary.test.ts` — client/server import boundary.
5. `apps/sim/lib/execution/remote-sandbox/sandbox-spec.ts` — content-addressed hash inputs.

Read `resolve.ts` and `e2b.ts` only when changing provisioning mechanics. A normal catalog addition should not require UI, API, database, resolver, or provider edits; those paths derive from the registries.

Do not modify the dedicated Function base image or the separate Mothership Shell template for a normal managed CLI addition. Managed recipes layer on the Function base image. Do not change `MAX_SANDBOX_CLI_TOOLS` from ten unless the user separately requests a product-limit change.

## 1. Verify the Upstream Release

Use primary upstream release documentation and official artifacts. Establish all of the following before writing code:

- Exact version and stable Linux x86-64 artifact URL. Never use `latest`, mutable redirects, or an unversioned installer.
- SHA-256 for the exact artifact. Prefer a publisher-signed checksum; otherwise download the official artifact and compute it independently.
- Archive layout and the exact executable paths to install.
- Noninteractive, credential-free verification commands for every advertised executable, normally version commands.
- Required PATH entries under `/opt/sim-cli`.
- E2B and Daytona compatibility. Default to both only when the same Linux recipe works on both.

When the user does not name a version, select the current stable upstream release from primary sources and state the exact version chosen. Do not silently choose a prerelease or infer a version from an unverified secondary source.

Reject curl-to-shell installers, `npm install`, `pip install`, distro package repositories, arbitrary user commands, and artifacts from unofficial mirrors. Never place credentials, tokens, login commands, or account configuration in an image recipe or build log; authentication is runtime-only.

## 2. Choose an Immutable ID

Use `<tool>@<upstream-version>-r<recipe-revision>`.

- New upstream version: append a new ID ending in `-r1`.
- Recipe-only change for the same upstream version: append `-r2`, `-r3`, and so on.
- Never mutate or delete an existing ID or recipe. Persisted sandboxes must continue resolving to the bytes and behavior they selected.
- On upgrade, retain the old ID and recipe and set its metadata to `selectable: false`. Only the newest version keeps the public label selectable.

Before shipping the first upgrade for a tool family, verify that editing a sandbox cannot leave both the retired and replacement IDs selected. If the generic selector and API validation do not already replace or reject colliding versions, address that once at the generic registry boundary with focused UI and contract tests; never special-case the individual CLI or silently install two versions that expose the same executable.

Recipe identity includes the ID, revision, and SHA-256 in the sandbox image hash. Keeping old entries is what makes that identity reproducible rather than merely cache-busting.

## 3. Add Client-Safe Metadata

In `cli-tools.ts`:

1. Append the ID to `SANDBOX_CLI_TOOL_IDS` in the same order used by the metadata and recipe registries.
2. Add a `SANDBOX_CLI_TOOLS` entry whose key and `id` exactly match.
3. Provide a unique selectable `label`, concise `description`, existing `category`, and useful executable/vendor aliases in `searchTerms`.
4. Add a category only when no existing category is accurate, then ensure it has at least one selectable entry.

Keep this file safe for client bundles. It must not contain artifact URLs, checksums, install commands, verification commands, PATH recipes, provider SDKs, or imports from `cli-tools.server.ts`.

The API enum and searchable grouped selector derive from this registry. Do not add parallel option arrays or route-local wire types.

## 4. Add the Server-Only Recipe

In `cli-tools.server.ts`, use the narrowest existing helper:

- `defineBinaryRecipe` for one downloaded binary.
- `defineTarGzipRecipe` or `defineZipRecipe` for archives containing binaries.
- `defineVerifiedRecipe` for a vendor archive or installer layout that needs explicit commands.
- A direct typed entry only when the helpers cannot faithfully model the release.

Provide every field the recipe contract requires:

- Exact `version`, `artifactUrl`, `artifactName`, and lowercase 64-character `sha256`.
- Every installed `executable` and a corresponding `verificationCommands` entry.
- Deterministic extraction/install commands into `/opt/sim-cli`; quote fixed paths and clean temporary artifacts.
- `pathEntries` when the executable is not installed into the helper's default `bin` directory.
- `supportedProviders` only when it differs from the E2B-and-Daytona default.
- `revision` when it differs from `1`; it must agree with the ID suffix.

Verification must prove the command is discoverable through `sandboxCliEnvironment`, not authenticate or contact a user account. Recipe commands run as root during both prebuilt image creation and runtime provisioning.

If the artifact host is new, add only the exact official hostname to the `officialHosts` allowlist in `cli-tools.test.ts`. Treat that as a supply-chain review, not a way to silence the test.

## 5. Preserve Generic Behavior

Confirm the existing generic paths remain sufficient:

- `sandboxCliToolRecipes` canonicalizes and resolves the recipe.
- `sandboxCliEnvironment` propagates PATH to Python subprocesses, JavaScript subprocesses, and Shell.
- E2B bakes the recipe into the custom image; runtime-strategy providers install it within the Function timeout.
- CLI-only sandboxes remain buildable even with no language packages.
- `hashSandboxSpec` includes recipe ID, revision, and checksum while preserving the legacy hash for an empty CLI list.
- The settings selector derives groups and search aliases from client-safe metadata.

Do not special-case a CLI in those layers unless the registry contract cannot express a genuine provider requirement. Extend the registry contract generically when multiple CLIs need the same new behavior.

## 6. Test the Addition

Extend tests when the new entry introduces behavior not already covered:

- For every upgrade, add a regression proving the old ID and recipe remain resolvable but non-selectable, while the replacement ID is selectable.
- Add important executable aliases to the table-driven search assertion.
- Add a focused assertion for a multi-executable recipe, custom PATH, or restricted provider.
- Add an opt-in credentialed smoke test only when installation plus a real minimal command cannot be validated without authentication. Read credentials from test-only environment variables, skip by default, create them only at runtime, and always tear down the sandbox.

Never commit downloaded artifacts or credentials.

## Required Validation

From `apps/sim`:

```bash
bunx vitest run \
  lib/execution/remote-sandbox/cli-tools.test.ts \
  lib/execution/remote-sandbox/cli-tools-boundary.test.ts \
  lib/execution/remote-sandbox/sandbox-spec.test.ts \
  lib/execution/remote-sandbox/resolve.test.ts \
  lib/api/contracts/sandboxes.test.ts \
  'app/workspace/[workspaceId]/settings/components/sandboxes/utils.test.ts' \
  'app/workspace/[workspaceId]/settings/components/sandboxes/components/sandbox-editor.test.tsx'
```

From the repository root:

```bash
bun run type-check
bun run check:api-validation
bunx biome check \
  apps/sim/lib/execution/remote-sandbox/cli-tools.ts \
  apps/sim/lib/execution/remote-sandbox/cli-tools.server.ts \
  apps/sim/lib/execution/remote-sandbox/cli-tools.test.ts
git diff --check
```

For a new recipe, also exercise its install and every verification command in an actual E2B or Daytona sandbox when credentials and network access are available. Report clearly when only registry/unit validation ran.

## Completion Checklist

- [ ] Official immutable Linux x86-64 artifact and SHA-256 verified.
- [ ] Versioned ID appended; old IDs and recipes retained.
- [ ] Client metadata is searchable, categorized, unique, and recipe-free.
- [ ] Server recipe is pinned, integrity-checked, noninteractive, and credential-free.
- [ ] Every advertised executable has an offline verification command and PATH entry.
- [ ] Provider compatibility is explicit and accurate.
- [ ] Catalog, boundary, hash, resolver, type, API-validation, format, and diff checks pass.
- [ ] Real provider installation was tested, or the missing live verification is disclosed.
