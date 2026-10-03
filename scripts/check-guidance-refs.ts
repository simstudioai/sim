#!/usr/bin/env bun
/**
 * Fails when agent guidance names something that does not exist.
 *
 * Agents follow `CLAUDE.md`, every `AGENTS.md`, `.claude/rules/*.md`, and `.agents/skills/`
 * literally, so a dead reference sends them searching for, or recreating, something that moved.
 * Checked:
 *
 * - `path`: a backticked or linked repo path, resolved against the repo root, the document's
 *   directory, and `apps/sim`. A token whose first segment exists in none of those is prose.
 * - `script`: `bun run <name>`, `turbo run <name>`, or a bare `check:<x>` / `<x>:check` that no
 *   workspace `package.json` declares; `bun run --cwd <dir> <name>` must be in `<dir>`.
 * - `skill`: `/name` on a line about skills, or `` `name` skill ``, with no `SKILL.md`.
 * - `import`: an `@/…` or `@sim/…` specifier that resolves to no file or package export.
 * - a rule's frontmatter `paths:` glob that matches no file, so the rule never loads.
 *
 * Anything containing `<…>`, `{…}`, `*`, or an ellipsis is a placeholder and skipped. There is
 * no baseline: fix the reference or delete the sentence.
 *
 * Run: `bun run check:guidance-refs`
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseRule } from './sync-skills'

const ROOT = path.resolve(import.meta.dir, '..')
const APP_ROOT = path.join(ROOT, 'apps/sim')
const SKILLS_DIR = path.join(ROOT, '.agents/skills')
const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.css']

interface Finding {
  file: string
  line: number
  kind: 'path' | 'script' | 'skill' | 'import'
  ref: string
}

/**
 * Every tracked or untracked-but-not-ignored file on disk, relative to the repo root. A file
 * deleted from the working tree but still in the index is dropped.
 */
function repoFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\n')
    .filter((rel) => rel && existsSync(path.join(ROOT, rel)))
}

/** Every guidance document, deduplicated through symlinks (`AGENTS.md` -> `CLAUDE.md`). */
function guidanceFiles(files: string[]): string[] {
  const found = new Map<string, string>()
  for (const rel of files) {
    const isGuidance =
      ['AGENTS.md', 'CLAUDE.md'].includes(path.basename(rel)) ||
      /^\.claude\/rules\/[^/]+\.md$/.test(rel) ||
      /^\.agents\/skills\/.+\.md$/.test(rel)
    // `.claude/skills` and `.cursor` are generated projections of `.agents/skills`.
    if (!isGuidance || rel.startsWith('.claude/skills/') || rel.startsWith('.cursor/')) continue
    const full = path.join(ROOT, rel)
    if (!existsSync(full)) continue
    const real = realpathSync(full)
    if (!found.has(real)) found.set(real, rel)
  }
  return [...found.values()].sort()
}

interface WorkspacePackage {
  dir: string
  /** The `exports` map, or null when the package declares none. */
  exports: Record<string, unknown> | null
}

interface Workspaces {
  /** Every script declared by the root or any workspace. */
  scripts: Set<string>
  /** Scripts per workspace directory (`''` is the root), for `bun run --cwd <dir>`. */
  scriptsByDir: Map<string, Set<string>>
  /** Workspace packages by name, with their export subpaths. */
  packages: Map<string, WorkspacePackage>
}

/** Reads the root and every workspace `package.json` (from the root `workspaces` globs) once. */
function readWorkspaces(files: string[]): Workspaces {
  const root = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const patterns: string[] = Array.isArray(root.workspaces)
    ? root.workspaces
    : (root.workspaces?.packages ?? [])
  const globs = patterns.map((pattern) => new Bun.Glob(`${pattern}/package.json`))
  const dirs = [
    '',
    ...files.filter((rel) => globs.some((glob) => glob.match(rel))).map(path.dirname),
  ]

  const workspaces: Workspaces = {
    scripts: new Set(),
    scriptsByDir: new Map(),
    packages: new Map(),
  }
  for (const dir of dirs) {
    const manifestPath = path.join(ROOT, dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const names = new Set(Object.keys(manifest.scripts ?? {}))
    workspaces.scriptsByDir.set(dir, names)
    for (const name of names) workspaces.scripts.add(name)
    if (dir && typeof manifest.name === 'string') {
      const exports =
        manifest.exports && typeof manifest.exports === 'object' ? manifest.exports : null
      workspaces.packages.set(manifest.name, { dir: path.join(ROOT, dir), exports })
    }
  }
  return workspaces
}

function isPlaceholder(ref: string): boolean {
  return /[<>{}*$]|\.\.\.|…|\bfoo\b|\bxxx?\b/i.test(ref)
}

/** A file or directory inside the repo; a path escaping the root never resolves. */
function resolvesFrom(base: string, ref: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => {
    const candidate = path.resolve(base, `${ref}${ext}`)
    return !path.relative(ROOT, candidate).startsWith('..') && existsSync(candidate)
  })
}

const MODULE_CANDIDATES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/index.js',
]

/** An import specifier resolves only to a module file, never to a bare directory. */
function moduleResolves(base: string, ref: string): boolean {
  return MODULE_CANDIDATES.some((suffix) => {
    const candidate = path.join(base, `${ref}${suffix}`)
    return existsSync(candidate) && statSync(candidate).isFile()
  })
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
  if (PATH_PREFIXES.some((prefix) => clean.startsWith(prefix))) {
    return resolvesFrom(ROOT, clean)
  }
  const bases = [ROOT, docDir, APP_ROOT]
  const rel = clean.replace(/^\.\//, '')
  const first = rel.split('/')[0]
  const anchored = bases.filter((base) => existsSync(path.join(base, first)))
  if (anchored.length === 0) return true
  return anchored.some((base) => resolvesFrom(base, rel))
}

function importResolves(spec: string, packages: Map<string, WorkspacePackage>): boolean {
  const clean = spec.replace(/\/$/, '')
  if (clean === '@' || clean === '@sim') return true
  if (clean.startsWith('@/')) {
    return moduleResolves(APP_ROOT, clean.slice(2))
  }
  const [scope, name, ...rest] = clean.split('/')
  const pkg = packages.get(`${scope}/${name}`)
  if (!pkg) return false
  if (!pkg.exports) return rest.length === 0 || moduleResolves(pkg.dir, rest.join('/'))
  const subpath = rest.length === 0 ? '.' : `./${rest.join('/')}`
  // An export key only proves the specifier is declared; the file it maps to must also exist.
  return Object.entries(pkg.exports).some(([key, value]) => {
    const target = exportTarget(value)
    if (target === null) return false
    const [head, tail] = key.split('*')
    if (tail === undefined) return key === subpath && moduleResolves(pkg.dir, target)
    if (!subpath.startsWith(head) || !subpath.endsWith(tail)) return false
    const matched = subpath.slice(head.length, subpath.length - tail.length)
    return moduleResolves(pkg.dir, target.replaceAll('*', matched))
  })
}

/** The first file path an export condition map points at. */
function exportTarget(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return null
  for (const nested of Object.values(value)) {
    const target = exportTarget(nested)
    if (target) return target
  }
  return null
}

function skillExists(name: string): boolean {
  return existsSync(path.join(SKILLS_DIR, name, 'SKILL.md'))
}

const CODE_SPAN = /`([^`\n]+)`/g
const MD_LINK = /\]\(([^)\s]+)\)/g
const SCRIPT_RUN =
  /\b(?:bun run|turbo run|bunx turbo run)\s+(?:--filter[= ]\S+\s+|-F\s+\S+\s+|--cwd[= ](\S+)\s+)?([^\s`'"]+)/g
const IMPORT_SPEC = /(['"`])((?:@\/|@sim\/)[^'"`\s]+)\1/g
const SKILL_SLASH = /(?:^|[\s(`"'])\/([a-z][a-z0-9]*(?:-[a-z0-9]+)+|[a-z]{3,})(?=[\s`)"',.:;]|$)/g
const SKILL_NAMED = /`\/?([a-z][a-z0-9-]+)`\s+skills?\b/g
const REPO_PATH =
  /(?:^|[\s'"`(=])((?:apps|packages|scripts|\.claude|\.agents|\.github)\/[\w@.()[\]{}<>*/-]+)/g
const CHECK_TOKEN = /^(check:[\w:-]+|[\w-]+:check)$/
const PATH_TOKEN = /^\.{0,2}\/?[\w@.()[\]-]+(?:\/[\w@.()[\]-]*)+$/
const BARE_DOC = /^[\w.-]+\.md$/

/** Drops sentence punctuation and an unbalanced closing paren from a path found in running text. */
function trimProse(ref: string): string {
  let trimmed = ref.replace(/[.,:;]+$/, '')
  while (trimmed.endsWith(')') && trimmed.split('(').length < trimmed.split(')').length) {
    trimmed = trimmed.slice(0, -1).replace(/[.,:;]+$/, '')
  }
  return trimmed
}

/** Extracts every unresolved reference from one document. */
function auditDocument(relFile: string, workspaces: Workspaces, files: string[]): Finding[] {
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

  const checkScript = (line: number, raw: string, cwd?: string) => {
    const name = raw.replace(/[.,;:)]+$/, '')
    if (isPlaceholder(name) || name.includes('/') || name.endsWith('.ts') || name.startsWith('-')) {
      return
    }
    if (cwd !== undefined) {
      if (isPlaceholder(cwd)) return
      const declared = workspaces.scriptsByDir.get(cwd.replace(/^\.\//, '').replace(/\/$/, ''))
      if (!declared?.has(name)) report(line, 'script', `${name} (in ${cwd})`)
      return
    }
    if (!workspaces.scripts.has(name)) report(line, 'script', name)
  }

  const checkPath = (line: number, raw: string) => {
    if (isPlaceholder(raw) || /^[a-z]+:\/\//i.test(raw) || raw.startsWith('~')) return
    if (raw.startsWith('@/') || raw.startsWith('@sim/')) {
      if (!importResolves(raw, workspaces.packages)) report(line, 'import', raw)
      return
    }
    if (raw.startsWith('/')) return
    if (!pathResolves(raw, docDir)) report(line, 'path', raw)
  }

  const raw = readFileSync(file, 'utf8')
  const lines = raw.split('\n')
  if (relFile.startsWith('.claude/rules/')) {
    for (const glob of parseRule(path.basename(relFile, '.md'), raw).paths) {
      const matcher = new Bun.Glob(glob)
      if (files.some((rel) => matcher.match(rel))) continue
      report(lines.findIndex((text) => text.includes(glob)) + 1, 'path', glob)
    }
  }

  let inFence = false
  lines.forEach((text, index) => {
    const line = index + 1
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence
      return
    }
    for (const match of text.matchAll(SCRIPT_RUN)) checkScript(line, match[2], match[1])
    for (const match of text.matchAll(REPO_PATH)) checkPath(line, trimProse(match[1]))
    if (inFence) {
      // Example code: only imports are concrete enough to check.
      if (/\b(?:from|import|require|mock|vi\.mock|doMock)\b/.test(text)) {
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
      const token = span.split(/\s/)[0]
      // An import specifier is checked even when prose follows it in the span.
      if (span !== token && !/^@(?:sim)?\//.test(token)) continue
      if (PATH_TOKEN.test(token)) checkPath(line, token)
      else if (BARE_DOC.test(token) && !isPlaceholder(token)) {
        const bases = [docDir, ROOT, path.join(ROOT, '.claude/rules')]
        if (!bases.some((base) => existsSync(path.join(base, token)))) report(line, 'path', token)
      }
    }
    for (const match of text.matchAll(MD_LINK)) {
      const target = match[1]
      if (/^(mailto:|#)/.test(target)) continue
      if (isPlaceholder(target) || /^[a-z]+:\/\//i.test(target)) continue
      if (target.startsWith('@/') || target.startsWith('@sim/')) {
        checkPath(line, target)
        continue
      }
      // A link names its destination explicitly, so there is no prose fallback: it resolves from
      // the repo root (leading `/`) or from the document's own folder.
      const dest = target.replace(/[#?].*$/, '')
      const base = dest.startsWith('/') ? ROOT : docDir
      if (dest && !resolvesFrom(base, dest.replace(/^\//, '').replace(/\/$/, ''))) {
        report(line, 'path', target)
      }
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
  const files = repoFiles()
  const docs = guidanceFiles(files)
  const workspaces = readWorkspaces(files)
  const findings = docs.flatMap((doc) => auditDocument(doc, workspaces, files))

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

  console.log(`Guidance references resolve: ${docs.length} documents checked.`)
}
