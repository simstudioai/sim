/**
 * The sim half of the mothership↔CLI translation layer is PRIMITIVES ONLY
 * (mothership docs/revamp/18-agent-surface.md §4, Phase A0). The grammar — which
 * commands exist, how argv parses, pipe tokens, flag matching, help text, display
 * names — lives in the mothership worker. This gate keeps it from leaking back:
 *
 *  1. primitives-only: lib/mothership/agent-cli/ exports exactly the primitive surface
 *     and contains no token grammar (pipe splitting, flag parsing, command-name matching).
 *  2. no-grammar-on-sim: nothing under apps/sim parses `|` tokens or matches CLI command
 *     names for the agent, and only the primitive runner reaches `sim/embed`'s executor.
 *  3. cli-isolation: the public CLI package never imports agent code.
 *
 * Runs in the mothership-related sim gate alongside check:api-validation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const APP = join(ROOT, 'apps/sim')
const LAYER = join(APP, 'lib/mothership/agent-cli')
const PRIMITIVE_EXPORTS = new Set(['executeAgentCliRequest', 'AgentCliExecutionContext'])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry === 'node_modules' || entry === '.next') continue
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const failures: string[] = []
function fail(file: string, line: number, rule: string, text: string): void {
  failures.push(`${relative(ROOT, file)}:${line}  [${rule}]\n    ${text.trim().slice(0, 120)}`)
}

// 1. primitives-only — the export surface of the layer's index.
{
  const index = readFileSync(join(LAYER, 'index.ts'), 'utf8')
  const exported = [
    ...index.matchAll(/export (?:async )?(?:function|interface|type|const) (\w+)/g),
  ].map((m) => m[1])
  for (const name of exported) {
    if (!PRIMITIVE_EXPORTS.has(name)) {
      fail(
        join(LAYER, 'index.ts'),
        1,
        'primitives-only',
        `"${name}" is exported from the layer index; only ${[...PRIMITIVE_EXPORTS].join(', ')} may be`
      )
    }
  }
}

// 1 + 2. no token grammar anywhere in apps/sim for the agent.
const GRAMMAR_PATTERNS: Array<{ re: RegExp; rule: string }> = [
  { re: /===\s*'\|'|===\s*"\|"/, rule: 'no-grammar-on-sim: pipe tokens are split on the worker' },
  {
    re: /\bsplitPipeline\b|\bmatchAgentCliCommand\b|\bparseInvocation\b|\bagentCliHelpSection\b/,
    rule: 'no-grammar-on-sim: argv parsing, command matching, and help belong to the worker',
  },
]
for (const file of walk(join(APP, 'lib/mothership'))) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*)/.test(line)) return
    for (const { re, rule } of GRAMMAR_PATTERNS) {
      if (re.test(line)) fail(file, index + 1, rule, line)
    }
  })
}

// 2. only the primitive runner reaches the embedded CLI executor.
for (const file of walk(APP)) {
  if (file === join(LAYER, 'run-cli.ts') || file === join(LAYER, 'index.ts')) continue
  const src = readFileSync(file, 'utf8')
  const line = src
    .split('\n')
    .findIndex((l) => /from 'sim\/embed'/.test(l) && /runEmbeddedCli/.test(l))
  if (line >= 0) {
    fail(
      file,
      line + 1,
      'no-grammar-on-sim: runEmbeddedCli is reached only through lib/mothership/agent-cli/run-cli.ts',
      src.split('\n')[line]
    )
  }
}

// 3. the public CLI package never imports agent code.
for (const file of walk(join(ROOT, 'packages/sim-cli/src'))) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (/from '@\/lib\/mothership/.test(line)) {
      fail(
        file,
        index + 1,
        'cli-isolation: packages/sim-cli is the public product CLI and carries no agent concerns',
        line
      )
    }
  })
}

if (failures.length > 0) {
  for (const f of failures) console.error(f)
  console.error(`\n${failures.length} agent-cli boundary violation(s).`)
  process.exit(1)
}
console.log('agent-cli boundary checks passed')
