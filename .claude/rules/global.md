# Global Standards

## Logging
Import `createLogger` from `sim/logger`. Use `logger.info`, `logger.warn`, `logger.error` instead of `console.log`.

## Comments
Use TSDoc for documentation. No `====` separators. No non-TSDoc comments.

## Styling
Never update global styles. Keep all styling local to components.

## Package Manager
Use `bun` and `bunx`, not `npm` and `npx`.
