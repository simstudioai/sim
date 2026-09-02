/**
 * @vitest-environment node
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * `signalTableRowsChangedByActor` lets the acting tab skip its own refetch, which is only sound
 * where that tab's mutation hook already applies the server's answer to every cached rows query.
 * That invariant lives in `hooks/queries/tables.ts` — nothing in the type system ties it to the
 * call site, so a well-meaning extra call would silently strand that client on stale rows.
 *
 * Two lists are pinned. All row mutations now signal from the shared application use case rather
 * than duplicating that side effect in their route adapters. The call itself is no longer the
 * decision: the use case is shared with `/api/v2` and Copilot, and it degrades to a broadcast
 * whenever no actor is named. What actually selects the behavior is which surface supplies
 * `actorClientId`, so that is pinned too and is the list to scrutinise.
 *
 * If you are here because it failed: adding a supplier means proving that surface's client hook
 * reconciles the write locally across every cached rows query. Removing one is always safe.
 */
const ATTRIBUTED_CALL_SITES = ['lib/table/application/rows.ts'] as const

/** Surfaces that name the acting tab. See the note above — this is the real allowlist. */
const ACTOR_SUPPLYING_SURFACES = [
  'app/api/table/[tableId]/rows/route.ts',
  'app/api/table/[tableId]/rows/[rowId]/route.ts',
] as const

const APP_ROOT = join(import.meta.dirname, '../..')
/** Declares the function; matching its own definition would say nothing about call sites. */
const DECLARING_MODULE = 'lib/table/events.ts'
/** Declares the input and forwards it to the signal; it names no tab of its own. */
const FORWARDING_MODULE = 'lib/table/application/rows.ts'

/**
 * A file names a tab either by setting the input field or by passing a second
 * argument to the signal directly.
 *
 * Deliberately keyed on the attribution rather than on `readClientId`: that reader
 * is a general-purpose helper any surface may call for unrelated reasons, so
 * matching it classified innocent callers as suppliers and could be sidestepped by
 * aliasing or wrapping it. These two forms are what actually attribute a write, and
 * they hold however the id was obtained.
 */
const SUPPLIER_PATTERNS = [/actorClientId:/, /signalTableRowsChangedByActor\([^)]*,/] as const

/** Files read per batch; bounds open descriptors while keeping the disk busy. */
const READ_BATCH_SIZE = 64

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === 'node_modules' || entry.name === '.next') return []
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return walk(full)
      return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [full] : []
    })
  )
  return nested.flat()
}

/**
 * Every source file under the app root, keyed by its relative path. Read once
 * for the file: both sweeps scan the same tree, and walking it per test was the
 * whole cost of this file.
 */
let sources: Map<string, string>

async function readSources(): Promise<Map<string, string>> {
  const files = await walk(APP_ROOT)
  const found = new Map<string, string>()
  for (let start = 0; start < files.length; start += READ_BATCH_SIZE) {
    const batch = files.slice(start, start + READ_BATCH_SIZE)
    const contents = await Promise.all(batch.map((file) => readFile(file, 'utf8')))
    batch.forEach((file, index) => {
      found.set(file.slice(APP_ROOT.length + 1), contents[index])
    })
  }
  return found
}

function filesMatching(
  matches: (source: string) => boolean,
  skip: (relative: string) => boolean = () => false
): string[] {
  const found: string[] = []
  for (const [relative, source] of sources) {
    if (!matches(source)) continue
    if (skip(relative)) continue
    found.push(relative)
  }
  return found.sort()
}

describe('signalTableRowsChangedByActor call sites', () => {
  /**
   * Structurally slow — it reads every source file in the app — so under a
   * fully-parallel local run the scan blows the default budget while passing in
   * isolation and on CI. Give it a real budget of its own, outside any test's.
   */
  beforeAll(async () => {
    sources = await readSources()
  }, 30_000)

  it('is called only where the acting tab reconciles the write locally', () => {
    const callers = filesMatching(
      (source) => source.includes('signalTableRowsChangedByActor('),
      (relative) => relative === DECLARING_MODULE
    )

    expect(callers).toEqual([...ATTRIBUTED_CALL_SITES].sort())
  })

  it('is given an actor only by surfaces whose client hook reconciles locally', () => {
    const suppliers = filesMatching(
      (source) => SUPPLIER_PATTERNS.some((pattern) => pattern.test(source)),
      (relative) => relative === DECLARING_MODULE || relative === FORWARDING_MODULE
    )

    expect(suppliers).toEqual([...ACTOR_SUPPLYING_SURFACES].sort())
  })
})
