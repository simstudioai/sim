#!/usr/bin/env bun
/**
 * Keeps the design system's CSS on the pages built for it. The Platform's product routes
 * (`PRODUCT_ROUTES`) have their own root layout, so their stylesheets never share a document with
 * the site's; within each root, Next keeps route CSS loaded after client navigation, so one global
 * rule from a page keeps applying on every page the viewer opens afterwards. Two rules hold that line:
 *
 * - `module-escape`: every rule in a product, Platform or shared EMCN CSS Module needs a local
 *   (hashed) class, and nothing may opt out through `:global`. A top-level `@layer components` block
 *   may join the existing layer; layer-order statements and new layers remain forbidden.
 * - `route-reach`: only the product routes may load the design system. No other Next entry (the
 *   site's pages, auth, the extension's panel) may reach `platform/` or `packages/emcn-platform`
 *   through any import, static or dynamic. Dynamic counts because Next attaches a dynamically
 *   imported module's CSS to a Server Component's route whether or not it renders.
 *
 * Run: `bun run check:platform-css`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import postcss, { type AcceptedPlugin, type AtRule } from 'postcss'
import { emcnPackages, resolveEmcnImport } from './emcn-packages'
import { PRODUCT_ROUTES } from './platform-product-routes'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP = path.join(ROOT, 'apps/sim')
const PLATFORM = path.join(APP, 'platform')
const PACKAGES = emcnPackages(ROOT)
const SHARED = path.join(ROOT, 'packages/emcn/src')
const PLATFORM_COMPONENTS = path.join(ROOT, 'packages/emcn-platform/src')
const PRODUCT = path.join(APP, PRODUCT_ROUTES)

const MODULE_AT_RULES = new Set(['media', 'container', 'supports', 'keyframes'])
const NEXT_ENTRY =
  /^(?:page|layout|template|loading|error|global-error|not-found|default|route)\.[jt]sx?$/
const ROOT_ENTRIES = ['proxy.ts', 'instrumentation.ts', 'instrumentation-node.ts', 'bootstrap.ts']
const CODE_FILE = /\.[jt]sx?$/
const CSS_MODULE = /\.module\.css$/
const TEST_FILE = /\.(?:test|spec)\.[jt]sx?$|\.integration\.ts$/
const SKIPPED_FOLDERS = new Set(['node_modules', '.next', 'dist', 'public'])
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.cjs', '/index.ts', '/index.tsx']

export interface Finding {
  rule: 'module-escape' | 'route-reach'
  detail: string
}

export function findModuleEscapes(css: string, file: string): Finding[] {
  const findings: Finding[] = []
  const root = postcss.parse(css)
  root.walkAtRules((atRule) => {
    const componentLayer =
      atRule.name === 'layer' &&
      atRule.params === 'components' &&
      atRule.nodes !== undefined &&
      atRule.parent === root
    if (!MODULE_AT_RULES.has(atRule.name) && !componentLayer) {
      findings.push({ rule: 'module-escape', detail: `${file}: @${atRule.name} ${atRule.params}` })
    }
  })
  root.walkRules((rule) => {
    const { parent } = rule
    const inheritsLocalScope =
      parent?.type === 'rule' || (parent as AtRule | undefined)?.name === 'keyframes'
    for (const selector of rule.selectors) {
      if (
        selector.includes(':global') ||
        (!inheritsLocalScope && !/\.-?[_a-zA-Z]/.test(selector))
      ) {
        findings.push({ rule: 'module-escape', detail: `${file}: ${selector}` })
      }
    }
  })
  return findings
}

function walk(directory: string, pattern: RegExp, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_FOLDERS.has(entry.name)) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(full, pattern, files)
    else if (pattern.test(entry.name) && !TEST_FILE.test(entry.name)) files.push(full)
  }
  return files
}

function resolveSpecifier(specifier: string, from: string): string | null {
  const workspace = resolveEmcnImport(PACKAGES, specifier, from)
  const base =
    workspace ??
    (specifier.startsWith('@/')
      ? path.join(APP, specifier.slice(2))
      : specifier.startsWith('.')
        ? path.resolve(path.dirname(from), specifier)
        : null)
  if (!base) return null
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate
  }
  return null
}

/** Walks importers back from `platform/`, so each module is visited once however the graph cycles. */
function findRouteReach(): Finding[] {
  const insidePlatform = (file: string) =>
    [PLATFORM, PLATFORM_COMPONENTS].some((directory) => file.startsWith(`${directory}${path.sep}`))
  const files = [
    ...walk(APP, CODE_FILE),
    ...PACKAGES.flatMap((owner) => walk(owner.source, CODE_FILE)),
  ].filter((file) => !insidePlatform(file))
  const tsTranspiler = new Bun.Transpiler({ loader: 'ts' })
  const tsxTranspiler = new Bun.Transpiler({ loader: 'tsx' })
  const importers = new Map<string, string[]>()
  const queue: string[] = []
  /** Maps a module that reaches `platform/` to its next step on the way there. */
  const nextStep = new Map<string, string>()
  for (const file of files) {
    const transpiler = file.endsWith('x') ? tsxTranspiler : tsTranspiler
    for (const { path: specifier } of transpiler.scan(readFileSync(file, 'utf8')).imports) {
      const target = resolveSpecifier(specifier, file)
      if (!target) continue
      if (insidePlatform(target)) {
        if (!nextStep.has(file)) queue.push(file)
        nextStep.set(file, target)
      } else if (importers.has(target)) {
        importers.get(target)?.push(file)
      } else {
        importers.set(target, [file])
      }
    }
  }
  for (const file of queue) {
    for (const importer of importers.get(file) ?? []) {
      if (nextStep.has(importer)) continue
      nextStep.set(importer, file)
      queue.push(importer)
    }
  }

  const findings: Finding[] = []
  for (const file of files) {
    const relative = path.relative(APP, file)
    const isNextEntry =
      relative.startsWith(`app${path.sep}`) && NEXT_ENTRY.test(path.basename(file))
    if (!isNextEntry && !ROOT_ENTRIES.includes(relative)) continue
    if (file.startsWith(PRODUCT) || !nextStep.has(file)) continue
    const chain = [relative]
    for (let step = nextStep.get(file); step; step = nextStep.get(step)) {
      chain.push(path.relative(APP, step))
    }
    findings.push({ rule: 'route-reach', detail: chain.join(' -> ') })
  }
  return findings
}

async function loadAppPostcssPlugins(): Promise<AcceptedPlugin[]> {
  const require = createRequire(path.join(APP, 'package.json'))
  const { default: config } = await import(path.join(APP, 'postcss.config.mjs'))
  return Object.entries(config.plugins as Record<string, object>).map(([name, options]) =>
    require(name)(options)
  )
}

if (import.meta.main) {
  const plugins = await loadAppPostcssPlugins()
  const compile = async (file: string) =>
    (await postcss(plugins).process(readFileSync(file, 'utf8'), { from: file })).css

  const modules = [PRODUCT, PLATFORM, SHARED, PLATFORM_COMPONENTS].flatMap((directory) =>
    walk(directory, CSS_MODULE)
  )
  const findings: Finding[] = []
  for (const file of modules) {
    findings.push(...findModuleEscapes(await compile(file), path.relative(APP, file)))
  }
  findings.push(...findRouteReach())

  if (findings.length > 0) {
    process.stderr.write(`check:platform-css found ${findings.length} escape(s):\n`)
    for (const finding of findings) process.stderr.write(`  [${finding.rule}] ${finding.detail}\n`)
    process.exit(1)
  }
  process.stdout.write(
    `check:platform-css ok: ${modules.length} CSS Modules hashed, only product routes reach the design system\n`
  )
}
