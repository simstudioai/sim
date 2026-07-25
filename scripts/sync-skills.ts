/**
 * Generate the per-tool skill/command projections from the canonical skill
 * sources so the three copies can never drift again.
 *
 * Canonical source of truth: `.agents/skills/<name>/SKILL.md`
 *   frontmatter: `name`, `description`, optional `argument-hint`; then the body.
 *
 * Projections (generated — do not hand-edit):
 *   - `.claude/commands/<name>.md` — frontmatter `description` (+ `argument-hint`), then the body.
 *   - `.cursor/commands/<name>.md` — no frontmatter, body only.
 *
 * The body is copied verbatim; cross-skill references intentionally point at the
 * canonical `.agents/skills/<x>/SKILL.md` from every projection, so a reader is
 * always sent to the single source of truth.
 *
 * Usage:
 *   bun run scripts/sync-skills.ts           # write projections
 *   bun run scripts/sync-skills.ts --check   # fail (exit 1) if any projection is stale
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const CANONICAL_DIR = resolve(ROOT, '.agents/skills')
const CLAUDE_DIR = resolve(ROOT, '.claude/commands')
const CURSOR_DIR = resolve(ROOT, '.cursor/commands')

interface Skill {
  name: string
  frontmatter: string[]
  body: string
}

/** Split a SKILL.md into its ordered frontmatter lines and the body. */
function parseSkill(name: string, raw: string): Skill {
  if (!raw.startsWith('---\n')) {
    throw new Error(`${name}: SKILL.md must start with a '---' frontmatter block`)
  }
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) throw new Error(`${name}: unterminated frontmatter block`)
  const frontmatter = raw.slice(4, end).split('\n')
  const body = raw
    .slice(end + 5)
    .replace(/^\n+/, '')
    .trimEnd()
  return { name, frontmatter, body }
}

/** Return the first frontmatter line whose key matches, verbatim, or undefined. */
function line(skill: Skill, key: string): string | undefined {
  return skill.frontmatter.find((l) => l.startsWith(`${key}:`))
}

function claudeProjection(skill: Skill): string {
  const desc = line(skill, 'description')
  if (!desc) throw new Error(`${skill.name}: missing 'description' in frontmatter`)
  const hint = line(skill, 'argument-hint')
  const fm = [desc, ...(hint ? [hint] : [])]
  return `---\n${fm.join('\n')}\n---\n\n${skill.body}\n`
}

function cursorProjection(skill: Skill): string {
  return `${skill.body}\n`
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
    skills.push(skill)
  }
  return skills
}

async function main() {
  const check = process.argv.includes('--check')
  const skills = await loadCanonicalSkills()

  const targets = skills.flatMap((skill) => [
    { path: resolve(CLAUDE_DIR, `${skill.name}.md`), content: claudeProjection(skill) },
    { path: resolve(CURSOR_DIR, `${skill.name}.md`), content: cursorProjection(skill) },
  ])

  const stale: string[] = []
  for (const { path, content } of targets) {
    const current = await readFile(path, 'utf8').catch(() => null)
    if (current === content) continue
    stale.push(path.replace(`${ROOT}/`, ''))
    if (!check) await writeFile(path, content)
  }

  if (check) {
    if (stale.length > 0) {
      console.error(
        `✗ ${stale.length} skill projection(s) are stale — run \`bun run skills:sync\`:\n` +
          stale.map((p) => `    ${p}`).join('\n')
      )
      process.exit(1)
    }
    console.log(`✓ ${skills.length} skills in sync across .claude/commands and .cursor/commands`)
    return
  }

  console.log(
    stale.length === 0
      ? `✓ ${skills.length} skills already in sync — nothing to write`
      : `✓ regenerated ${stale.length} projection(s) from ${skills.length} canonical skills`
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
