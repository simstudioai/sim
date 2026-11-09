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
 *   imported module's CSS to a Server Component's route whether or not it renders. A stylesheet's
 *   `@import` and `composes … from` count too; so does a type-only import, which the scan does
 *   not tell apart.
 *
 * Run: `bun run check:platform-css`
 */
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import ts from '@typescript/typescript6'
import postcss, { type AcceptedPlugin, type AtRule } from 'postcss'
import { emcnPackages, resolveEmcnImport } from './emcn-packages'
import { PRODUCT_ROUTES } from './platform-product-routes'
import { listRepoFiles } from './repo-files'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP = path.join(ROOT, 'apps/sim')
const PLATFORM = path.join(APP, 'platform')
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
      // A class named inside an attribute value or string (`[href$=".pdf"]`) is not a local class.
      const bare = selector.replace(/\[[^\]]*\]|"[^"]*"|'[^']*'/g, '')
      if (selector.includes(':global') || (!inheritsLocalScope && !/\.-?[_a-zA-Z]/.test(bare))) {
        findings.push({ rule: 'module-escape', detail: `${file}: ${selector}` })
      }
    }
  })
  return findings
}

function resolveSpecifier(
  specifier: string,
  from: string,
  app: string,
  packages: ReturnType<typeof emcnPackages>
): string | null {
  const workspace = resolveEmcnImport(packages, specifier, from)
  const base =
    workspace ??
    (specifier.startsWith('@/')
      ? path.join(app, specifier.slice(2))
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

/** A stylesheet's own edges: `@import` and `composes … from`, which load the named sheet too. */
function cssImports(css: string): string[] {
  const found: string[] = []
  const sheet = postcss.parse(css)
  sheet.walkAtRules('import', (rule) => {
    const specifier = rule.params.match(/['"]([^'"]+)['"]/)?.[1]
    if (specifier) found.push(specifier)
  })
  sheet.walkDecls('composes', (decl) => {
    const specifier = decl.value.match(/\bfrom\s+['"]([^'"]+)['"]/)?.[1]
    if (specifier) found.push(specifier)
  })
  return found
}

/**
 * Walks importers back from `platform/`, so each module is visited once however the graph cycles.
 * Code and CSS files count: a site stylesheet composing a design-system class loads its sheet.
 */
export function findRouteReach(root = ROOT): Finding[] {
  const app = path.join(root, 'apps/sim')
  const packages = emcnPackages(root)
  const product = path.join(app, PRODUCT_ROUTES)
  const insidePlatform = (file: string) =>
    [path.join(app, 'platform'), path.join(root, 'packages/emcn-platform/src')].some((directory) =>
      file.startsWith(`${directory}${path.sep}`)
    )
  const sources = packages.map((owner) => `${owner.source}${path.sep}`)
  const files = listRepoFiles(root)
    .map((file) => path.join(root, file))
    .filter(
      (file) =>
        (file.startsWith(`${app}${path.sep}`) ||
          sources.some((source) => file.startsWith(source))) &&
        (CODE_FILE.test(file) || file.endsWith('.css')) &&
        !TEST_FILE.test(file) &&
        !file.split(path.sep).some((segment) => SKIPPED_FOLDERS.has(segment)) &&
        !insidePlatform(file)
    )
  const importers = new Map<string, string[]>()
  const queue: string[] = []
  /** Maps a module that reaches `platform/` to its next step on the way there. */
  const nextStep = new Map<string, string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const specifiers = file.endsWith('.css')
      ? cssImports(source)
      : ts.preProcessFile(source, true, true).importedFiles.map((entry) => entry.fileName)
    for (const specifier of specifiers) {
      const target = resolveSpecifier(
        file.endsWith('.css') && !specifier.startsWith('@') && !specifier.startsWith('.')
          ? `./${specifier}`
          : specifier,
        file,
        app,
        packages
      )
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
    const relative = path.relative(app, file)
    const isNextEntry =
      relative.startsWith(`app${path.sep}`) && NEXT_ENTRY.test(path.basename(file))
    if (!isNextEntry && !ROOT_ENTRIES.includes(relative)) continue
    if (file.startsWith(product) || !nextStep.has(file)) continue
    const chain = [relative]
    for (let step = nextStep.get(file); step; step = nextStep.get(step)) {
      chain.push(path.relative(app, step))
    }
    findings.push({ rule: 'route-reach', detail: chain.join(' -> ') })
  }
  return findings
}

async function loadAppPostcssPlugins(): Promise<AcceptedPlugin[]> {
  const require = createRequire(path.join(APP, 'package.json'))
  const { default: config } = await import(path.join(APP, 'postcss.config.mjs'))
  // As Next loads them: a plugin with no options is used as exported, an object or a creator.
  return Object.entries(config.plugins as Record<string, object>).map(([name, options]) => {
    const plugin = require(name)
    return Object.keys(options).length === 0 ? plugin : plugin(options)
  })
}

if (import.meta.main) {
  const plugins = await loadAppPostcssPlugins()
  const compile = async (file: string) =>
    (await postcss(plugins).process(readFileSync(file, 'utf8'), { from: file })).css

  const owners = [PRODUCT, PLATFORM, SHARED, PLATFORM_COMPONENTS]
  const modules = listRepoFiles(ROOT)
    .map((file) => path.join(ROOT, file))
    .filter(
      (file) =>
        CSS_MODULE.test(file) && owners.some((owner) => file.startsWith(path.join(owner, path.sep)))
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
