---
paths:
  - "apps/sim/resources/**/*.ts"
  - "apps/sim/components/resources/**/*.ts"
  - "apps/sim/components/resources/**/*.tsx"
  - "apps/sim/app/workspace/[workspaceId]/**/*.tsx"
  - "apps/sim/app/f/**/*.tsx"
  - "apps/sim/app/i/**/*.tsx"
  - "apps/sim/app/(interfaces)/**/*.tsx"
  - "apps/sim/hooks/queries/workspace-files.ts"
---

# Resource Views

A **resource** is a thing a workspace holds that can also be shared: a file, a table, an interface, a knowledge base, a log, a scheduled task. A resource with a canonical view has **exactly one**, and every consumer mounts that one — the workspace route page, the mothership panel, an interface module, and the public share page.

**One view per resource. Consumers construct the axes and mount it. They never wrap it.**

Enforced by `bun run check:resources` (strict CI gate: `bun run check:resources:strict`), which is `scripts/check-resource-views.ts`.

## The three axes

`apps/sim/resources/**` is pure TypeScript — no React, no `'use client'` — because `app/i/[token]/page.tsx` builds a share source during SSR.

| Axis | Type | Replaces |
| --- | --- | --- |
| `source` | `WorkspaceSource<K> \| ShareSource<K>`, discriminated on `via` | `workspaceId`, `token`, `contentSource`, `isPublic`, `isShared` |
| `grants` | `{ write: boolean; run: 'none'\|'deployed'\|'draft' }` | `canEdit`, `canRun`, `canAdmin`, `canDelete`, `disableEdit/Insert/Delete` |
| `host` | `'page' \| 'panel' \| 'public'` | `embedded`, `isEmbedded`, `compact`, `minimal` |

There is no fourth axis. Agent streaming is **one optional prop on `FileView`** (`streaming?: FileViewStreaming`), because only files stream.

`ShareSource` declares `workspaceId?: never` and `resourceId?: never`, and `WorkspaceSource` declares `token?: never` and `seed?: never`. A share source **cannot** carry a workspace id — that is a compile error, not a convention. A kind whose seed is typed `never` (`knowledge`, `log`, `schedule`) structurally cannot construct a share source at all: "no public surface" is a compile-time fact.

```
apps/sim/resources/                    # kinds.ts · source.ts · grants.ts · host.ts — pure TS
apps/sim/components/resources/<unit>/  # 'use client' — THE view, one per resource
```

A resource kind with no canonical view yet (`table`, `knowledge`, `log`, `schedule`) is simply **absent** from `CANONICAL_UNITS` in the check. That is the correct state for an unmigrated kind. Do not add a flag, a shim, or a placeholder entry for it.

## Consume: construct the axes, then mount

That is the whole job. Same component, same props; only the constructed values differ.

```typescript
// app/f/[token]/public-file-view.tsx — anonymous share
const source = useMemo(
  () => shareSource({ kind: 'file', token, grantId: token, seed: { name, type, size, version } }),
  [token, name, type, size, version]
)
return <FileView source={source} grants={grantsForShare('file')} host='public' readOnly />
```

```typescript
// .../mothership-view/.../resource-content.tsx — panel, same view
const source = useMemo(
  () => workspaceSource({ kind: 'file', workspaceId, resourceId: file.id }),
  [workspaceId, file.id]
)
const grants = useMemo(() => grantsFromPermissions(permissions), [permissions])
return <FileView source={source} grants={grants} host='panel' streaming={streaming} />
```

- Import from the **unit barrel** (`@/components/resources/file-view`), never a file inside it.
- Copy that differs between workspace and share belongs on the **source** (`source.unavailableCopy`), not in the view. A share must never say "workspace" — that is what stops the view becoming an existence oracle.
- Links belong on the source too (`source.hrefFor(link)`), which returns `null` in share scope so nobody hand-builds `/workspace/${token}/…`.
- `host` decides chrome and URL ownership. `hostOwnsUrl(host)` is the single place the "embedded views do not write nuqs keys" rule lives.

## Never do this

**Never wrap a view.** A component whose body is a canonical view with its own props forwarded in is a wrapper. `check:resources` fails on the first one (`wrapperMounts` is at `0`).

```typescript
// ✗ Bad — adds a name, a file, and an import hop; adds no behavior.
export function EmbeddedFilePanel({ source, grants, host }: EmbeddedFilePanelProps) {
  return <FileView source={source} grants={grants} host={host} />
}

// ✓ Good — the consumer constructs the axes and mounts the view itself.
const source = workspaceSource({ kind: 'file', workspaceId, resourceId })
return <FileView source={source} grants={grants} host='panel' />
```

**Never add a fourth spelling.** If the view cannot express what you need, change `source` / `grants` / `host` — one place, every consumer — or collapse the need into an existing optional object (`streaming`, `editing`). Do not add a loose prop.

```typescript
// ✗ Bad — three axes, spelled four wrong ways.
<FileView workspaceId={id} canEdit embedded streamingContent={text} isAgentEditing />

// ✓ Good
<FileView source={source} grants={grants} host='panel' streaming={{ content: text, isAgentEditing }} />
```

**Never reimplement.** If a view has no seam for what you need, **add the seam**. A hand-rolled mini-table loses booleans, JSON, dates, links, resource chips, pinned columns and windowing — every one of which the real view already handles.

**Never reach past the barrel.**

```typescript
// ✗ Bad — binds you to the unit's private layout
import { resolveFileCategory } from '@/components/resources/file-view/file-category'

// ✓ Good
import { resolveFileCategory } from '@/components/resources/file-view'
```

The one sanctioned exception is a `lazy()` code-split point, where routing through the barrel silently re-attaches the split chunk (`apps/sim` has no `sideEffects: false`). Those go in `INTERNAL_IMPORT_ALLOWLIST` in the check, keyed by importer **and** specifier.

**Never import the workspace route tree from an anonymous surface.** `app/f/**`, `app/i/**`, `app/(interfaces)/**`, `app/(shared)/**` and public API routes may not import `@/app/workspace/[workspaceId]/**`. Shared units live in `apps/sim/components/resources/**`. Nesting under a `[workspaceId]` segment is exactly why `workspaceId: string` once read as natural on a component anonymous visitors mounted with a **share token**.

**Never read route or permission context inside a unit.** No `useRouter`, `useParams`, `useSearchParams`, `usePathname`, `useQueryState(s)`, or `useUserPermissionsContext` under `apps/sim/components/resources/**`. Addressing is `source`, navigation targets are `source.hrefFor(link)`, capability is `grants`, URL ownership is `host`. A component that falls back to `useParams()` can only ever exist once per page.

**Never put `'use client'` in `apps/sim/resources/**`.** Next rewrites every export of a `'use client'` module into a client reference in the server bundle, so the Server Component that builds a share source would throw at runtime.

## Escape hatch

Four annotations, reason mandatory, on the line directly above the offending mount / import / attribute (up to three preceding comment lines of extra context are tolerated):

```typescript
// boundary-resource-wrapper:  <reason>
// boundary-resource-internal: <reason>
// boundary-resource-tree:     <reason>
// boundary-resource-prop:     <reason>
```

An annotation with an empty reason is still a finding **and** trips `annotationsMissingReason`. Whole-file exceptions go through `INTERNAL_IMPORT_ALLOWLIST` / `CROSS_TREE_ALLOWLIST` in `scripts/check-resource-views.ts`, not per-line annotations.

## Checklist before you add a component near a resource

1. Does a canonical view already exist for this kind? Mount it.
2. Does it exist but lack a seam? Add the seam in the unit and thread it — do not fork the UI.
3. Is your new component only forwarding props into a view? Delete it; mount the view at the call site.
4. Are you about to write `embedded`, `canEdit`, `canRun`, `isPublic`, `token` or `workspaceId` on a view? Map it to `source` / `grants` / `host`.
5. Run `bun run check:resources`. The success metric is **consumers per view going up and component count going down**.
