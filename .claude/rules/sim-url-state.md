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

### When to use what (decision table)

| Home | Trigger | Example |
| --- | --- | --- |
| **URL (nuqs)** | Client view-state worth a link: tab, filter, search, sort, pagination, selected-entity id, an open "view" modal/drawer that is a destination | `?tab=licenses`, `?category=Communication`, `?page=3`, `?skillId=abc` |
| **React Query** | Server/remote data fetched from an endpoint | `useMcpServers(workspaceId)`, `useSkills(workspaceId)` |
| **Zustand** | Cross-component client state that must NOT be in the URL: high-frequency, large, ephemeral, socket-synced | canvas pan/zoom, live cursor, drag state, resize widths, unsaved buffers |
| **`useState`** | Purely local single-component UI; also the snappy mirror of a debounced URL search | a hover flag, a transient dialog target, the live text of a debounced search box |

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
- For an opaque/literal value use `parseAsStringLiteral([...] as const)`; for a custom wire format use [`createParser`](https://nuqs.dev/docs/parsers).
- A `createParser` for a value **not** comparable with `===` (arrays, objects, `Date`) **must** define an `eq` — `clearOnDefault` uses it to detect the default, so without it an empty-array/object default never strips from the URL. Built-in `parseAsArrayOf(...)` already ships its own `eq`; only string/number/boolean custom parsers can omit it. Example (array): `eq: (a, b) => a.length === b.length && a.every((v, i) => v === b[i])`.

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

Use nuqs's built-in [`limitUrlUpdates: debounce(ms)`](https://nuqs.dev/docs/options) — never hand-roll a local `useState` mirror + `useDebounce` + a URL write-back effect + a ref-guarded URL→local reconcile effect. The hook's returned value updates instantly (so the input is controlled directly by the nuqs value and stays snappy); only the *URL write* is debounced. Back/forward and deep links flow back natively because the input reads the nuqs value — no reconcile effect needed.

- **Standalone single search param** (`useQueryState`): put `limitUrlUpdates: debounce(300)` in the param's options.
- **Search inside a grouped `useQueryStates`**: keep the group's immediate writes for the discrete filters; pass the option **per call** only on the search setter, never on the whole group:

  ```typescript
  import { debounce } from 'nuqs'

  const setSearch = useCallback(
    (value: string) => {
      const next = value.length > 0 ? value : null
      // Immediate update when clearing so the param drops out without lingering.
      setFilters({ search: next }, next === null ? undefined : { limitUrlUpdates: debounce(300) })
    },
    [setFilters]
  )
  ```

- **Keep fetches/filtering debounced.** Where the search value feeds a React Query key or an expensive in-memory filter, derive a debounced value off the instant nuqs value (`const debounced = useDebounce(urlSearch, 300)`) and feed *that* to the query — the instant value is only for the input box. Cheap in-memory filtering over a small static list may read the instant value directly.
- Preserve `.trim()` handling, `clearOnDefault` (empty clears the param), the existing default, and `history: 'replace'`. Import `debounce` from `nuqs` (client) — not `nuqs/server`. See logs (`use-log-filters.ts` grouped, query stays debounced), integrations/recently-deleted (cheap in-memory filter, instant value), and tables (filter stays debounced).

## Sort convention (`sort` + `dir`)

Sortable lists use **two scalar params**, never a serialized `{column,direction}` object:

```typescript
const SORT_COLUMNS = ['name', 'created', 'updated'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const

export const thingsParsers = {
  sort: parseAsStringLiteral(SORT_COLUMNS).withDefault('updated'),
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault('desc'),
} as const
```

Both carry the shared filter options (`{ history: 'replace', clearOnDefault: true }`). The defaults must match the list's existing default sort exactly. If a UI exposes "no active sort" as `null`, derive that in the component (`sort === DEFAULT && dir === DEFAULT ? null : { column, direction }`) — the URL still holds the resolved values. "Clear sort" writes the defaults back (which `clearOnDefault` strips from the URL); never write `null`/garbage columns.

## Dates in the URL (date-only params)

A date-only param (a calendar anchor, a date filter) is stored as `yyyy-MM-dd` — never serialize a full `Date`/timestamp when only the day matters.

**Local vs UTC — pick the parser that matches your date math.** nuqs's built-in `parseAsIsoDate` is **UTC-based** (`serialize` via `toISOString()`, `parse` to UTC midnight). If your `Date` is local-time (e.g. produced by local-time helpers and read by `date-fns` `startOfWeek`/`isSameDay`, which are all local), `parseAsIsoDate` will shift the day by ±1 in any non-UTC timezone on reload/deep-link/back-forward. For local-time date math, use a small local-date `createParser` that serializes/parses on local calendar fields (`getFullYear`/`getMonth`/`getDate` ↔ `new Date(y, m-1, d)`) with an `eq` comparing y/m/d. Only use `parseAsIsoDate` when the value is genuinely UTC/midnight-UTC. See `scheduled-tasks/search-params.ts` (`parseAsLocalDate`).

When the default is **dynamic** (e.g. "today"), make the param **nullable** (omit `.withDefault`) and derive the fallback in the hook (`const anchor = param ?? today`), so a clean URL means the dynamic default and navigating back to it writes `null` (clears the param). See `scheduled-tasks/hooks/use-calendar.ts`.

## Selected-entity deep-link (store the id, derive the object)

To deep-link a row/modal/drawer to one entity, store **only its id** and look the object up in the already-loaded list — never serialize the object into the URL:

```typescript
const [skillId, setSkillId] = useQueryState(skillIdParam.key, {
  ...skillIdParam.parser,
  history: 'push', // opening an entity is a destination; "back" closes it
  clearOnDefault: true,
})
// Derive — do not duplicate into useState or sync with an effect:
const editingSkill = skillId ? (skills.find((s) => s.id === skillId) ?? null) : null
```

Open the panel/modal when the id resolves to a loaded entity; closing it calls `setSkillId(null)`. Because this reads `useSearchParams` it needs a **Suspense** boundary on the page (see below). A separate "create new" flow has no id and stays in local `useState`.

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

## Docs

- Adapters (App Router `NuqsAdapter`): https://nuqs.dev/docs/adapters
- Parsers & options (`parseAsString`/`parseAsInteger`/`parseAsBoolean`/`parseAsStringLiteral`/`parseAsArrayOf`/`createParser`, `withDefault`, `history`, `shallow`, `clearOnDefault`): https://nuqs.dev/docs/parsers and https://nuqs.dev/docs/options
- Server-side reads (`createSearchParamsCache`): https://nuqs.dev/docs/server-side
