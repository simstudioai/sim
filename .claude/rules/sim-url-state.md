---
paths:
  - "apps/sim/app/**/*.tsx"
  - "apps/sim/app/**/*.ts"
  - "apps/sim/app/**/search-params.ts"
---

# URL / Query-Param State (nuqs)

URL query state is managed with [`nuqs`](https://nuqs.dev). The `NuqsAdapter` is wired once in `apps/sim/app/layout.tsx` — do not add another. This rule is the source of truth for *what* belongs in the URL and *how* to wire it.

## Decision framework — where does this state live?

Pick exactly one home for each piece of state:

- **React Query** → server/remote data. Unchanged; see `.claude/rules/sim-queries.md`.
- **URL params (nuqs)** → client view-state worth putting in a link: active tab/panel, selected entity id, filters, search query, pagination, view mode (list/grid), an open "view" drawer/modal that represents a destination.
- **Zustand** → cross-component client state that must NOT be in the URL: high-frequency, large, ephemeral, or socket-synced (canvas pan/zoom, cursor, drag state, resize widths, unsaved buffers, live collaborative selection).
- **`useState`** → purely local, single-component UI.

Put state in the URL **only** when it is *all* of: shareable, deep-linkable, bookmarkable, survives reload + back/forward — **and** is discrete, low-frequency, and small. If it fails any of those, it does not go in the URL.

## Anti-patterns (forbidden)

- Direct `useSearchParams().get(...)` or `new URLSearchParams(window.location.search)` to **read** state.
- Hand-built query strings + `router.replace`/`router.push` to **mutate** state.
- `window.history.replaceState`/`pushState` to mutate a param.
- Duplicating URL state into a store and syncing it with effects / `popstate` listeners.
- High-frequency or large state in the URL (cursor, pan/zoom, un-debounced keystrokes, big JSON blobs).
- `import { z } from 'zod'` in client code for param validation — use nuqs parsers (`parseAsString`, `parseAsInteger`, `parseAsBoolean`, `parseAsStringLiteral`, `parseAsArrayOf`) or a custom `createParser`.

These reads/mutations are **not** anti-patterns and stay as-is:

- **Outbound URL builders** — `new URLSearchParams({...})` to construct a `href`, a download endpoint, an external WebSocket/API URL, or a `window.open(_, '_blank')` destination.
- **Route navigations** — `router.push('/path/[id]?folderId=x')` that changes the route *path*, not just the current query. A nuqs setter only mutates the query on the current path; cross-path navigation stays on `router`.
- **Read-once auth / redirect signals** — `token`, `callbackUrl`, `redirect`, `error`, `invite_flow`, `upgraded`, `redirect_workflow`, etc. These are navigation signals consumed once (often read-then-strip), not synced view-state. Leave them on `useSearchParams`.

## Per-feature `search-params.ts` — single source of truth

Co-locate a `search-params.ts` next to the feature. Export the parser map (and shared options). Both the client (`useQueryStates`/`useQueryState`) and any server component (`createSearchParamsCache` from `nuqs/server`) import from this one file. Import parsers from `nuqs/server` so the module is safe to import in both client and server contexts.

Conventions:

- `.withDefault(...)` on every parser so reads are non-null.
- Filter / search / toggle / pagination options: `{ history: 'replace', shallow: true, clearOnDefault: true }` — clean URLs, no back-stack churn.
- Navigations that belong in browser history (changing folder, opening a deep-linked entity): `{ history: 'push' }`.
- `shallow: false` **only** when a Server Component / loader must re-read the param.
- Short, stable, **kebab-case** URL keys. Renaming a key is a breaking change to shared links — treat it as one.
- For an opaque/literal value use `parseAsStringLiteral([...] as const)`; for a custom wire format use `createParser`.

### Example — grouped filters (single source of truth)

```typescript
// apps/sim/app/workspace/[workspaceId]/things/search-params.ts
import { parseAsArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server'

const VIEW_MODES = ['list', 'grid'] as const

export const thingsParsers = {
  search: parseAsString.withDefault(''),
  tags: parseAsArrayOf(parseAsString).withDefault([]),
  view: parseAsStringLiteral(VIEW_MODES).withDefault('list'),
} as const

/** Clean URLs, no back-stack churn for filter changes. */
export const thingsUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const
```

### Client — `useQueryStates` (grouped) / `useQueryState` (single)

```typescript
'use client'

import { useQueryStates } from 'nuqs'
import { thingsParsers, thingsUrlKeys } from '@/app/workspace/[workspaceId]/things/search-params'

export function useThingFilters() {
  const [filters, setFilters] = useQueryStates(thingsParsers, thingsUrlKeys)
  // filters.search / filters.tags / filters.view are non-null (defaults applied)
  // setFilters({ view: 'grid' }) — pass null to clear a single key back to default
  return { filters, setFilters }
}
```

For a single param, use `useQueryState(key, parser)`:

```typescript
const [serverId, setServerId] = useQueryState(mcpServerIdParam.key, mcpServerIdParam.parser)
```

### Server — `createSearchParamsCache`

When a Server Component or loader must read a param, build a cache from the **same** parser map:

```typescript
// in a server component / page.tsx
import { createSearchParamsCache } from 'nuqs/server'
import { thingsParsers } from '@/app/workspace/[workspaceId]/things/search-params'

const thingsCache = createSearchParamsCache(thingsParsers)

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { search, view } = await thingsCache.parse(await searchParams)
  // ...
}
```

If a client param must be re-read server-side after a change, set `shallow: false` on the write.

## Suspense boundary

`useQueryState`/`useQueryStates` read `useSearchParams` internally, so any client component using them must sit under a `<Suspense>` boundary (Next.js requirement). Wrap the page entry with a real-chrome fallback so a suspend never flashes a blank frame — see `apps/sim/app/workspace/[workspaceId]/files/page.tsx`.

## Debounced text inputs

Keep local `useState` for snappy typing; push to the URL debounced, and reconcile from the URL with a ref-guarded effect so external URL changes (back/forward, deep link) flow back into the input without clobbering in-flight keystrokes. This is the established logs pattern — follow it rather than writing every keystroke to the URL.

## Read-then-strip deep links

For an ephemeral deep-link that pre-opens a modal/drawer and should not linger in the URL (e.g. integrations `?connect=oauth`, knowledge `?addConnector=`), read the param, act on it once behind a `useRef` guard, then clear it: `setParam(null, { history: 'replace', scroll: false })`. See `apps/sim/app/workspace/[workspaceId]/integrations/[block]/integration-block-detail.tsx`.

## Workflow editor carve-out — what must NOT go in the URL

The workflow editor (`apps/sim/app/workspace/[workspaceId]/w/**`) is realtime/socket-synced via `socket-provider.tsx`. Its view-state is intentionally store-backed (Zustand), not URL-backed. Do **not** move the following into the URL:

- **Live cursor** and **broadcast live selection** (presence; emitted over the socket, throttled).
- **Pan / zoom / viewport** (ReactFlow-owned, continuous, not persisted).
- **Drag state** and **resize widths/heights** (panel/terminal/sidebar — high-frequency, persisted as local preferences).
- **Ephemeral diff staging** (`hasActiveDiff`, `baselineWorkflow`, `diffAnalysis`).

Borderline candidates that *look* shareable but currently stay in Zustand because moving them fights existing machinery:

- **Panel `activeTab`** and **`canvasMode`** — persisted local *preferences* wired into an SSR flash-prevention path (`data-panel-active-tab` + `_hasHydrated`). They are layout prefs, not destinations; moving them would unwind the SSR machinery and risk tab-flash on load.
- **`focusedBlockId`** ("look at this block") — the only genuinely shareable candidate, but it is entangled with the persisted editor store and panel-open orchestration. Adding it is a *new feature*, not a migration; ship it deliberately (with runtime verification against a live socket), not as part of a sweep.

Rule of thumb for the editor: if state is socket-coupled, high-frequency, viewport-related, or a persisted resize/preference, it stays in Zustand. When in doubt, leave it and flag it — do not force fragile URL state into the canvas.
