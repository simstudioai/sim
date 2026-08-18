/**
 * @vitest-environment node
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `signalTableRowsChangedByActor` lets the acting tab skip its own refetch, which is only sound
 * where that tab's mutation hook already applies the server's answer to every cached rows query.
 * That invariant lives in `hooks/queries/tables.ts` — nothing in the type system ties it to the
 * call site, so a well-meaning fourth call would silently strand that client on stale rows.
 *
 * This pins the allowlist. If you are here because it failed: adding a call means proving the
 * calling route's client hook reconciles locally, then adding it below. Removing one is always safe.
 */
const ATTRIBUTED_CALL_SITES = [
  'app/api/table/[tableId]/rows/route.ts',
  'app/api/table/[tableId]/rows/[rowId]/route.ts',
] as const

const APP_ROOT = join(import.meta.dirname, '../..')
/** Declares the function; matching its own definition would say nothing about call sites. */
const DECLARING_MODULE = 'lib/table/events.ts'

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) yield full
  }
}

describe('signalTableRowsChangedByActor call sites', () => {
  it('is called only where the acting tab reconciles the write locally', async () => {
    const callers: string[] = []
    for await (const file of walk(APP_ROOT)) {
      const source = await readFile(file, 'utf8')
      if (!source.includes('signalTableRowsChangedByActor(')) continue
      const relative = file.slice(APP_ROOT.length + 1)
      if (relative === DECLARING_MODULE) continue
      callers.push(relative)
    }

    expect(callers.sort()).toEqual([...ATTRIBUTED_CALL_SITES].sort())
  })
})
