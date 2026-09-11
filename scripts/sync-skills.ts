/**
 * Generate the per-tool skill and rule projections from the canonical sources
 * so every supported agent surface stays aligned.
 *
 * Skills — canonical source of truth: `.agents/skills/<name>/SKILL.md`
 *   frontmatter: `name`, `description`, optional `argument-hint`; then the body.
 *
 *   Projection (generated — do not hand-edit):
 *   - `.claude/skills/<name>` — symlink to the complete canonical skill directory.
 *
 *   Cursor discovers `.agents/skills` directly, so it needs no projection.
 *   Deprecated `.claude/commands/<name>.md` and `.cursor/commands/<name>.md`
 *   projections are removed when syncing and treated as stale in check mode.
 *
 *   Claude receives the complete skill directory so bundled resources remain
 *   available.
 *
 * Rules — canonical source of truth: `.claude/rules/<name>.md`
 *   frontmatter: `description`, optional `paths` list; then the body. Claude
 *   reads these directly.
 *
 *   Projection (generated — do not hand-edit):
 *   - `.cursor/rules/<name>.mdc` — same body under Cursor's frontmatter:
 *     `description`, and `globs` from `paths` or `alwaysApply: true` when the
 *     rule has none.
 *
 * Usage:
 *   bun run scripts/sync-skills.ts           # write projections
 *   bun run scripts/sync-skills.ts --check   # fail (exit 1) if any projection is stale
 */
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  rmdir,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const CANONICAL_DIR = resolve(ROOT, '.agents/skills')
const CLAUDE_SKILLS_DIR = resolve(ROOT, '.claude/skills')
const LEGACY_CLAUDE_COMMANDS_DIR = resolve(ROOT, '.claude/commands')
const LEGACY_CURSOR_COMMANDS_DIR = resolve(ROOT, '.cursor/commands')
const CANONICAL_RULES_DIR = resolve(ROOT, '.claude/rules')
const CURSOR_RULES_DIR = resolve(ROOT, '.cursor/rules')

interface Skill {
  name: string
  frontmatter: string[]
}

/** Read the ordered frontmatter lines from a SKILL.md. */
function parseSkill(name: string, raw: string): Skill {
  if (!raw.startsWith('---\n')) {
    throw new Error(`${name}: SKILL.md must start with a '---' frontmatter block`)
  }
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) throw new Error(`${name}: unterminated frontmatter block`)
  const frontmatter = raw.slice(4, end).split('\n')
  return { name, frontmatter }
}

/** Return the first frontmatter line whose key matches, verbatim, or undefined. */
function line(skill: Skill, key: string): string | undefined {
  return skill.frontmatter.find((l) => l.startsWith(`${key}:`))
}

async function loadCanonicalSkills(): Promise<Skill[]> {
  const entries = await readdir(CANONICAL_DIR, { withFileTypes: true })
  const names = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  const skills: Skill[] = []
  for (const name of names) {
    const raw = await readFile(resolve(CANONICAL_DIR, name, 'SKILL.md'), 'utf8')
    const skill = parseSkill(name, raw)
    const nameLine = line(skill, 'name')
    if (nameLine !== `name: ${name}`) {
      throw new Error(`${name}: frontmatter 'name' must equal the directory name`)
    }
    if (!line(skill, 'description')) {
      throw new Error(`${name}: missing 'description' in frontmatter`)
    }
    skills.push(skill)
  }
  return skills
}

interface Rule {
  name: string
  description: string
  paths: string[]
  body: string
}

/** Parse a canonical rule: `description`, optional `paths` list, then the body. */
function parseRule(name: string, raw: string): Rule {
  if (!raw.startsWith('---\n')) {
    throw new Error(`${name}: rule must start with a '---' frontmatter block`)
  }
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) throw new Error(`${name}: unterminated frontmatter block`)
  const frontmatter = raw.slice(4, end).split('\n')
  const body = raw.slice(end + '\n---\n'.length).replace(/^\n+/, '')

  let description: string | undefined
  const paths: string[] = []
  let inPaths = false
  for (const entry of frontmatter) {
    if (entry.startsWith('description:')) {
      description = entry.slice('description:'.length).trim()
      inPaths = false
    } else if (entry === 'paths:') {
      inPaths = true
    } else if (inPaths && /^\s+- /.test(entry)) {
      paths.push(
        entry
          .replace(/^\s+- /, '')
          .trim()
          .replace(/^"(.*)"$/, '$1')
      )
    } else {
      inPaths = false
    }
  }
  if (!description) throw new Error(`${name}: missing 'description' in frontmatter`)
  return { name, description, paths, body }
}

async function loadCanonicalRules(): Promise<Rule[]> {
  const entries = await readdir(CANONICAL_RULES_DIR)
  const rules: Rule[] = []
  for (const file of entries.filter((f) => f.endsWith('.md')).sort()) {
    const raw = await readFile(resolve(CANONICAL_RULES_DIR, file), 'utf8')
    rules.push(parseRule(file.slice(0, -'.md'.length), raw))
  }
  return rules
}

/** Render the Cursor `.mdc` projection of a canonical rule. */
function renderCursorRule(rule: Rule): string {
  const scope = rule.paths.length > 0 ? `globs: ${JSON.stringify(rule.paths)}` : 'alwaysApply: true'
  return [
    '---',
    `description: ${rule.description}`,
    scope,
    '---',
    '',
    `<!-- Generated from .claude/rules/${rule.name}.md by \`bun run skills:sync\`. Edit the source, not this file. -->`,
    '',
    rule.body,
  ].join('\n')
}

/** Find generated Claude links whose canonical skill no longer exists. */
async function findOrphanedClaudeLinks(expectedPaths: ReadonlySet<string>): Promise<string[]> {
  const entries = await readdir(CLAUDE_SKILLS_DIR, { withFileTypes: true }).catch(
    (error: unknown) => {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      if (code === 'ENOENT') return []
      throw error
    }
  )
  const orphaned: string[] = []

  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue
    const path = resolve(CLAUDE_SKILLS_DIR, entry.name)
    if (expectedPaths.has(path)) continue

    const target = resolve(dirname(path), await readlink(path))
    const canonicalRelative = relative(CANONICAL_DIR, target)
    const targetsCanonicalSkills =
      canonicalRelative === '' ||
      (!isAbsolute(canonicalRelative) &&
        canonicalRelative !== '..' &&
        !canonicalRelative.startsWith(`..${sep}`))
    if (targetsCanonicalSkills) orphaned.push(path)
  }

  return orphaned
}

async function main() {
  const check = process.argv.includes('--check')
  const skills = await loadCanonicalSkills()

  const claudeLinks = skills.map((skill) => {
    const path = resolve(CLAUDE_SKILLS_DIR, skill.name)
    return {
      path,
      target: relative(dirname(path), resolve(CANONICAL_DIR, skill.name)),
    }
  })
  const deprecatedTargets = skills.flatMap((skill) => [
    resolve(LEGACY_CLAUDE_COMMANDS_DIR, `${skill.name}.md`),
    resolve(LEGACY_CURSOR_COMMANDS_DIR, `${skill.name}.md`),
  ])

  const stale: string[] = []
  const expectedClaudePaths = new Set(claudeLinks.map(({ path }) => path))
  for (const { path, target } of claudeLinks) {
    const current = await readlink(path).catch(() => null)
    if (current === target) continue
    const displayPath = path.replace(`${ROOT}/`, '')
    stale.push(displayPath)
    if (!check) {
      const existing = await lstat(path).catch(() => null)
      if (existing && !existing.isSymbolicLink()) {
        throw new Error(`${displayPath}: expected a generated symlink, found a real directory`)
      }
      if (existing) await rm(path)
      await mkdir(dirname(path), { recursive: true })
      await symlink(target, path, 'dir')
    }
  }

  const orphanedClaudeLinks = await findOrphanedClaudeLinks(expectedClaudePaths)
  for (const path of orphanedClaudeLinks) {
    stale.push(`${path.replace(`${ROOT}/`, '')} (orphaned)`)
    if (!check) await rm(path)
  }

  for (const path of deprecatedTargets) {
    const current = await readFile(path, 'utf8').catch(() => null)
    if (current === null) continue
    stale.push(`${path.replace(`${ROOT}/`, '')} (deprecated)`)
    if (!check) await rm(path)
  }

  const rules = await loadCanonicalRules()
  const expectedCursorRules = new Set<string>()
  for (const rule of rules) {
    const path = resolve(CURSOR_RULES_DIR, `${rule.name}.mdc`)
    expectedCursorRules.add(path)
    const rendered = renderCursorRule(rule)
    const current = await readFile(path, 'utf8').catch(() => null)
    if (current === rendered) continue
    stale.push(path.replace(`${ROOT}/`, ''))
    if (!check) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, rendered)
    }
  }
  const cursorRuleFiles = await readdir(CURSOR_RULES_DIR).catch(() => [] as string[])
  for (const file of cursorRuleFiles) {
    if (!file.endsWith('.mdc')) continue
    const path = resolve(CURSOR_RULES_DIR, file)
    if (expectedCursorRules.has(path)) continue
    stale.push(`${path.replace(`${ROOT}/`, '')} (orphaned)`)
    if (!check) await rm(path)
  }

  if (!check) {
    for (const path of [LEGACY_CLAUDE_COMMANDS_DIR, LEGACY_CURSOR_COMMANDS_DIR]) {
      await rmdir(path).catch((error: unknown) => {
        const code =
          typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
        if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw error
      })
    }
  }

  if (check) {
    if (stale.length > 0) {
      console.error(
        `✗ ${stale.length} skill/rule projection(s) are stale — run \`bun run skills:sync\`:\n` +
          stale.map((p) => `    ${p}`).join('\n')
      )
      process.exit(1)
    }
    console.log(
      `✓ ${skills.length} canonical skills and ${rules.length} canonical rules available to Claude and Cursor`
    )
    return
  }

  console.log(
    stale.length === 0
      ? `✓ ${skills.length} skills and ${rules.length} rules already in sync — nothing to write`
      : `✓ updated ${stale.length} surface(s) from ${skills.length} canonical skills and ${rules.length} canonical rules`
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
