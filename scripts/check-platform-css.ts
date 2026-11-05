#!/usr/bin/env bun
/**
 * Proves the embedded design system cannot change a legacy page.
 *
 * Next keeps route CSS loaded after client navigation, so one global rule from a flagged page keeps
 * applying on every legacy page the viewer opens afterwards. Three rules hold that line:
 *
 * - `entry-escape`: `platform/design-system/styles/embedded.css`, compiled through the app's real
 *   PostCSS config, may only contain selectors under `[data-platform-ui]` and `@font-face` faces
 *   the host's global stylesheet never names. Any other at-rule fails: `@layer`, `@property`, and
 *   `@keyframes` are all global, and `@theme` or `@import` left over means the pipeline changed.
 * - `module-escape`: every rule in a `platform/**` CSS Module needs a local (hashed) class, and
 *   nothing may opt out through `:global`.
 * - `route-reach`: only routes under `app/o/[organizationId]/` may load the design system. No other
 *   Next entry (`/workspace`, the extension's embedded panel, landing, auth) may reach `platform/`
 *   through any import, static or dynamic. Dynamic counts because Next attaches a dynamically
 *   imported module's CSS to a Server Component's route whether or not it renders.
 *
 * Run: `bun run check:platform-css`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import postcss, { type AcceptedPlugin, type AtRule } from 'postcss'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP = path.join(ROOT, 'apps/sim')
const PLATFORM = path.join(APP, 'platform')
const ENTRY = path.join(PLATFORM, 'design-system/styles/embedded.css')
const HOST_GLOBALS = path.join(APP, 'app/_styles/globals.css')

const SCOPED = /^(?::where\(html\.dark\) )?(?:\[data-platform-ui\]|:where\(\[data-platform-ui\]\))/
const GLOBAL_TARGET = /(?:^|[\s>+~(,])(?::root|:host|html|body)(?![\w-])/
const ENTRY_AT_RULES = new Set(['media', 'container', 'supports', 'font-face'])
const MODULE_AT_RULES = new Set(['media', 'container', 'supports', 'keyframes'])
const ORGANIZATION_ROUTES = path.join('app', 'o', '[organizationId]') + path.sep
const NEXT_ENTRY =
  /^(?:page|layout|template|loading|error|global-error|not-found|default|route)\.[jt]sx?$/
const ROOT_ENTRIES = ['proxy.ts', 'instrumentation.ts', 'instrumentation-node.ts', 'bootstrap.ts']
const CODE_FILE = /\.[jt]sx?$/
const CSS_MODULE = /\.module\.css$/
const TEST_FILE = /\.(?:test|spec)\.[jt]sx?$|\.integration\.ts$/
const SKIPPED_FOLDERS = new Set(['node_modules', '.next', 'dist', 'public'])
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.cjs', '/index.ts', '/index.tsx']

export interface Finding {
  rule: 'entry-escape' | 'module-escape' | 'route-reach'
  detail: string
}

/** Checks compiled entry CSS. `hostGlobals` is the host stylesheet a new font face must not alter. */
export function findEntryEscapes(css: string, hostGlobals: string): Finding[] {
  const findings: Finding[] = []
  const root = postcss.parse(css)
  root.walkAtRules((atRule) => {
    if (!ENTRY_AT_RULES.has(atRule.name)) {
      findings.push({ rule: 'entry-escape', detail: `@${atRule.name} ${atRule.params}`.trim() })
      return
    }
    if (atRule.name !== 'font-face') return
    atRule.walkDecls('font-family', (declaration) => {
      const family = declaration.value.replace(/["']/g, '')
      if (hostGlobals.includes(family)) {
        findings.push({
          rule: 'entry-escape',
          detail: `@font-face "${family}" is named by the host's global stylesheet`,
        })
      }
    })
  })
  root.walkRules((rule) => {
    for (const selector of rule.selectors) {
      const unscoped = !SCOPED.test(selector)
      const targetsDocument = GLOBAL_TARGET.test(selector.replace(/^:where\(html\.dark\) /, ''))
      if (unscoped || targetsDocument) findings.push({ rule: 'entry-escape', detail: selector })
    }
  })
  return findings
}

export function findModuleEscapes(css: string, file: string): Finding[] {
  const findings: Finding[] = []
  const root = postcss.parse(css)
  root.walkAtRules((atRule) => {
    if (!MODULE_AT_RULES.has(atRule.name)) {
      findings.push({ rule: 'module-escape', detail: `${file}: @${atRule.name} ${atRule.params}` })
    }
  })
  root.walkRules((rule) => {
    const { parent } = rule
    if (parent?.type === 'rule' || (parent as AtRule | undefined)?.name === 'keyframes') return
    for (const selector of rule.selectors) {
      if (selector.includes(':global') || !/\.-?[_a-zA-Z]/.test(selector)) {
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
  const base = specifier.startsWith('@/')
    ? path.join(APP, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : null
  if (!base) return null
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate
  }
  return null
}

/** Walks importers back from `platform/`, so each module is visited once however the graph cycles. */
function findRouteReach(): Finding[] {
  const insidePlatform = (file: string) => file.startsWith(`${PLATFORM}${path.sep}`)
  const files = walk(APP, CODE_FILE).filter((file) => !insidePlatform(file))
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
    if (relative.startsWith(ORGANIZATION_ROUTES) || !nextStep.has(file)) continue
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

  const entryCss = await compile(ENTRY)
  const entryRoot = postcss.parse(entryCss)
  let selectorCount = 0
  entryRoot.walkRules((rule) => {
    selectorCount += rule.selectors.length
  })
  const findings = findEntryEscapes(entryCss, readFileSync(HOST_GLOBALS, 'utf8'))

  const modules = walk(PLATFORM, CSS_MODULE)
  for (const file of modules) {
    findings.push(...findModuleEscapes(await compile(file), path.relative(APP, file)))
  }
  findings.push(...findRouteReach())

  if (findings.length > 0) {
    console.error(`check:platform-css found ${findings.length} escape(s):`)
    for (const finding of findings) console.error(`  [${finding.rule}] ${finding.detail}`)
    process.exit(1)
  }
  console.log(
    `check:platform-css ok: ${selectorCount} entry selectors scoped, ${modules.length} CSS Modules ` +
      'hashed, only organization routes reach platform/'
  )
}
