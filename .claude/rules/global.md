# Global Standards

## Logging
Import `createLogger` from `@sim/logger`. Use `logger.info`, `logger.warn`, `logger.error` instead of `console.log`. Inside API routes wrapped with `withRouteHandler`, loggers automatically include the request ID.

## API Route Handlers
All API route handlers must run inside `withRouteHandler`. Ordinary internal and v2 JSON/binary handlers use the shared route builders, which already apply it; never double-wrap them. Use raw `withRouteHandler` only for documented protocol or lifecycle exceptions. Never export a bare `async function GET/POST/...`.

## Application Operation Boundary
Every protected read, write, canonical lookup, or authorization-sensitive reference resolution must enter through an authorized application use case. Surfaces authenticate and build a `Principal`, rate-limit, parse, map input, call the use case, and present their own result. They must not query protected data, decide resource authorization, implement business transactions, or record semantic audit.

Define one stable semantic operation with its role, workspace-key policy, principal kinds, and delegated services. Internal, v2, Copilot, and trusted-tool adapters call the same use case when domain behavior is the same. Copilot uses `createCopilotApplicationAdapter`; it is not a separate protected business layer. Protected compound mutations require one top-level semantic application operation. Never substitute billing attribution, an uploader, creator, or key owner for the acting principal. Use the `migrate-application-operation` skill for new or migrated protected operations.

## Comments
Use TSDoc for documentation. No `====` separators. No non-TSDoc comments.

## Styling
Never update global styles. Keep all styling local to components.

## ID Generation
Never use `crypto.randomUUID()`, `nanoid`, or the `uuid` package directly. Use the utilities from `@sim/utils/id`:

- `generateId()` — UUID v4, use by default
- `generateShortId(size?)` — short URL-safe ID (default 21 chars), for compact identifiers

Both use `crypto.getRandomValues()` under the hood and work in all contexts including non-secure (HTTP) browsers.

```typescript
// ✗ Bad
import { nanoid } from 'nanoid'
import { v4 as uuidv4 } from 'uuid'
const id = crypto.randomUUID()

// ✓ Good
import { generateId, generateShortId } from '@sim/utils/id'
const uuid = generateId()
const shortId = generateShortId()
const tiny = generateShortId(8)
```

## Common Utilities
Use shared helpers from `@sim/utils` instead of writing inline implementations:

- `sleep(ms)` from `@sim/utils/helpers` — async delay. Never write `new Promise(resolve => setTimeout(resolve, ms))`
- `toError(value)` from `@sim/utils/errors` — normalize unknown caught values to `Error`. Never write `e instanceof Error ? e : new Error(String(e))`
- `getErrorMessage(value, fallback?)` from `@sim/utils/errors` — extract error message string. Never write `e instanceof Error ? e.message : 'fallback'`
- `structuredClone(value)` — built-in deep clone, no import needed. Never write `JSON.parse(JSON.stringify(obj))`
- `omit(obj, keys)` from `@sim/utils/object` — remove keys from object
- `filterUndefined(obj)` from `@sim/utils/object` — strip undefined-valued keys. Never write `Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))`
- `truncate(str, maxLength, suffix?)` from `@sim/utils/string` — safe string truncation with ellipsis
- `backoffWithJitter(attempt, retryAfterMs, options?)` from `@sim/utils/retry` — exponential backoff with jitter
- `parseRetryAfter(header)` from `@sim/utils/retry` — parse HTTP `Retry-After` header to milliseconds

```typescript
// ✗ Bad
await new Promise(resolve => setTimeout(resolve, 1000))
const msg = error instanceof Error ? error.message : 'Unknown error'
const clone = JSON.parse(JSON.stringify(obj))
const filtered = Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))

// ✓ Good
import { sleep } from '@sim/utils/helpers'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { filterUndefined } from '@sim/utils/object'
await sleep(1000)
const msg = getErrorMessage(error, 'Unknown error')
const clone = structuredClone(obj)
const filtered = filterUndefined(obj)
```

## Deployment flags in the browser
Client code inside a workspace reads `hosted`, `billingEnabled`, `chatEnabled`, and the enterprise feature set through `useDeploymentShape()` (components) or `getDeploymentShape()` (block conditions, stores, helpers) from `@/lib/core/config/deployment-shape`, never the `isHosted`/`isBillingEnabled` constants from `env-flags`. Those constants freeze at module init from the root layout's `NEXT_PUBLIC_*` transport, which Next's bare 404 shell and `global-error` never emit, so a tab recovered from one would render Sim Cloud as self-hosted. The reader is seeded from the server-resolved workspace host context. Server code keeps reading `env-flags`.

## Package Manager
Use `bun` and `bunx`, not `npm` and `npx`.

## Type-checking
`tsc` must resolve to the native (Go) TypeScript 7 compiler. Do not remove the `@typescript/native` alias from the root `devDependencies` — nothing imports it, and deleting it looks harmless.

`apps/sim` needs `@typescript/typescript6` for its runtime TypeScript API, and that package depends on `@typescript/old` — an alias of `typescript@6` — which declares its own `tsc` bin. Package managers pick bin winners by lexical sort rather than dependency depth, so `@typescript/old` beats `typescript` and `node_modules/.bin/tsc` silently becomes the JavaScript TypeScript 6 compiler: identical diagnostics, ~10x slower (83s vs 8s on `apps/sim`). The `@typescript/native` alias exists only to sort ahead of `@typescript/old`.

`bun run check:native-typecheck` fails the build if a bare `tsc` stops reporting 7.x — which is also what a newly added package that sorts ahead of `@typescript/native` and ships a `tsc` bin would look like. See [microsoft/typescript-go#4567](https://github.com/microsoft/typescript-go/issues/4567).
