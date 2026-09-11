import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { Category, Report } from '#design-diff/types'

const ENGINE = 'ee213d9a7e4ad5ec944d4d55003c378b2f2787d4'
const BUTTON = 'packages/emcn/src/components/button/button.tsx'
const CONSTANTS =
  'apps/sim/app/workspace/[workspaceId]/home/components/user-input/components/constants.ts'
interface Scenario {
  name: string
  edit?: [file: string, before: string, after: string]
  category?: Category
}
interface Result {
  name: string
  head: string | null
  passed: boolean
  seconds?: number
  peakRssBytes?: number
  exitCode?: number | null
  signal?: string | null
  flagged?: boolean | null
  findingCount?: number
  failedCheck?: string
}
const scenarios: Scenario[] = [
  {
    name: 'shared-button-shape',
    edit: [BUTTON, 'rounded-[5px]', 'rounded-none'],
    category: 'shape-effects',
  },
  {
    name: 'local-button-colour',
    edit: [CONSTANTS, 'bg-[#383838]', 'bg-[#E11D48]'],
    category: 'colour',
  },
  {
    name: 'local-button-padding',
    edit: [CONSTANTS, 'rounded-full border-0 p-0', 'rounded-full border-0 p-2'],
    category: 'dimensions',
  },
  {
    name: 'comment-only',
    edit: [BUTTON, 'a section-header action.', 'an action in a section header.'],
  },
  {
    name: 'unproven-movement',
    edit: [CONSTANTS, "p-0 transition-colors'", "p-0 transition-colors translate-x-2'"],
    category: 'layout',
  },
  { name: 'missing-revision' },
]
scenarios.push({ ...scenarios[0], name: 'shared-button-shape-repeat' })

/** Runs only the pinned analyzer; synthetic application edits stay in Git objects. */
function main() {
  const { values } = parseArgs({
    options: { repo: { type: 'string' }, output: { type: 'string' } },
    strict: true,
  })
  assert(values.repo && values.output, 'Both --repo and --output are required')
  const repo = path.resolve(values.repo)
  const output = path.resolve(values.output)
  mkdirSync(output, { recursive: true })
  assert.equal(readdirSync(output).length, 0, 'Output directory must be empty')
  const temporary = mkdtempSync(path.join(tmpdir(), 'design-diff-smoke-'))
  const {
    DESIGN_DIFF_PR: _pr,
    DESIGN_DIFF_ENGINE_SHA: _engine,
    HEAD_SHA: _head,
    ...environment
  } = process.env
  const env = { ...environment, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1' }
  const summary = {
    engineSha: ENGINE,
    workflowSha: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    base: ENGINE,
    platform: process.platform,
    architecture: process.arch,
    bunVersion: execFileSync(process.execPath, ['--version']).toString().trim(),
    status: 'running',
    deterministic: false,
    results: [] as Result[],
  }
  const save = () =>
    writeFileSync(path.join(output, 'test-results.json'), `${JSON.stringify(summary, null, 2)}\n`)
  const git = (args: string[], input?: string, extraEnv = {}) =>
    execFileSync('git', args, {
      cwd: repo,
      env: { ...env, ...extraEnv },
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim()
  save()
  try {
    assert.equal(summary.bunVersion, '1.4.1', 'Use the repository Bun version')
    assert.equal(git(['rev-parse', 'HEAD']), ENGINE, 'Engine checkout must match the pin')
    assert.equal(
      git(['status', '--porcelain', '--untracked-files=no']),
      '',
      'Engine checkout must be clean'
    )
    for (const scenario of scenarios) {
      const result: Result = { name: scenario.name, head: null, passed: false }
      summary.results.push(result)
      save()
      let stage = 'prepare-comparison'
      try {
        let head = '0'.repeat(40)
        if (scenario.edit) {
          const [file, before, after] = scenario.edit
          const original = execFileSync('git', ['show', `${ENGINE}:${file}`], {
            cwd: repo,
            env,
          }).toString()
          assert.equal(
            original.split(before).length,
            2,
            'Fixture replacement must match exactly once'
          )
          const blob = git(['hash-object', '-w', '--stdin'], original.replace(before, after))
          const index = { GIT_INDEX_FILE: path.join(temporary, 'index') }
          git(['read-tree', ENGINE], undefined, index)
          const mode = git(['ls-tree', ENGINE, '--', file]).split(' ')[0]
          git(['update-index', '--add', '--cacheinfo', mode, blob, file], undefined, index)
          const tree = git(['write-tree'], undefined, index)
          head = git(['commit-tree', tree, '-p', ENGINE], 'Design diff isolated fixture\n', {
            GIT_AUTHOR_NAME: 'Design diff smoke',
            GIT_AUTHOR_EMAIL: 'design-diff@example.invalid',
            GIT_COMMITTER_NAME: 'Design diff smoke',
            GIT_COMMITTER_EMAIL: 'design-diff@example.invalid',
            GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
            GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
          })
        }
        result.head = head
        save()
        stage = 'engine-execution'
        const reportFile = path.join(output, `${scenario.name}.json`)
        const metricsFile = path.join(temporary, 'metrics')
        const descriptor = openSync(metricsFile, 'w', 0o600)
        const start = performance.now()
        const timing = process.platform === 'darwin' ? ['-l'] : ['-f', 'design-diff-peak-kib=%M']
        let execution: ReturnType<typeof spawnSync>
        try {
          execution = spawnSync(
            '/usr/bin/time',
            [
              ...timing,
              process.execPath,
              '--no-env-file',
              'scripts/design-diff/cli.ts',
              '--base',
              ENGINE,
              '--head',
              head,
              '--output',
              reportFile,
            ],
            {
              cwd: repo,
              env,
              stdio: ['ignore', 'ignore', descriptor],
            }
          )
        } finally {
          closeSync(descriptor)
        }
        result.seconds = Math.round((performance.now() - start) / 10) / 100
        result.exitCode = execution.status
        result.signal = execution.signal
        assert(!execution.error && !execution.signal, 'Analyzer execution must finish normally')
        stage = 'memory-measurement'
        const metrics = readFileSync(metricsFile, 'utf8')
        const peak =
          process.platform === 'darwin'
            ? metrics.match(/(\d+)\s+maximum resident set size/)
            : metrics.match(/design-diff-peak-kib=(\d+)/)
        assert(peak, 'Peak memory measurement is required')
        result.peakRssBytes = Number(peak[1]) * (process.platform === 'darwin' ? 1 : 1024)
        stage = 'report-identity'
        const report = JSON.parse(readFileSync(reportFile, 'utf8')) as Report
        assert.equal(report.schemaVersion, '2.0.0')
        assert.equal(report.engineVersion, '0.2.0')
        assert.equal(report.policyVersion, '2.0.0')
        assert.equal(report.context, undefined)
        result.flagged = report.flagged
        result.findingCount = report.findings.length
        stage = 'expected-decision'
        if (!scenario.edit) {
          assert.equal(execution.status, 1)
          assert.equal(report.status, 'failed')
          assert.equal(report.flagged, null)
          assert.equal(report.commits, null)
          assert.equal(report.findings.length, 0)
          assert(report.error)
        } else {
          assert.equal(execution.status, 0)
          assert.equal(report.status, 'completed')
          assert.deepEqual(report.commits, { base: ENGINE, head, mergeBase: ENGINE })
          assert.equal(report.flagged, Boolean(scenario.category))
          assert(report.findings.every((finding) => ['flag', 'exempt'].includes(finding.decision)))
          assert.equal(report.findings.length, scenario.category ? 1 : 0)
          if (scenario.category) {
            stage = 'source-and-category'
            const finding = report.findings[0]
            assert.equal(finding.decision, 'flag')
            assert.equal(finding.source.before?.file, scenario.edit[0])
            assert.equal(finding.source.after?.file, scenario.edit[0])
            assert.equal(
              finding.source.before?.blob,
              git(['rev-parse', `${ENGINE}:${scenario.edit[0]}`])
            )
            assert.equal(
              finding.source.after?.blob,
              git(['rev-parse', `${head}:${scenario.edit[0]}`])
            )
            assert(finding.categories.includes(scenario.category))
            assert(finding.reason.length > 0)
            if (scenario.edit[0] === BUTTON) {
              stage = 'shared-consumers'
              assert.equal(finding.impact.basis, 'resolved-static-references')
              assert(finding.impact.after.fileCount > 1)
              assert(finding.impact.after.references.some((ref) => ref.location.file !== BUTTON))
              assert(finding.example)
            }
          }
        }
        if (scenario.name.endsWith('-repeat')) {
          stage = 'byte-identical-report'
          summary.deterministic = readFileSync(reportFile).equals(
            readFileSync(path.join(output, 'shared-button-shape.json'))
          )
          assert(summary.deterministic)
        }
        result.passed = true
      } catch {
        result.failedCheck = stage
      }
      save()
      process.stdout.write(
        `${result.name}: ${result.passed ? 'PASS' : 'FAIL'} (${result.seconds ?? 0}s, peak RSS ${result.peakRssBytes ?? 0} bytes)\n`
      )
    }
    assert.equal(
      git(['status', '--porcelain', '--untracked-files=no']),
      '',
      'Engine files must remain unchanged'
    )
    summary.status =
      summary.results.every((result) => result.passed) && summary.deterministic
        ? 'passed'
        : 'failed'
  } finally {
    if (summary.status === 'running') summary.status = 'failed'
    save()
    rmSync(temporary, { recursive: true, force: true })
  }
  if (summary.status !== 'passed') process.exitCode = 1
}

try {
  main()
} catch {
  process.stderr.write(
    'Design diff smoke setup or execution failed. Check the retained test results.\n'
  )
  process.exitCode = 1
}
