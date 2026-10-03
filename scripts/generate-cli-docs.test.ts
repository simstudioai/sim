import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeOption, GUIDE_PAGES, OUTPUT_DIR } from './generate-cli-docs'

/** `describeOption` reads only these two fields; the rest of the Option is irrelevant. */
function option(fields: { description?: string; defaultValue?: unknown }) {
  return fields as Parameters<typeof describeOption>[0]
}

function guide(page: string): string {
  return readFileSync(path.join(OUTPUT_DIR, `${page}.mdx`), 'utf8')
}

describe('an option default rendered into the reference table', () => {
  /**
   * A repeatable flag's Commander default is `[]` — the accumulator its
   * collector appends to, not a value anyone would type. `String([])` is the
   * empty string, so the table carried a dangling "Defaults to ``."
   */
  it('omits the clause for a repeatable flag with an empty accumulator', () => {
    const cell = describeOption(
      option({
        description: 'Only follow runs of this workflow (repeatable)',
        defaultValue: [],
      })
    )
    expect(cell).toBe('Only follow runs of this workflow (repeatable).')
    expect(cell).not.toContain('Defaults to')
  })
})

/**
 * The id shapes the CLI states in its own root help (`HELP_EPILOGUE`,
 * `packages/sim-cli/src/program.ts`): workflow, knowledge-base, workspace and
 * run ids are bare UUIDs, table ids carry `tbl_`, file ids carry `wf_`.
 *
 * The guides are hand-written and the generator neither writes nor inspects
 * them, so nothing else stops their placeholder ids from teaching a scheme the
 * API does not use — which is how `wf_7Yb2` came to name a workflow ~10 times.
 */
const FOREIGN_ID_PREFIXES = ['ws_', 'kb_', 'run_', 'file_', 'doc_', 'org_'] as const

describe('placeholder ids in the hand-written guides', () => {
  it('uses no prefix the API never issues', () => {
    // No `\b` before the prefix: `printf 'wf_…\nfile_2\n'` carries a literal
    // `\n`, and a word-anchored sweep reads straight past the `file_2` after it.
    const candidate = new RegExp(`(.?)(${FOREIGN_ID_PREFIXES.join('|')})([A-Za-z0-9]+)(.?)`, 'g')
    const offenders: string[] = []
    for (const page of GUIDE_PAGES) {
      guide(page)
        .split('\n')
        .forEach((line, index) => {
          // A literal `\n` inside a quoted `printf` separates two ids, so it has
          // to read as a boundary — otherwise the sweep sees `nfile_2`, takes
          // the `n` for a word character, and skips the second id entirely.
          const scan = line.replace(/\\[nrt]/g, ' ')
          for (const [, before, prefix, rest, after] of scan.matchAll(candidate)) {
            // A shell variable is read with `$` and written with `=`; the
            // recipes name one `run_id`, which is not an id placeholder.
            if (before === '$' || before === '{' || after === '=') continue
            if (/[\w-]/.test(before)) continue
            offenders.push(`${page}.mdx:${index + 1}: ${prefix}${rest}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })
})
