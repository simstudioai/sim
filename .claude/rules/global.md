# Global Standards

## Logging
Import `createLogger` from `sim/logger`. Use `logger.info`, `logger.warn`, `logger.error` instead of `console.log`.

## Comments
Use TSDoc for documentation. No `====` separators. No non-TSDoc comments.

## Styling
Never update global styles. Keep all styling local to components.

## ID Generation
Never use `crypto.randomUUID()`, `nanoid`, or the `uuid` package directly. Use the utilities from `@/lib/core/utils/uuid`:

- `generateId()` — UUID v4, use by default
- `generateShortId(size?)` — short URL-safe ID (default 21 chars), for compact identifiers

Both use `crypto.getRandomValues()` under the hood and work in all contexts including non-secure (HTTP) browsers.

```typescript
// ✗ Bad
import { nanoid } from 'nanoid'
import { v4 as uuidv4 } from 'uuid'
const id = crypto.randomUUID()

// ✓ Good
import { generateId, generateShortId } from '@/lib/core/utils/uuid'
const uuid = generateId()
const shortId = generateShortId()
const tiny = generateShortId(8)
```

## Common Utilities
Use shared helpers from `@/lib/core/utils/helpers` instead of writing inline implementations:

- `sleep(ms)` — async delay. Never write `new Promise(resolve => setTimeout(resolve, ms))`
- `toError(value)` — normalize unknown caught values to `Error`. Never write `e instanceof Error ? e : new Error(String(e))`
- `toError(value).message` — get error message safely. Never write `e instanceof Error ? e.message : String(e)`

```typescript
// ✗ Bad
await new Promise(resolve => setTimeout(resolve, 1000))
const msg = error instanceof Error ? error.message : String(error)
const err = error instanceof Error ? error : new Error(String(error))

// ✓ Good
import { sleep, toError } from '@/lib/core/utils/helpers'
await sleep(1000)
const msg = toError(error).message
const err = toError(error)
```

## Package Manager
Use `bun` and `bunx`, not `npm` and `npx`.
