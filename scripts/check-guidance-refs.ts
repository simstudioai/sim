#!/usr/bin/env bun
/**
 * Fails when agent guidance names something that does not exist.
 *
 * Agents follow `CLAUDE.md`, every `AGENTS.md`, `.claude/rules/*.md`, and the skills under
 * `.agents/skills/` literally. A rule that points at a moved file, a renamed `check:*` script, a
 * deleted skill, or an import path that no longer resolves sends the agent searching for it, or
 * worse, recreating it. Code moves weekly and nothing else ties the prose to the tree, so this
 * audit resolves every concrete reference the guidance makes:
 *
 * - `path`: a backticked or linked repo path (`apps/sim/lib/...`, `.claude/rules/x.md`,
 *   `scripts/x.ts`). Resolved against the repo root, the document's directory, and `apps/sim`
 *   (rules usually name app paths without the prefix). A path whose first segment exists in none
 *   of those is not treated as a path, so MIME types and prose like `basic/advanced` pass.
 * - `script`: `bun run <name>`, `turbo run <name>`, or a bare `check:<x>` / `<x>:check` that is
 *   not a script in any workspace `package.json`.
 * - `skill`: `/name` on a line that talks about skills, or `` `name` skill ``, with no
 *   `.agents/skills/<name>/SKILL.md`.
 * - `import`: an `@/…` or `@sim/…` specifier (in a code span, or a fenced `import`/`from` line)
 *   that does not resolve to a file, directory, or package export.
 * - a rule's frontmatter `paths:` glob that matches no file, which silently stops the rule from
 *   loading for the code it was written for.
 *
 * Placeholders are skipped rather than allow-listed: anything containing `<…>`, `{…}`, `*`, or
 * an ellipsis is a pattern, not a reference. A reference in `~/…`, a URL, or another repo is out
 * of scope.
 *
 * Fix a finding by pointing the sentence at the current path or name, or delete the sentence when
 * the thing is gone. There is no baseline: guidance is small enough to keep at zero.
 *
 * Run: `bun run check:guidance-refs`
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const APP_ROOT = path.join(ROOT, 'apps/sim')
const SKILLS_DIR = path.join(ROOT, '.agents/skills')
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.turbo', 'dist', 'build', 'worktrees'])
const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.css']

interface Finding {
  file: string
  line: number
  kind: 'path' | 'script' | 'skill' | 'import'
  ref: string
}

/** Every guidance document, deduplicated through symlinks (`AGENTS.md` -> `CLAUDE.md`). */
function guidanceFiles(): string[] {
  const found = new Map<string, string>()
  const add = (file: string) => {
    const real = realpathSync(file)
    if (!found.has(real)) found.set(real, path.relative(ROOT, file))
  }
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        // `.claude/skills` is a generated projection of `.agents/skills`.
        if (full === path.join(ROOT, '.claude/skills') || full === path.join(ROOT, '.cursor')) {
          continue
        }
        walk(full)
      } else if (entry.name === 'AGENTS.md' || entry.name === 'CLAUDE.md') {
        add(full)
      }
    }
  }
  walk(ROOT)
  for (const entry of readdirSync(path.join(ROOT, '.claude/rules'))) {
    if (entry.endsWith('.md')) add(path.join(ROOT, '.claude/rules', entry))
  }
  const walkSkills = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walkSkills(full)
      else if (entry.name.endsWith('.md')) add(full)
    }
  }
  walkSkills(SKILLS_DIR)
  return [...found.values()].sort()
}

/** Script names declared by the root and every workspace `package.json`. */
function scriptNames(): Set<string> {
  const names = new Set<string>()
  const manifests = [path.join(ROOT, 'package.json')]
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(path.join(ROOT, group))) {
      const manifest = path.join(ROOT, group, entry, 'package.json')
      if (existsSync(manifest)) manifests.push(manifest)
    }
  }
  for (const manifest of manifests) {
    const scripts = JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {}
    for (const name of Object.keys(scripts)) names.add(name)
  }
  return names
}

interface WorkspacePackage {
  dir: string
  exports: string[]
}

/** `@sim/*` packages by name, with their export subpaths. */
function workspacePackages(): Map<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>()
  for (const entry of readdirSync(path.join(ROOT, 'packages'))) {
    const manifestPath = path.join(ROOT, 'packages', entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (typeof manifest.name !== 'string') continue
    const exports =
      manifest.exports && typeof manifest.exports === 'object' ? Object.keys(manifest.exports) : []
    packages.set(manifest.name, { dir: path.join(ROOT, 'packages', entry), exports })
  }
  return packages
}

function isPlaceholder(ref: string): boolean {
  return /[<>{}*$]|\.\.\.|…|\bfoo\b|\bxxx?\b/i.test(ref)
}

function resolvesFrom(base: string, ref: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => existsSync(path.join(base, `${ref}${ext}`)))
}

const PATH_PREFIXES = ['apps/', 'packages/', 'scripts/', '.claude/', '.agents/', '.github/']

/**
 * Checks a path-shaped token. Returns false only for a confirmed dead reference: a token whose
 * first segment does not exist anywhere is prose, not a path.
 */
function pathResolves(ref: string, docDir: string): boolean {
  const clean = ref
    .replace(/[#?].*$/, '')
    .replace(/:\d+(-\d+)?$/, '')
    .replace(/\/$/, '')
  if (!clean) return true
  const bases = [ROOT, docDir, APP_ROOT]
  if (PATH_PREFIXES.some((prefix) => clean.startsWith(prefix))) {
    return resolvesFrom(ROOT, clean)
  }
  const first = clean.replace(/^\.\//, '').split('/')[0]
  const anchored = bases.filter((base) => existsSync(path.join(base, first)))
  if (anchored.length === 0) return true
  return anchored.some((base) => resolvesFrom(base, clean.replace(/^\.\//, '')))
}

function importResolves(spec: string, packages: Map<string, WorkspacePackage>): boolean {
  const clean = spec.replace(/\/$/, '')
  if (clean === '@' || clean === '@sim') return true
  if (clean.startsWith('@/')) {
    const rel = clean.slice(2)
    return (
      resolvesFrom(APP_ROOT, rel) ||
      ['/index.ts', '/index.tsx'].some((index) => existsSync(path.join(APP_ROOT, `${rel}${index}`)))
    )
  }
  const [scope, name, ...rest] = clean.split('/')
  const pkg = packages.get(`${scope}/${name}`)
  if (!pkg) return false
  if (rest.length === 0) return true
  const subpath = `./${rest.join('/')}`
  if (pkg.exports.length === 0) return resolvesFrom(pkg.dir, rest.join('/'))
  return pkg.exports.some((key) => {
    if (key === subpath) return true
    if (!key.includes('*')) return false
    const [head, tail] = key.split('*')
    return subpath.startsWith(head) && subpath.endsWith(tail)
  })
}

function skillExists(name: string): boolean {
  return existsSync(path.join(SKILLS_DIR, name, 'SKILL.md'))
}

const CODE_SPAN = /`([^`\n]+)`/g
const MD_LINK = /\]\(([^)\s]+)\)/g
const SCRIPT_RUN =
  /\b(?:bun run|turbo run|bunx turbo run)\s+(?:--filter[= ]\S+\s+|-F\s+\S+\s+)?([^\s`'"]+)/g
const IMPORT_SPEC = /(['"`])((?:@\/|@sim\/)[^'"`\s]+)\1/g
const SKILL_SLASH = /(?:^|[\s(`"'])\/([a-z][a-z0-9]*(?:-[a-z0-9]+)+|[a-z]{3,})(?=[\s`)"',.:;]|$)/g
const SKILL_NAMED = /`\/?([a-z][a-z0-9-]+)`\s+skills?\b/g
const REPO_PATH =
  /(?:^|[\s'"`(=])((?:apps|packages|scripts|\.claude|\.agents|\.github)\/[\w@.()[\]{}<>*/-]+)/g
const CHECK_TOKEN = /^(check:[\w:-]+|[\w-]+:check)$/
const PATH_TOKEN = /^\.{0,2}\/?[\w@.()[\]-]+(?:\/[\w@.()[\]-]*)+$/
const BARE_DOC = /^[\w.-]+\.md$/

/**
 * The `paths:` globs in a rule's frontmatter. A glob that matches nothing silently stops the rule
 * from loading for the files it was written for.
 */
function frontmatterPaths(lines: string[]): Array<{ line: number; glob: string }> {
  if (lines[0] !== '---') return []
  const globs: Array<{ line: number; glob: string }> = []
  let inPaths = false
  for (let index = 1; index < lines.length && lines[index] !== '---'; index++) {
    const text = lines[index]
    if (/^paths:\s*$/.test(text)) {
      inPaths = true
      continue
    }
    const item = text.match(/^\s+-\s+["']?([^"']+)["']?\s*$/)
    if (inPaths && item) globs.push({ line: index + 1, glob: item[1] })
    else if (!/^\s/.test(text)) inPaths = false
  }
  return globs
}

function globMatchesAnything(pattern: string): boolean {
  const glob = new Bun.Glob(pattern)
  for (const _ of glob.scanSync({ cwd: ROOT, onlyFiles: true })) return true
  return false
}

/** Drops sentence punctuation and an unbalanced closing paren from a path found in running text. */
function trimProse(ref: string): string {
  let trimmed = ref.replace(/[.,:;]+$/, '')
  while (trimmed.endsWith(')') && trimmed.split('(').length < trimmed.split(')').length) {
    trimmed = trimmed.slice(0, -1).replace(/[.,:;]+$/, '')
  }
  return trimmed
}

/** Extracts every unresolved reference from one document. */
function auditDocument(
  relFile: string,
  scripts: Set<string>,
  packages: Map<string, WorkspacePackage>
): Finding[] {
  const findings: Finding[] = []
  const file = path.join(ROOT, relFile)
  const docDir = path.dirname(file)
  const seen = new Set<string>()
  const report = (line: number, kind: Finding['kind'], ref: string) => {
    const key = `${line}:${kind}:${ref}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({ file: relFile, line, kind, ref })
  }

  const checkScript = (line: number, raw: string) => {
    const name = raw.replace(/[.,;:)]+$/, '')
    if (isPlaceholder(name) || name.includes('/') || name.endsWith('.ts')) return
    if (name.startsWith('-')) return
    if (!scripts.has(name)) report(line, 'script', name)
  }

  const checkPath = (line: number, raw: string) => {
    if (isPlaceholder(raw) || /^[a-z]+:\/\//i.test(raw) || raw.startsWith('~')) return
    if (raw.startsWith('@/') || raw.startsWith('@sim/')) {
      if (!importResolves(raw, packages)) report(line, 'import', raw)
      return
    }
    if (raw.startsWith('/')) return
    if (!pathResolves(raw, docDir)) report(line, 'path', raw)
  }

  const lines = readFileSync(file, 'utf8').split('\n')
  for (const { line, glob } of frontmatterPaths(lines)) {
    if (!globMatchesAnything(glob)) report(line, 'path', glob)
  }

  let inFence = false
  lines.forEach((text, index) => {
    const line = index + 1
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence
      return
    }
    for (const match of text.matchAll(SCRIPT_RUN)) checkScript(line, match[1])
    for (const match of text.matchAll(REPO_PATH)) checkPath(line, trimProse(match[1]))
    if (inFence) {
      // Example code: only imports are concrete enough to check.
      if (/\b(?:from|import|mock|vi\.mock|doMock)\b/.test(text)) {
        for (const match of text.matchAll(IMPORT_SPEC)) checkPath(line, match[2])
      }
      return
    }

    for (const match of text.matchAll(CODE_SPAN)) {
      const span = match[1].trim()
      if (CHECK_TOKEN.test(span)) {
        checkScript(line, span)
        continue
      }
      for (const imported of span.matchAll(IMPORT_SPEC)) checkPath(line, imported[2])
      if (span.startsWith('@/') || span.startsWith('@sim/')) {
        checkPath(line, span.split(/\s/)[0])
        continue
      }
      const token = span.split(/\s/)[0]
      if (span === token && PATH_TOKEN.test(token)) checkPath(line, token)
      else if (span === token && BARE_DOC.test(token) && !isPlaceholder(token)) {
        const bases = [docDir, ROOT, path.join(ROOT, '.claude/rules')]
        if (!bases.some((base) => existsSync(path.join(base, token)))) report(line, 'path', token)
      }
    }
    for (const match of text.matchAll(MD_LINK)) {
      const target = match[1]
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const resolved = target.startsWith('/') ? target.slice(1) : target
      if (!pathResolves(resolved, docDir)) report(line, 'path', target)
    }

    const outsideSpans = text.replace(/`[^`\n]*`/g, (span) =>
      span.startsWith('`/') ? span : 'CODE'
    )
    if (/\bskills?\b/i.test(text)) {
      for (const match of outsideSpans.matchAll(SKILL_SLASH)) {
        if (!isPlaceholder(match[1]) && !skillExists(match[1])) report(line, 'skill', match[1])
      }
    }
    for (const match of text.matchAll(SKILL_NAMED)) {
      if (!skillExists(match[1])) report(line, 'skill', match[1])
    }
  })
  return findings
}

if (import.meta.main) {
  const files = guidanceFiles()
  const scripts = scriptNames()
  const packages = workspacePackages()
  const findings = files.flatMap((file) => auditDocument(file, scripts, packages))

  if (findings.length > 0) {
    const fixes: Record<Finding['kind'], string> = {
      path: 'no such file or directory',
      script: 'no package.json declares this script',
      skill: 'no .agents/skills/<name>/SKILL.md',
      import: 'specifier does not resolve to a file or package export',
    }
    console.error(`Guidance references that do not exist (${findings.length}):\n`)
    for (const finding of findings) {
      console.error(
        `  ${finding.file}:${finding.line}  [${finding.kind}] ${finding.ref} — ${fixes[finding.kind]}`
      )
    }
    console.error(
      '\nPoint each reference at the current path or name, or delete the sentence if the thing is gone.' +
        '\nWrite a pattern with a placeholder (`<name>`, `{service}`, `*`) when no single file is meant.'
    )
    process.exit(1)
  }

  console.log(`Guidance references resolve: ${files.length} documents checked.`)
}
