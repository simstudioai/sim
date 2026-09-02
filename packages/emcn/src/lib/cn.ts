import type { CnFunction } from 'cn'
import { createCn } from 'cn/engine'
import tables from './cn-tables'

/**
 * Combines class names and resolves Tailwind conflicts.
 *
 * Built from `cn-tables.ts`, the compiled form of `cn.config.mjs` — which
 * carries Sim's `font-size` class-group extension, so `text-small` and
 * `text-sm` conflict rather than both being emitted. Compiling ahead of time
 * keeps `cn`'s config compiler out of the browser bundle; importing
 * `cn/config` instead produces identical output at a cost of ~5 KB gzip and
 * ~3.5 ms of main-thread work on the first call.
 *
 * Regenerate with `bun --filter @sim/emcn cn:build` after changing
 * `cn.config.mjs` or bumping the `cn` dependency; the root `check:cn-tables`
 * audit fails CI when the two drift.
 */
// Annotated: `CnFunction` is not re-exported from `cn/engine`, so the inferred
// type is not nameable from this package's declaration output.
export const cn: CnFunction = createCn(tables)
