import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { addControlComparison, controlSource } from '#design-conformance/diff/control-comparison'
import { githubAnnotations, githubSummary, textReport } from '#design-conformance/diff/reporting'
import { compareGit, gitText, options, writeJson } from '#design-conformance/shared/io'
import {
  type Change,
  canonical,
  type Entry,
  hash,
  type Report,
} from '#design-conformance/shared/model'
import { GitSource, trackedDesignSource } from '#design-conformance/shared/worktree-source'
import { ConformanceLinter } from '#design-conformance/styling/conformance'
import { gitSnapshot } from '#design-conformance/system/system-snapshot'

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const usage =
  'Usage: bun run check:design --base <revision> [--head HEAD | --working-tree] [--repo <repository>] [--format text|json] [--output <report.json>]'

export interface CheckArguments {
  repo: string
  base: string
  head: string
  workingTree?: boolean
}

export async function checkComparison(args: CheckArguments): Promise<Report> {
  const linter = new ConformanceLinter()
  try {
    const immutable = compareGit(args.repo, args.base, args.workingTree ? 'HEAD' : args.head)
    const before = args.workingTree ? new GitSource(args.repo, immutable.commits.mergeBase) : null
    const after = args.workingTree ? new GitSource(args.repo, 'HEAD', true) : null
    const changes: Change[] = before && after ? workingChanges(before, after) : immutable.changes
    const commits = after
      ? {
          ...immutable.commits,
          head: `working-tree:${hash(canonical(after.entries.map((entry) => [entry.path, entry.mode, entry.blob])))}`,
        }
      : immutable.commits
    const currentEntries = new Map(after?.entries.map((entry) => [entry.path, entry]) ?? [])
    const read = (entry: Entry) => {
      const current = currentEntries.get(entry.path)
      return current && after && current.blob === entry.blob
        ? after.read(current)
        : before
          ? before.read(entry)
          : gitText(args.repo, entry)
    }
    const report = await addControlComparison(
      await linter.analyze(
        changes,
        read,
        commits,
        before?.central() ?? gitSnapshot(args.repo, commits.mergeBase)
      ),
      changes,
      () => controlSource(args.repo, commits.mergeBase),
      () => after ?? controlSource(args.repo, commits.head)
    )
    const changedFiles = new Set(
      changes.flatMap((change) =>
        [change.before?.path, change.after?.path].filter((file): file is string => Boolean(file))
      )
    )
    const beforeNotes = new Map<string, number>()
    const noteKey = (note: Report['unchecked'][number]) =>
      canonical([note.file, note.context, note.reason])
    for (const note of report.unchecked)
      if (note.side === 'before') {
        const key = noteKey(note)
        beforeNotes.set(key, (beforeNotes.get(key) ?? 0) + 1)
      }
    report.unchecked = report.unchecked.map((note) => {
      const key = noteKey(note)
      const old = beforeNotes.get(key) ?? 0
      if (note.side === 'after' && old) beforeNotes.set(key, old - 1)
      return changedFiles.has(note.file) || (note.side === 'after' && !old)
        ? { ...note, relevant: true }
        : note
    })
    after?.assertUnchanged()
    return report
  } catch (error) {
    return linter.report(null, error instanceof Error ? error.message : 'Operational failure')
  }
}

function workingChanges(before: GitSource, after: GitSource): Change[] {
  const old = new Map(before.entries.map((entry) => [entry.path, entry]))
  const current = new Map(after.entries.map((entry) => [entry.path, entry]))
  return [...new Set([...old.keys(), ...current.keys()])]
    .sort()
    .filter(trackedDesignSource)
    .flatMap((file) => {
      const previous = old.get(file)
      const next = current.get(file)
      if (previous?.blob === next?.blob && previous?.mode === next?.mode) return []
      return [
        {
          before: previous ?? null,
          after: next ?? null,
          status: previous ? (next ? 'M' : 'D') : 'A',
        },
      ]
    })
}

/** The regular command always preserves 0/1/2; only the CI wrapper tolerates findings. */
export async function main(argv = process.argv.slice(2)): Promise<number> {
  let output: string | undefined
  let format: 'text' | 'json' = 'text'
  let report: Report
  try {
    const args = options(
      {
        format: { type: 'string' },
        help: { type: 'boolean' },
        'working-tree': { type: 'boolean' },
      },
      argv
    )
    if (args.help) {
      process.stdout.write(
        `${usage}\nUse --working-tree to include staged, unstaged and nonignored new source files; CI uses immutable commits.\n`
      )
      return 0
    }
    output = args.output as string | undefined
    if (args.format !== undefined && args.format !== 'text' && args.format !== 'json')
      throw new Error('--format must be text or json')
    format = (args.format ?? 'text') as 'text' | 'json'
    if (!args.base) throw new Error(usage)
    if (args['working-tree'] && args.head)
      throw new Error('--working-tree and --head cannot be combined')
    report = await checkComparison({
      repo: (args.repo as string | undefined) ?? repositoryRoot,
      base: args.base as string,
      head: (args.head as string | undefined) ?? 'HEAD',
      workingTree: args['working-tree'] === true,
    })
  } catch (error) {
    report = new ConformanceLinter().report(
      null,
      error instanceof Error ? error.message : 'Operational failure'
    )
  }
  try {
    if (output) writeJson(output, report)
    const rendered = format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : textReport(report)
    if (format === 'text' && report.status === 'failed') process.stderr.write(rendered)
    else process.stdout.write(rendered)
    if (process.env.GITHUB_ACTIONS === 'true') {
      for (const annotation of githubAnnotations(report)) process.stderr.write(`${annotation}\n`)
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, githubSummary(report))
    }
  } catch (error) {
    process.stderr.write(
      `Design report could not be written: ${JSON.stringify(error instanceof Error ? error.message : 'Operational failure')}\n`
    )
    return 2
  }
  return report.status === 'failed' ? 2 : report.flagged ? 1 : 0
}
