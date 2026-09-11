import { canonical, fingerprint, semanticSource } from '#design-diff/ast'
import { compareDefinitions, finding } from '#design-diff/compare'
import { extractAsset } from '#design-diff/extract/assets'
import { cssValue, extractCss } from '#design-diff/extract/css'
import { extractDocument } from '#design-diff/extract/documents'
import { extractTsx } from '#design-diff/extract/tsx'
import { GitReader } from '#design-diff/git'
import { groupFindings } from '#design-diff/group'
import { reclaimMemory } from '#design-diff/memory'
import { limitations } from '#design-diff/policy'
import { Resolver } from '#design-diff/resolve'
import {
  assetPattern,
  infrastructure,
  SourceTree,
  scoped,
  scriptPattern,
} from '#design-diff/source'
import { TailwindNormalizer } from '#design-diff/tailwind'
import type { Change, Config, Definition, Report } from '#design-diff/types'

export function emptyReport(): Report {
  return {
    schemaVersion: '2.0.0',
    engineVersion: '0.2.0',
    policyVersion: '2.0.0',
    commits: null,
    status: 'failed',
    flagged: null,
    findings: [],
    limitations,
  }
}

function review(file: string, value: string, reason: string): Definition {
  return {
    key: 'review',
    kind: 'review',
    property: /^(?:Rendering|Resolved dependency)/.test(reason) ? 'infrastructure' : 'unresolved',
    value,
    location: { file, line: 1, column: 1 },
    symbol: 'module',
    conditions: [],
    dependencies: [file],
    unresolved: [reason],
  }
}

function equivalent(a: string | undefined, b: string | undefined, file: string): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  try {
    if (scriptPattern.test(file)) return semanticSource(a, file) === semanticSource(b, file)
    if (file.endsWith('.css')) return cssValue(a) === cssValue(b)
  } catch {
    return false
  }
  return false
}

export async function analyze(
  cwd: string,
  base: string,
  head: string,
  config: Config
): Promise<Report> {
  const report = emptyReport()
  const reader = new GitReader(cwd)
  report.commits = reader.compare(base, head)
  const changes = reader.changes(report.commits.mergeBase, report.commits.head)
  const before = new SourceTree(reader, report.commits.mergeBase, config)
  const after = new SourceTree(reader, report.commits.head, config)
  reclaimMemory()
  const changed = new Set<string>()
  for (const change of changes) {
    const file = change.after ?? (change.before as string)
    if (
      !scoped(file, config) &&
      !infrastructure(file, config) &&
      file !== 'package.json' &&
      file !== 'bun.lock'
    )
      continue
    const a = change.before && before.entries.get(change.before)
    const b = change.after && after.entries.get(change.after)
    if (
      a &&
      b &&
      a.oid === b.oid &&
      a.mode === b.mode &&
      !(assetPattern.test(file) && a.path !== b.path)
    )
      continue
    if (
      a &&
      b &&
      equivalent(before.texts.get(a.path), after.texts.get(b.path), file) &&
      !assetPattern.test(file) &&
      before.texts.has(a.path)
    )
      continue
    if (change.before) changed.add(change.before)
    if (change.after) changed.add(change.after)
  }
  const findings: Change[] = []
  let causes = new Map<string, Set<string>>()
  const renames = new Map(
    changes
      .filter((change) => change.status.startsWith('R'))
      .map((change) => [change.after as string, change.before as string])
  )
  if (changed.size) {
    before.buildGraph()
    after.buildGraph()
    causes = before.graph.causes(changed, after.graph)
    const affected = new Set(causes.keys())
    for (const theme of config.themes) {
      if (!affected.has(theme.path)) continue
      for (const file of new Set([...before.texts.keys(), ...after.texts.keys()])) {
        if (
          theme.roots.some((root) => file.startsWith(root)) &&
          /\.(?:[jt]sx|css|html?|mdx?)$/.test(file)
        ) {
          affected.add(file)
          causes.set(
            file,
            new Set([...(causes.get(file) ?? []), ...(causes.get(theme.path) ?? [theme.path])])
          )
        }
      }
    }
    const previousResolver = new Resolver(before)
    const nextResolver = new Resolver(after)
    const previousTailwind = new TailwindNormalizer(before)
    const nextTailwind = new TailwindNormalizer(after)
    const extract = async (
      tree: SourceTree,
      resolver: Resolver,
      tailwind: TailwindNormalizer,
      file: string
    ): Promise<Definition[]> => {
      const entry = tree.entries.get(file)
      if (!entry) return []
      if (tree.failures.has(file))
        return [review(file, entry.oid, 'Parser failure, unsupported symlink or source size limit')]
      if (
        assetPattern.test(file) ||
        (/\/public\//.test(file) && !scriptPattern.test(file) && !file.endsWith('.css'))
      )
        return extractAsset(entry)
      const source = tree.texts.get(file)
      if (source === undefined) return []
      const normalizeAll = async (definitions: Definition[]) => {
        for (const definition of definitions)
          if (definition.unresolved.length || definition.kind === 'review')
            definition.dependencies = [
              ...new Set([...definition.dependencies, ...(tree.dependencies.get(file) ?? [])]),
            ].sort()
        return Promise.all(definitions.map((definition) => tailwind.normalize(definition)))
      }
      try {
        if (scriptPattern.test(file)) {
          const defs = extractTsx(resolver, file)
          if (config.nativeRendering.includes(file))
            defs.push(
              review(
                file,
                fingerprint(semanticSource(source, file)),
                'Native menus, palettes and embedded rendering need review'
              )
            )
          for (const definition of defs) {
            if (
              definition.movement &&
              [...tree.texts].some(
                ([name, text]) => name.endsWith('.css') && /\b(?:svg|rect|circle)\b|\*/.test(text)
              )
            )
              definition.movement = undefined
            if (definition.unresolved.length || definition.kind === 'review')
              definition.dependencies = [
                ...new Set([...definition.dependencies, ...(tree.dependencies.get(file) ?? [])]),
              ].sort()
          }
          const normalized: Definition[] = []
          for (const definition of defs) normalized.push(await tailwind.normalize(definition))
          return normalized
        }
        if (file.endsWith('.css')) return normalizeAll(extractCss(source, file))
        if (
          /\.html?$/.test(file) ||
          (/\.mdx?$/.test(file) && config.renderedMarkdown.some((root) => file.startsWith(root)))
        )
          return normalizeAll(extractDocument(source, file))
        if (/\.(?:scss|sass|less|vue|svelte)$/.test(file))
          return [review(file, entry.oid, 'Unsupported rendering syntax')]
      } catch {
        return [review(file, entry.oid, 'Visual source extraction failed')]
      }
      return []
    }
    let extracted = 0
    for (const file of [...affected].sort()) {
      if (++extracted % 32 === 0) reclaimMemory()
      if (!scoped(file, config) && !infrastructure(file, config)) continue
      if ([...renames.values()].includes(file) && !after.entries.has(file)) continue
      const oldFile = renames.get(file) ?? file
      const a = await extract(before, previousResolver, previousTailwind, oldFile)
      const b = await extract(after, nextResolver, nextTailwind, file)
      findings.push(...compareDefinitions(a, b, affected))
      if (
        changed.has(file) &&
        config.infrastructure.some((pattern) => new RegExp(pattern).test(file))
      ) {
        findings.push(
          finding(
            before.entries.has(oldFile)
              ? review(
                  oldFile,
                  before.entries.get(oldFile)?.oid ?? '',
                  'Rendering infrastructure is not executed'
                )
              : undefined,
            after.entries.has(file)
              ? review(
                  file,
                  after.entries.get(file)?.oid ?? '',
                  'Rendering infrastructure is not executed'
                )
              : undefined,
            'Rendering infrastructure changed'
          )
        )
      }
      if (
        changed.has(file) &&
        a.length === 0 &&
        b.length === 0 &&
        /\.(?:vue|svelte|scss|sass|less)$/.test(file)
      )
        findings.push(
          finding(
            undefined,
            review(file, after.entries.get(file)?.oid ?? '', 'Unsupported rendering mechanism')
          )
        )
    }
    for (const file of changed) {
      if (file !== 'bun.lock' && !file.endsWith('/package.json') && file !== 'package.json')
        continue
      if (file === 'bun.lock') {
        findings.push(
          finding(
            undefined,
            review(
              file,
              after.entries.get(file)?.oid ?? '',
              'Resolved dependency changes can affect rendering'
            )
          )
        )
        continue
      }
      const project = (source?: string) => {
        if (!source) return null
        try {
          const manifest = JSON.parse(source)
          const dependencies: Record<string, unknown> = {}
          for (const section of [
            'dependencies',
            'devDependencies',
            'peerDependencies',
            'overrides',
          ])
            for (const [name, version] of Object.entries(manifest[section] ?? {}))
              if (new RegExp(config.renderingDependencies).test(name))
                dependencies[`${section}:${name}`] = version
          return canonical({
            dependencies,
            exports: manifest.exports,
            imports: manifest.imports,
            main: manifest.main,
            browser: manifest.browser,
            sideEffects: manifest.sideEffects,
          })
        } catch {
          return 'Unparseable manifest'
        }
      }
      const a = project(before.texts.get(file))
      const b = project(after.texts.get(file))
      if (JSON.stringify(a) !== JSON.stringify(b))
        findings.push(
          finding(
            { ...review(file, '', 'Rendering dependencies or module mappings changed'), value: a },
            { ...review(file, '', 'Rendering dependencies or module mappings changed'), value: b }
          )
        )
    }
  }
  report.status = 'completed'
  report.findings = groupFindings(findings, causes, before, after, renames)
  report.flagged = report.findings.some((item) => item.decision === 'flag')
  return report
}
