#!/usr/bin/env bun
/**
 * Fails when the repository would hand a running container a fake or shared secret.
 *
 * Compose files are checked against two rules, applied to every `${…}` interpolation:
 *
 *  1. No interpolation default may contain shell syntax — see `@sim/security/secrets` for why
 *     `${SECRET:-$(openssl rand -hex 32)}` silently ships that command text as the value.
 *  2. A secret variable may not carry a non-empty literal fallback (`${SECRET:-value}`), which
 *     silently ships one shared default to every deployment. It must fail closed with
 *     `${SECRET:?message}`. An empty fallback (`${SECRET:-}`) is fine — it marks the variable
 *     optional rather than supplying a value.
 *
 * The published `simstudio` launcher builds container env by hand rather than through Compose,
 * so its sources are checked for the same mistake in its own form: a `'SECRET=literal'` string.
 *
 * Dev-only stacks are exempt from rule 2, whose recognizable placeholders never leave a
 * contributor's machine. Rule 1 applies everywhere — a broken interpolation is always a bug.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasUnexpandedShellSubstitution, SECRET_ENV_KEYS } from '@sim/security/secrets'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SECRET_VARIABLES = new Set<string>(SECRET_ENV_KEYS)

/** Files allowed to ship recognizable dev placeholders for secrets (rule 2 only). */
const DEV_ONLY_COMPOSE_FILES = new Set([
  'docker-compose.local.yml',
  '.devcontainer/docker-compose.yml',
])

const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', '.git', 'dist', 'build', 'out'])
const COMPOSE_FILE = /^(docker-)?compose[.\w-]*\.ya?ml$/

/** `${NAME:-default}` / `${NAME-default}` / `${NAME:?message}` — the operator and its argument. */
const INTERPOLATION = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?([-?]))?([^}]*)\}/g

interface Violation {
  file: string
  line: number
  variable: string
  text: string
  reason: string
}

export function auditSource(source: string, file: string): Violation[] {
  const violations: Violation[] = []
  const devOnly = DEV_ONLY_COMPOSE_FILES.has(file)

  source.split('\n').forEach((line, index) => {
    if (line.trimStart().startsWith('#')) return

    for (const [text, variable, operator, argument = ''] of line.matchAll(INTERPOLATION)) {
      if (operator !== '?' && hasUnexpandedShellSubstitution(argument)) {
        violations.push({
          file,
          line: index + 1,
          variable,
          text,
          reason:
            'interpolation default contains shell syntax, which Compose passes through as literal text',
        })
        continue
      }

      const hasLiteralFallback = operator === '-' && argument.trim().length > 0
      if (!devOnly && hasLiteralFallback && SECRET_VARIABLES.has(variable)) {
        violations.push({
          file,
          line: index + 1,
          variable,
          text,
          reason: `${variable} falls back to a shared literal; require it instead so the stack fails closed`,
        })
      }
    }
  })

  return violations
}

/**
 * Sources that assemble container environment by hand, where a secret is assigned inside a
 * string literal (`'BETTER_AUTH_SECRET=…'`) instead of through Compose interpolation.
 */
const HANDBUILT_ENV_DIR = 'packages/cli/src'

const ASSIGNED_SECRET = new RegExp(`(${SECRET_ENV_KEYS.join('|')})=([^'"\`$\\n]+)`, 'g')

export function auditHandbuiltEnv(source: string, file: string): Violation[] {
  const violations: Violation[] = []

  source.split('\n').forEach((line, index) => {
    if (line.trimStart().startsWith('//')) return

    for (const [text, variable, value] of line.matchAll(ASSIGNED_SECRET)) {
      if (value.trim().length === 0) continue
      violations.push({
        file,
        line: index + 1,
        variable,
        text,
        reason: `${variable} is assigned a hardcoded literal; generate it per install instead`,
      })
    }
  })

  return violations
}

/** Recursive so a compose file cannot escape the check by nesting. */
function composeFiles(dir = ROOT, prefix = '', found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) composeFiles(join(dir, entry.name), relativePath, found)
    else if (COMPOSE_FILE.test(entry.name)) found.push(relativePath)
  }
  return found.sort()
}

function handbuiltEnvFiles(): string[] {
  return readdirSync(join(ROOT, HANDBUILT_ENV_DIR), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => `${HANDBUILT_ENV_DIR}/${entry.name}`)
    .sort()
}

function main(): void {
  const compose = composeFiles()
  const handbuilt = handbuiltEnvFiles()
  const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

  const violations = [
    ...compose.flatMap((file) => auditSource(read(file), file)),
    ...handbuilt.flatMap((file) => auditHandbuiltEnv(read(file), file)),
  ]

  if (violations.length > 0) {
    console.error('The repository would hand a container an unusable or shared secret:')
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}  ${violation.text}`)
      console.error(`    ${violation.reason}`)
    }
    console.error(
      '\nA secret shipped in the repository is public, so every deployment sharing it is' +
        '\nunauthenticated. Require the value (as docker-compose.prod.yml does) or generate' +
        '\none per install. Compose in particular never runs a shell, so a command-substitution' +
        '\ndefault becomes that literal string inside the container.'
    )
    process.exit(1)
  }

  console.log(
    `✓ ${compose.length} compose files and ${handbuilt.length} launcher sources require real secrets`
  )
}

if (import.meta.main) main()
