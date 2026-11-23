/**
 * The repo's contract for committed generated artifacts, shared by `bun run generate`
 * (`generate-all.ts`) and its audit (`check-generators.ts`) so the two can never disagree.
 *
 * An artifact derived purely from the tree gets one script pair in the root package.json:
 * `generate:<x>` rewrites it and `check:<x>` fails when it is stale (usually the same command plus
 * `--check`; an audit may validate further, as `check:openapi` does). `check:audits` runs every
 * `check:*`, so drift fails CI, and `bun run generate` runs every generator, so one command fixes
 * it. Nothing else lists generators: a new pair is picked up by both sides automatically.
 */

/** Generators whose audit predates the `generate:<x>` / `check:<x>` naming, keyed to that audit. */
export const GENERATOR_ALIASES: Readonly<Record<string, string>> = {
  'skills:sync': 'check:skills',
}

const CHECK_FLAG = ' --check'

/** The audit that guards a generator script, or `null` when the name is not a generator. */
function auditFor(script: string): string | null {
  if (script.startsWith('generate:')) return `check:${script.slice('generate:'.length)}`
  return GENERATOR_ALIASES[script] ?? null
}

/**
 * Whether a `check:*` command runs a generator in check mode rather than a standalone audit.
 * Standalone audits live in `check-*.ts` files, some of which also take `--check`.
 */
function runsGeneratorInCheckMode(command: string): boolean {
  if (!command.endsWith(CHECK_FLAG)) return false
  const file = command.slice(0, -CHECK_FLAG.length).trim().split(/\s+/).at(-1) ?? ''
  return !/(^|\/)check-[^/]*$/.test(file)
}

/** Every generator `bun run generate` runs, in package.json order (later ones may read earlier output). */
export function listGenerators(scripts: Readonly<Record<string, string>>): string[] {
  return Object.keys(scripts).filter((script) => {
    const audit = auditFor(script)
    return audit !== null && audit in scripts
  })
}

/** Ways the root scripts break the generator contract, one message per problem. */
export function findPairingViolations(scripts: Readonly<Record<string, string>>): string[] {
  const violations: string[] = []
  const generatorByAudit = new Map<string, string>()

  for (const [script, command] of Object.entries(scripts)) {
    const audit = auditFor(script)
    if (audit === null) continue
    generatorByAudit.set(audit, script)
    if (!(audit in scripts)) {
      violations.push(
        `\`${script}\` has no \`${audit}\`, so its artifact can drift without failing CI. Add \`"${audit}": "${command}${CHECK_FLAG}"\`.`
      )
    }
  }

  for (const [script, command] of Object.entries(scripts)) {
    if (!script.startsWith('check:') || generatorByAudit.has(script)) continue
    if (!runsGeneratorInCheckMode(command)) continue
    const generator = `generate:${script.slice('check:'.length)}`
    violations.push(
      `\`${script}\` checks a generated artifact but nothing regenerates it, so \`bun run generate\` skips it. Add \`"${generator}": "${command.slice(0, -CHECK_FLAG.length)}"\`.`
    )
  }

  return violations
}

const TEST_FILE = /\.test\.tsx?$/
const REGENERATE_FLAG = /process\.env\.(UPDATE_[A-Z0-9_]+)/

/**
 * Test files that rewrite a committed artifact behind an environment flag. Such a test is a
 * generator nobody runs: the artifact only goes stale in CI's test shard, after merge. Move the
 * projection into a `generate:<x>` script instead.
 */
export function findRegeneratingTests(
  files: ReadonlyArray<{ path: string; content: string }>
): string[] {
  return files.flatMap(({ path, content }) => {
    if (!TEST_FILE.test(path)) return []
    const flag = content.match(REGENERATE_FLAG)?.[1]
    return flag
      ? [
          `${path} regenerates a committed artifact behind \`${flag}\`. Move it into a \`generate:<x>\` / \`check:<x>\` script pair.`,
        ]
      : []
  })
}
