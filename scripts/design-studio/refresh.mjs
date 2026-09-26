#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
/** Regenerate the local Design Studio inventory and visual evidence from product source. */
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolRoot = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(process.env.SIM_STUDIO_REPO ?? path.join(toolRoot, '../..'))
const { parse } = createRequire(import.meta.url)('@babel/parser')
const ledger = process.env.SIM_STUDIO_LEDGER ? path.resolve(process.env.SIM_STUDIO_LEDGER) : null
const outputRoot = path.resolve(
  process.env.SIM_STUDIO_OUTPUT ?? path.join(homedir(), '.local/state/sim2/design-studio')
)
const bun = process.execPath
const bunDirectory = path.dirname(bun)
const capture = !process.argv.includes('--inventory-only')
// Keep rounded-edge rasterization stable across fresh browser processes.
const captureArgs = [
  '--deterministic-mode',
  '--disable-gpu',
  '--disable-skia-runtime-opts',
  '--disable-partial-raster',
]
const sha = (value) => createHash('sha256').update(value).digest('hex')
const relative = (file) => path.relative(repo, file).split(path.sep).join('/')

function parseFile(file) {
  return parse(readFileSync(file, 'utf8'), {
    sourceType: 'module',
    sourceFilename: file,
    plugins: ['typescript', 'jsx', 'decorators-legacy'],
  })
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string') visit(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const item of value) walk(item, visit)
    else if (value && typeof value === 'object') walk(value, visit)
  }
}

function keyName(node) {
  if (!node) return ''
  if (node.type === 'Identifier') return node.name
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') return String(node.value)
  return ''
}

function productFiles() {
  const roots = ['apps/sim', 'apps/desktop/src/renderer', 'packages/workflow-renderer/src']
  const excluded = new Set([
    'node_modules',
    '.next',
    '.git',
    'dist',
    'build',
    '__tests__',
    '(landing)',
    '(docs)',
    'api',
    'design-studio',
    'docs',
  ])
  const files = []
  function descend(directory) {
    if (!existsSync(directory)) return
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (item.isDirectory()) {
        if (!excluded.has(item.name)) descend(path.join(directory, item.name))
      } else if (item.name.endsWith('.tsx') && !/\.(test|spec|stories)\.tsx$/.test(item.name)) {
        files.push(path.join(directory, item.name))
      }
    }
  }
  roots.forEach((root) => descend(path.join(repo, root)))
  return files.sort()
}

function jsxName(node) {
  if (node.type === 'JSXIdentifier') return node.name
  if (node.type === 'JSXMemberExpression')
    return `${jsxName(node.object)}.${jsxName(node.property)}`
  return ''
}

function usageIndex(componentNames, iconNames) {
  const uses = new Map()
  const failures = []
  for (const file of productFiles()) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes('@sim/emcn')) continue
    try {
      const ast = parseFile(file)
      const imported = new Map()
      const namespaces = new Map()
      for (const statement of ast.program.body) {
        if (statement.type !== 'ImportDeclaration') continue
        const from = statement.source.value
        if (
          from !== '@sim/emcn' &&
          from !== '@sim/emcn/icons' &&
          !from.startsWith('@sim/emcn/components/')
        )
          continue
        for (const specifier of statement.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type') {
            const name = keyName(specifier.imported)
            const kind =
              from === '@sim/emcn/icons'
                ? 'icon'
                : componentNames.has(name) ||
                    [...componentNames].some((n) => n.startsWith(`${name}.`))
                  ? 'component'
                  : iconNames.has(name)
                    ? 'icon'
                    : null
            if (kind) imported.set(specifier.local.name, { name, kind })
          }
          if (specifier.type === 'ImportNamespaceSpecifier')
            namespaces.set(specifier.local.name, from)
        }
      }
      walk(ast, (node) => {
        if (node.type !== 'JSXOpeningElement') return
        const tag = jsxName(node.name)
        const parts = tag.split('.')
        const from = namespaces.get(parts[0])
        let record = from
          ? {
              name: parts.slice(1).join('.'),
              kind:
                from === '@sim/emcn/icons'
                  ? 'icon'
                  : componentNames.has(parts.slice(1).join('.'))
                    ? 'component'
                    : 'icon',
            }
          : imported.get(parts[0])
        if (!record) return
        if (!from && parts.length > 1)
          record = { ...record, name: `${record.name}.${parts.slice(1).join('.')}` }
        const key = `${record.kind}:${record.name}`
        if (!(record.kind === 'component' ? componentNames : iconNames).has(record.name)) return
        const site = {
          file: relative(file),
          line: node.loc?.start.line ?? 1,
          symbol: record.name,
          relationship: 'direct',
        }
        const list = uses.get(key) ?? []
        if (!list.some((entry) => entry.file === site.file && entry.line === site.line))
          list.push(site)
        uses.set(key, list)
      })
    } catch (error) {
      failures.push({ file: relative(file), reason: String(error) })
    }
  }
  return { uses, failures }
}

function fixtureInventory() {
  const gallery = path.join(repo, 'tools/design-studio/_components/component-fixtures.tsx')
  const ast = parseFile(gallery)
  const cases = new Map()
  walk(ast, (node) => {
    if (node.type !== 'SwitchCase' || node.test?.type !== 'StringLiteral') return
    const names = new Set()
    const variantNames = new Set()
    for (const statement of node.consequent)
      walk(statement, (part) => {
        if (part.type !== 'JSXOpeningElement') return
        const name = jsxName(part.name)
        names.add(name)
        for (const attribute of part.attributes)
          walk(attribute, (value) => {
            if (value.type === 'Identifier' && ['variantProps', 'variant'].includes(value.name))
              variantNames.add(name)
          })
      })
    cases.set(node.test.value, { names, variantNames })
  })
  return cases
}

function componentFamily(source) {
  if (source.includes('/charts/')) return path.basename(source, path.extname(source))
  return path.relative(path.join(repo, 'packages/emcn/src/components'), source).split(path.sep)[0]
}

function componentInventory() {
  const metadata = JSON.parse(
    readFileSync(path.join(repo, 'scripts/design-conformance/contracts.generated.json'), 'utf8')
  )
  const discovered = Object.entries(metadata.exports).map(([, facts]) => ({
    name: facts.exportName,
    source: path.join(repo, facts.source.file),
    facts,
  }))
  const componentExports = discovered.filter((item) => item.facts.kind === 'component')
  const iconExports = discovered.filter((item) => item.facts.kind === 'icon')
  const byName = new Map()
  for (const item of componentExports)
    if (!byName.has(`component:${item.name}`))
      byName.set(`component:${item.name}`, { ...item, kind: 'component' })
  for (const item of iconExports)
    if (!byName.has(`icon:${item.name}`)) byName.set(`icon:${item.name}`, { ...item, kind: 'icon' })
  const { uses, failures } = usageIndex(
    new Set(componentExports.map((item) => item.name)),
    new Set(iconExports.map((item) => item.name))
  )
  const fixtureCases = fixtureInventory()
  const entries = []
  const focusable = new Set(['Button', 'Input', 'Checkbox', 'Chip', 'ChipInput', 'Textarea'])
  const openable = new Set([
    'DropdownMenu',
    'Popover',
    'Modal',
    'ChipModal',
    'ChipConfirmModal',
    'Tooltip',
    'Lightbox',
    'Wizard',
    'ChipDropdown',
    'ChipDatePicker',
    'ChipSelect',
    'Combobox',
    'TimePicker',
    'ChipTimePicker',
    'ChipCombobox',
  ])
  const nonvisualNames = new Map(
    discovered
      .filter((item) => item.facts.kind === 'nonvisual')
      .map((item) => [
        item.name,
        'Structural or delegated export; its visible descendants own the treatment.',
      ])
  )
  const nonvisual = discovered
    .filter((item) => item.facts.kind === 'nonvisual')
    .map((item) => ({
      name: item.name,
      source: item.facts.source,
      reason: nonvisualNames.get(item.name),
    }))
  for (const item of byName.values()) {
    const family = item.kind === 'icon' ? 'Icons' : componentFamily(item.source)
    const ownCase = item.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    const fixtureId = fixtureCases.get(ownCase)?.names.has(item.name)
      ? ownCase
      : fixtureCases.get(family)?.names.has(item.name) ||
          (nonvisualNames.has(item.name) && fixtureCases.has(family))
        ? family
        : null
    const fixture =
      item.kind === 'icon'
        ? { type: 'icon', id: item.name }
        : fixtureId
          ? { type: 'component', id: fixtureId }
          : null
    if (fixture && item.name === 'DropdownMenuSubContent') fixture.action = 'open-submenu'
    if (fixture && item.name === 'PopoverBackButton') fixture.action = 'open-folder'
    const base = {
      id: `${item.kind}:${item.name}`,
      kind: item.kind,
      name: item.name,
      family,
      source: { file: item.facts.source.file, line: item.facts.source.line },
      rationale: nonvisualNames.get(item.name),
      usages: uses.get(`${item.kind}:${item.name}`) ?? [],
      fixture,
      states:
        item.kind === 'component' && focusable.has(item.name)
          ? item.name === 'Input'
            ? ['focus', 'disabled', 'error']
            : ['focus', 'disabled']
          : item.kind === 'component' && openable.has(item.name)
            ? ['open']
            : [],
      status: fixture ? 'pending-capture' : 'needs-fixture',
      images: {},
    }
    entries.push(base)
    if (item.kind !== 'component') continue
    const seenVariants = new Set()
    const axes = Object.entries(item.facts.variants).map(([name, axis]) => ({
      name,
      values: axis.values.map(String),
      defaultValue: axis.default === undefined ? undefined : String(axis.default),
    }))
    const supportsVariants = Boolean(
      fixture && fixtureCases.get(fixture.id)?.variantNames.has(item.name)
    )
    for (const axis of axes)
      for (const value of axis.values) {
        if (value === axis.defaultValue) continue
        const identity = `${axis.name}=${value}`
        if (seenVariants.has(identity)) continue
        seenVariants.add(identity)
        entries.push({
          ...base,
          id: `component:${item.name}:${axis.name}=${value}`,
          name: `${item.name} · ${axis.name}: ${value}`,
          variant: { axis: axis.name, value, defaultValue: axis.defaultValue },
          fixture: supportsVariants ? { ...fixture, variant: { axis: axis.name, value } } : null,
          status: supportsVariants ? 'pending-capture' : 'needs-fixture',
          images: {},
        })
      }
  }
  return { entries, nonvisual, failures }
}

/** The scanner already resolves product wrappers to EMCN terminal renderers. */
function attachTracedUses(entries, scanDir) {
  const controls = JSON.parse(readFileSync(path.join(scanDir, 'controls.json'), 'utf8'))
  const bySymbol = new Map(
    entries
      .filter((entry) => !entry.variant && entry.kind === 'component')
      .map((entry) => [entry.name, entry])
  )
  for (const record of controls.records ?? []) {
    if (record.origin !== 'emcn-component' || !record.projection) continue
    for (const terminal of record.terminals ?? []) {
      const symbol = /#([A-Za-z][\w]*)@/.exec(terminal)?.[1]
      const entry = bySymbol.get(symbol)
      if (
        !entry ||
        !record.file?.startsWith('apps/') ||
        record.file.includes('/(landing)/') ||
        record.file.includes('/design-studio/')
      )
        continue
      const site = {
        file: record.file,
        line: record.line,
        symbol: record.tag,
        relationship: record.tag === symbol ? 'direct' : `via ${record.tag}`,
      }
      if (!entry.usages.some((use) => use.file === site.file && use.line === site.line))
        entry.usages.push(site)
    }
  }
  for (const entry of entries)
    if (entry.variant) entry.usages = bySymbol.get(entry.id.split(':')[1])?.usages ?? entry.usages
}

const sourceContextCache = new Map()

/** Find the JSX element behind a scanner line without executing product code. */
function sourceContext(file, line) {
  const key = `${file}:${line}`
  if (sourceContextCache.has(key)) return sourceContextCache.get(key)
  const result = { tag: '', className: '' }
  if (!/\.[jt]sx$/.test(file)) return result
  try {
    let best
    walk(parseFile(path.join(repo, file)), (node) => {
      if (
        node.type !== 'JSXOpeningElement' ||
        !node.loc ||
        node.loc.start.line > line ||
        node.loc.end.line < line
      )
        return
      const span = node.loc.end.line - node.loc.start.line
      if (!best || span < best.span) best = { node, span }
    })
    if (best) {
      result.tag = jsxName(best.node.name)
      const attribute = best.node.attributes.find(
        (item) => item.type === 'JSXAttribute' && ['className', 'class'].includes(item.name?.name)
      )
      const pieces = []
      if (attribute?.value)
        walk(attribute.value, (node) => {
          if (node.type === 'StringLiteral' && node.value) pieces.push(node.value)
          if (node.type === 'TemplateElement' && node.value.raw) pieces.push(node.value.raw)
        })
      result.className = [...new Set(pieces.join(' ').split(/\s+/).filter(Boolean))]
        .join(' ')
        .slice(0, 1200)
    }
  } catch {
    // The scanner still publishes the finding; the generic value renderer handles this source.
  }
  sourceContextCache.set(key, result)
  return result
}

function colorValues(value) {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed.values))
      return parsed.values.filter((item) => typeof item === 'string').slice(0, 12)
  } catch {}
  return /^(?:#[\da-f]{3,8}|(?:rgb|hsl|oklch|var)\()/i.test(value) ? [value] : []
}

const classFamilies = new Set([
  'component-chrome',
  'emcn-recipe-override',
  'central-radius',
  'central-typography',
  'local-typography',
  'local-alpha',
  'repeated-treatment',
  'stock-shadow',
])

/** One reproducible specimen per authored element, shared by its individual scanner signals. */
function sampleFixture(items) {
  const first = items[0]
  const context = sourceContext(first.file, first.line)
  const classes = items.flatMap((item) => {
    if (!classFamilies.has(item.rule ?? item.kind)) return []
    const value = String(item.value ?? '').replace(/^[a-z]+:\s+(?=[a-z-]+(?:-|\[))/, '')
    return value.length < 500 && !/[<>\n{}]/.test(value) ? value.split(/\s+/) : []
  })
  const className = [
    ...new Set([context.className, ...classes].join(' ').split(/\s+/).filter(Boolean)),
  ]
    .join(' ')
    .slice(0, 1200)
  const values = items.flatMap((item) => colorValues(item.value)).slice(0, 12)
  const families = items.map((item) => item.rule ?? item.kind)
  const kind =
    values.length &&
    (families.includes('central-colour') || families.includes('central-colour-assignment'))
      ? 'swatch'
      : families.some((item) => item.includes('typography'))
        ? 'text'
        : families.some((item) => item.includes('runtime-style'))
          ? 'runtime'
          : ['button', 'input', 'textarea', 'select'].includes(context.tag.toLowerCase()) ||
              families.includes('local-control') ||
              families.includes('component-chrome')
            ? 'control'
            : 'surface'
  return {
    type: 'sample',
    id: sha(
      JSON.stringify([first.file, first.line, first.context ?? first.owner ?? '', kind])
    ).slice(0, 16),
    sample: {
      kind,
      tag:
        context.tag ||
        (first.context?.match(/#([A-Z][A-Za-z]+)/)?.[1] ?? String(first.value ?? '')),
      className,
      values,
      property: first.property ?? '',
      value: String(first.value ?? '').slice(0, 300),
    },
  }
}

function extraInventory(scanDir) {
  const findings = JSON.parse(readFileSync(path.join(scanDir, 'findings.json'), 'utf8'))
  const decisionsPath = path.join(scanDir, 'review-decisions.json')
  const decisions = existsSync(decisionsPath)
    ? JSON.parse(readFileSync(decisionsPath, 'utf8'))
    : { matches: [], stale: [], ambiguous: [] }
  const ledgerEntries = new Map(
    ledger
      ? JSON.parse(readFileSync(ledger, 'utf8')).entries.map((item) => [item.fingerprint, item])
      : []
  )
  const decisionDetails = {
    stale: decisions.stale.map((fingerprint) => ledgerEntries.get(fingerprint) ?? { fingerprint }),
    ambiguous: decisions.ambiguous.map(
      (fingerprint) => ledgerEntries.get(fingerprint) ?? { fingerprint }
    ),
  }
  const matched = new Map(decisions.matches.map((item) => [item.fingerprint, item]))
  const entries = []
  const centralSignals = []
  const sourceGroups = new Map()
  for (const item of findings) {
    const key = JSON.stringify([item.file, item.line, item.context ?? item.owner ?? ''])
    const group = sourceGroups.get(key) ?? []
    group.push(item)
    sourceGroups.set(key, group)
  }
  function sourceFixture(item) {
    const { file, owner, context } = item
    if (item.rule === 'local-shadow')
      return item.value === 'browser-loading-glow' ? 'browser-loading' : 'rich-selection'
    if (item.rule === 'specialised-typography')
      return file.endsWith('/thinking-loader.module.css') ? 'thinking' : 'rich-type'
    if (file.endsWith('/knowledge-iso.tsx')) return 'knowledge'
    if (file.endsWith('/thinking-loader.tsx') || file.endsWith('/thinking-loader.module.css'))
      return 'thinking'
    if (file.endsWith('/drop-overlay.tsx')) return 'drop-overlay'
    if (file.endsWith('/components/error/error.tsx')) return 'error'
    if (file.endsWith('/command-chrome/command-chrome.tsx')) return 'command-search'
    if (file.endsWith('/rich-markdown-editor/rich-markdown-editor.css')) {
      if (context?.includes('.rich-markdown-prose code')) return 'rich-code'
      if (context?.includes('hr.rich-leaf-in-selection')) return 'rich-selection'
      return null
    }
    if (file.endsWith('/integrations-showcase.tsx')) {
      const component = owner ?? context?.split(/\s*\/\s*/)[0]
      return (
        { IntegrationTile: 'integration-tile', IntegrationsShowcase: 'showcase' }[component] ?? null
      )
    }
    if (file.endsWith('/components/icons.tsx'))
      return (
        {
          SearchIcon: 'searchIcon',
          AgentIcon: 'agentIcon',
          ApiIcon: 'apiIcon',
          WorkflowIcon: 'workflowIcon',
        }[owner] ?? null
      )
    return null
  }
  for (const item of findings) {
    const kind = 'finding'
    const fingerprint =
      item.identity ??
      sha(
        JSON.stringify(['finding', item.file, item.context, item.rule, item.property, item.value])
      )
    const decision =
      matched.get(fingerprint) ??
      (item.legacyFingerprint ? matched.get(item.legacyFingerprint) : undefined)
    const fixtureId = sourceFixture(item)
    const sourceGroup = sourceGroups.get(
      JSON.stringify([item.file, item.line, item.context ?? item.owner ?? ''])
    ) ?? [item]
    const fixture = fixtureId ? { type: 'extra', id: fixtureId } : sampleFixture(sourceGroup)
    const entry = {
      id: `${kind}:${item.id}`,
      kind: 'extra',
      name: item.context ?? item.owner ?? item.rule ?? item.kind,
      value: item.value,
      family: item.rule ?? item.kind,
      source: { file: item.file, line: item.line },
      usages: [{ file: item.file, line: item.line, relationship: 'authored' }],
      rationale: decision?.rationale ?? item.reason ?? '',
      decision: decision?.status ?? 'unreviewed',
      fixture,
      previewKind: fixtureId
        ? 'source-component'
        : fixture.sample.className || fixture.sample.values.length || fixture.sample.property
          ? 'source-style-sample'
          : 'indicative-sample',
      status: 'pending-capture',
      images: {},
    }
    if (item.file.startsWith('packages/emcn/')) centralSignals.push(entry)
    entries.push(entry)
  }
  return { entries, centralSignals, decisions: decisionDetails }
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('error', (error) => resolve({ code: 2, error }))
    child.on('exit', (code) => resolve({ code: code ?? 2 }))
  })
}

function git(args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function sourceRevision() {
  const changed = spawnSync('git', ['diff', '--binary', 'HEAD'], {
    cwd: repo,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (changed.status !== 0) throw new Error(String(changed.stderr))
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .sort()
  const digest = createHash('sha256')
    .update(git(['rev-parse', 'HEAD']))
    .update(changed.stdout)
  for (const file of untracked) digest.update(file).update(readFileSync(path.join(repo, file)))
  return digest.digest('hex')
}

async function captureImages(manifest, runDir) {
  const require = createRequire(path.join(repo, 'package.json'))
  const { chromium } = require('playwright')
  const port = await new Promise((resolve, reject) => {
    const socket = createServer()
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address()
      socket.close(() => resolve(address.port))
    })
  })
  const appDirectory = path.join(repo, 'tools/design-studio')
  const server = spawn(
    path.join(repo, 'node_modules/.bin/next'),
    ['dev', appDirectory, '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: appDirectory,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        SIM_STUDIO_REPO: repo,
        DATABASE_URL:
          process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/simstudio',
        NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
      },
      stdio: 'ignore',
    }
  )
  let browser
  try {
    let ready = false
    for (let attempt = 0; attempt < 90; attempt++) {
      if (server.exitCode !== null) break
      try {
        const response = await fetch(`http://localhost:${port}/fixture?kind=icon&id=Check`)
        if (response.ok) {
          ready = true
          break
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (!ready) throw new Error('Fixture server did not become ready')
    browser = await chromium.launch({ headless: true, args: captureArgs })
    manifest.browser = `Chromium ${browser.version()} (Playwright ${require('playwright/package.json').version}; ${captureArgs.join(' ')})`
    const context = await browser.newContext({
      viewport: { width: 460, height: 320 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    await page.clock.install({ time: new Date('2026-09-23T12:00:00Z') })
    const imageDir = path.join(runDir, 'images')
    mkdirSync(imageDir, { recursive: true })
    const imageCache = new Map()
    const previousPointer = path.join(outputRoot, 'latest.json')
    let previousImages = new Map()
    let reuseSourceCaptures = false
    let reuseSampleCaptures = false
    if (existsSync(previousPointer)) {
      try {
        const previousRun = JSON.parse(readFileSync(previousPointer, 'utf8'))
        const previousManifest = JSON.parse(
          readFileSync(path.join(previousRun.path, 'manifest.json'), 'utf8')
        )
        if (previousManifest.browser === manifest.browser) {
          reuseSourceCaptures =
            previousManifest.sourceRevision === manifest.sourceRevision &&
            previousManifest.fixtureHash === manifest.fixtureHash
          reuseSampleCaptures = Boolean(
            previousManifest.sampleRenderHash &&
              previousManifest.sampleRenderHash === manifest.sampleRenderHash
          )
          previousImages = new Map(
            [...previousManifest.components, ...previousManifest.extras]
              .filter((entry) => entry.status === 'ready' && entry.fixture)
              .map((entry) => [
                JSON.stringify([entry.fixture, entry.states]),
                { entry, directory: path.join(previousRun.path, 'images') },
              ])
          )
        }
      } catch {
        // A prior run is an optimization only; capture normally if it cannot be read.
      }
    }
    const captureLimit = Number(process.env.SIM_STUDIO_CAPTURE_LIMIT ?? 0)
    const entries =
      process.env.SIM_STUDIO_CAPTURE_KIND === 'extras'
        ? manifest.extras
        : process.env.SIM_STUDIO_CAPTURE_KIND === 'components'
          ? manifest.components
          : [...manifest.components, ...manifest.extras]
    const selectedIds = process.env.SIM_STUDIO_CAPTURE_ENTRY?.split(',')
    const selected = selectedIds
      ? entries.filter((entry) => selectedIds.includes(entry.id))
      : entries
    for (const entry of captureLimit > 0 ? selected.slice(0, captureLimit) : selected) {
      if (!entry.fixture) continue
      const cacheKey = JSON.stringify([entry.fixture, entry.states])
      const cached = imageCache.get(cacheKey)
      if (cached) {
        entry.images = cached.images
        entry.status = cached.status
        if (cached.captureError) entry.captureError = cached.captureError
        continue
      }
      const previous = previousImages.get(cacheKey)
      if (
        previous &&
        (reuseSourceCaptures || (entry.fixture.type === 'sample' && reuseSampleCaptures)) &&
        Object.values(previous.entry.images).every((name) =>
          existsSync(path.join(previous.directory, name))
        )
      ) {
        entry.images = previous.entry.images
        entry.status = 'ready'
        for (const name of Object.values(entry.images))
          cpSync(path.join(previous.directory, name), path.join(imageDir, name))
        imageCache.set(cacheKey, { images: entry.images, status: entry.status })
        continue
      }
      let failed = false
      const params = new URLSearchParams({
        kind: entry.fixture.type,
        id: entry.fixture.id,
        theme: 'dark',
        size: '16',
      })
      if (entry.fixture.sample) params.set('sample', JSON.stringify(entry.fixture.sample))
      if (entry.fixture.variant) {
        params.set('axis', entry.fixture.variant.axis)
        params.set('value', entry.fixture.variant.value)
      }
      try {
        if (process.env.SIM_STUDIO_TEST_CAPTURE_FAILURE === entry.id)
          throw new Error('Injected fixture failure for capture regression')
        for (const state of ['default', ...(entry.states ?? [])]) {
          params.set('state', state)
          const response = await page.goto(`http://localhost:${port}/fixture?${params}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          })
          if (!response?.ok()) throw new Error(`HTTP ${response?.status()}`)
          const target = page.locator('[data-studio-fixture]')
          await target.waitFor({ timeout: 10000 })
          if (await target.locator('[data-studio-unavailable]').count())
            throw new Error('Fixture returned unavailable placeholder')
          if (
            (await target.locator('*').count()) === 0 &&
            (await page.locator('[role=dialog], [role=menu], [role=tooltip]').count()) === 0
          )
            throw new Error('Fixture mounted no visible source element')
          await page.evaluate(() => document.fonts.ready)
          if (entry.fixture.action === 'open-folder')
            await page.getByText('Examples', { exact: true }).first().click()
          if (entry.fixture.action === 'open-submenu')
            await page.getByText('More choices', { exact: true }).first().hover()
          if (state === 'open' && entry.name === 'Tooltip') {
            await target.getByRole('button').first().hover()
            await page.getByRole('tooltip').waitFor({ state: 'visible', timeout: 10000 })
          }
          if (
            state === 'open' &&
            [
              'Lightbox',
              'ChipDropdown',
              'ChipDatePicker',
              'ChipSelect',
              'Combobox',
              'TimePicker',
              'ChipTimePicker',
              'ChipCombobox',
            ].includes(entry.name)
          ) {
            const trigger = target
              .locator('[role="combobox"], [role="button"], button, input')
              .first()
            if ((await trigger.count()) === 0)
              throw new Error('Open-state fixture has no interactive trigger')
            await trigger.click()
          }
          if (state === 'focus')
            await page.locator('button:not([disabled]), input:not([disabled])').first().focus()
          if (
            state === 'disabled' &&
            (await target.locator('[disabled], [aria-disabled="true"]').count()) === 0
          )
            throw new Error('Disabled state fixture did not disable a control')
          if (state === 'error' && (await target.locator('[aria-invalid=true]').count()) === 0)
            throw new Error('Error state fixture did not mark an invalid control')
          if (
            entry.fixture.action !== 'open-submenu' &&
            !(state === 'open' && entry.name === 'Tooltip')
          )
            await page.mouse.move(0, 0)
          for (const theme of ['light', 'dark'])
            for (const size of [16, 20]) {
              const key = state === 'default' ? `${theme}-${size}` : `${theme}-${size}-${state}`
              await page.evaluate(
                ({ theme, size }) => {
                  document.documentElement.classList.toggle('dark', theme === 'dark')
                  document.documentElement.style.fontSize = `${size}px`
                  const fixtureTheme = document.querySelector('[data-studio-theme]')
                  fixtureTheme?.classList.toggle('dark', theme === 'dark')
                  fixtureTheme?.classList.toggle('light', theme === 'light')
                },
                { theme, size }
              )
              await page.evaluate(() => document.fonts.ready)
              await page.evaluate(
                () =>
                  new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                  )
              )
              if (entry.fixture.action === 'open-submenu')
                await page.getByText('More choices', { exact: true }).first().hover()
              if (entry.name === 'TagInput' && state === 'default')
                await page.evaluate(() => {
                  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                })
              if (
                entry.name === 'TagInput' ||
                ['bar-chart', 'line-chart', 'radar-chart'].includes(entry.fixture.id) ||
                (await page
                  .locator(
                    '[data-radix-popper-content-wrapper], [role="listbox"], [role="menu"], [role="dialog"]'
                  )
                  .count())
              )
                await page.waitForTimeout(150)
              const name = `${sha(`${cacheKey}:${key}`).slice(0, 24)}.png`
              await page.screenshot({ path: path.join(imageDir, name), animations: 'disabled' })
              entry.images[key] = name
            }
        }
      } catch (error) {
        failed = true
        entry.captureError = String(error)
      }
      entry.status = failed ? 'capture-failed' : 'ready'
      imageCache.set(cacheKey, {
        images: entry.images,
        status: entry.status,
        captureError: entry.captureError,
      })
    }
    await context.close()
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
  }
}

function fingerprintComponentPreviews(entries, runDir) {
  const imageDir = path.join(runDir, 'images')
  const keys = ['light-16', 'light-20', 'dark-16', 'dark-20']
  for (const entry of entries) {
    if (entry.status !== 'ready' || !keys.every((key) => entry.images[key])) continue
    const digest = createHash('sha256')
    for (const key of keys) {
      digest.update(key)
      digest.update(readFileSync(path.join(imageDir, entry.images[key])))
    }
    entry.previewFingerprint = digest.digest('hex')
  }
}

async function main() {
  if (!existsSync(repo) || (!process.versions.bun && !process.env.SIM_STUDIO_SCAN_DIR))
    throw new Error('Run refresh with Bun from the product checkout')
  const relativeOutput = path.relative(repo, outputRoot)
  if (!relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput))
    throw new Error('Studio output must be outside the product checkout')
  const generation = spawnSync(
    process.versions.bun ? bun : (process.env.DESIGN_TEST_BUN ?? 'bun'),
    [
      '--no-env-file',
      path.join(toolRoot, '../generate-design-contracts.ts'),
      '--repo',
      repo,
      '--check',
    ],
    { cwd: repo, encoding: 'utf8' }
  )
  if (generation.status !== 0)
    throw new Error(
      generation.stderr ||
        'Design infrastructure freshness check failed; run bun run design:generate'
    )
  const initialLedgerHash = ledger ? sha(readFileSync(ledger)) : ''
  mkdirSync(outputRoot, { recursive: true })
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${git(['rev-parse', '--short=10', 'HEAD'])}`
  const runDir = path.join(outputRoot, `run-${runId}`)
  const scanDir = path.join(runDir, 'scan')
  mkdirSync(runDir, { recursive: true })
  if (process.env.SIM_STUDIO_SCAN_DIR) {
    cpSync(path.resolve(process.env.SIM_STUDIO_SCAN_DIR), scanDir, { recursive: true })
  } else {
    const scan = await run(
      bun,
      [
        '--no-env-file',
        'scripts/design-scan/scan.ts',
        '--repo',
        repo,
        '--working-tree',
        ...(ledger ? ['--reviews', ledger] : []),
        '--output',
        scanDir,
      ],
      {
        cwd: repo,
        env: { ...process.env, PATH: `${bunDirectory}:${process.env.PATH}` },
      }
    )
    if (scan.code > 1) throw new Error(`Scanner failed with exit ${scan.code}`)
  }
  const identity = JSON.parse(readFileSync(path.join(scanDir, 'identity.json'), 'utf8'))
  const components = componentInventory()
  attachTracedUses(components.entries, scanDir)
  const extras = extraInventory(scanDir)
  for (const signal of extras.centralSignals) {
    const owners = components.entries.filter(
      (entry) => !entry.variant && entry.source.file === signal.source.file
    )
    if (owners.length)
      for (const owner of owners)
        (owner.signals ??= []).push({
          id: signal.id,
          kind: signal.family,
          source: signal.source,
          value: signal.value,
        })
  }
  const scannerFailures = JSON.parse(
    readFileSync(path.join(scanDir, 'coverage-failures.json'), 'utf8')
  )
  const fixtureSources = [
    'tools/design-studio/_components/component-fixtures.tsx',
    'tools/design-studio/_components/studio-fixture.tsx',
    'tools/design-studio/app/fixture/page.tsx',
    'tools/design-studio/app/studio.css',
    'tools/design-studio/app/layout.tsx',
  ]
  const fixtureHash = sha(
    fixtureSources.map((file) => `${file}:${sha(readFileSync(path.join(repo, file)))}`).join('\n')
  )
  const sampleStyleSources = [
    'packages/emcn/src/lib/cn.ts',
    'apps/sim/app/_styles/globals.css',
    'apps/sim/app/_styles/fonts/season/season.ts',
    'apps/sim/app/_styles/fonts/season/SeasonSansUprightsVF.woff2',
    'apps/sim/app/layout.tsx',
    'apps/sim/postcss.config.mjs',
    'apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css',
    'bun.lock',
  ]
  const sampleRenderHash = sha(
    [
      fixtureHash,
      ...sampleStyleSources.map((file) => {
        const fullPath = path.join(repo, file)
        return `${file}:${existsSync(fullPath) ? sha(readFileSync(fullPath)) : '<missing>'}`
      }),
    ].join('\n')
  )
  const manifest = {
    version: 2,
    runId,
    identity,
    sourceRevision: sourceRevision(),
    ledgerHash: initialLedgerHash,
    fixtureHash,
    sampleRenderHash,
    browser: 'Playwright Chromium, pinned in product lockfile',
    components: components.entries,
    nonvisualExports: components.nonvisual,
    extras: extras.entries,
    decisions: { stale: extras.decisions.stale, ambiguous: extras.decisions.ambiguous },
    coverageFailures: [...scannerFailures, ...components.failures],
  }
  if (capture) {
    await captureImages(manifest, runDir)
    fingerprintComponentPreviews(manifest.components, runDir)
  }
  if (sourceRevision() !== manifest.sourceRevision)
    manifest.coverageFailures.push({
      file: '<product-working-tree>',
      reason: 'Source changed during capture; refresh again.',
    })
  if (ledger && sha(readFileSync(ledger)) !== initialLedgerHash)
    manifest.coverageFailures.push({
      file: '<review-ledger>',
      reason: 'Review decisions changed during the run; refresh again.',
    })
  const missing = [...manifest.components, ...manifest.extras].filter(
    (entry) => entry.status !== 'ready'
  )
  manifest.status = missing.length || manifest.coverageFailures.length ? 'incomplete' : 'complete'
  manifest.counts = {
    components: manifest.components.length,
    extras: manifest.extras.length,
    missing: missing.length,
  }
  writeFileSync(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const pointer = path.join(outputRoot, 'latest.json')
  const temporary = path.join(outputRoot, `.latest-${process.pid}.json`)
  writeFileSync(temporary, `${JSON.stringify({ runId, path: runDir })}\n`)
  renameSync(temporary, pointer)
  process.stdout.write(
    `Studio run: ${runDir}\nEntries: ${manifest.counts.components} EMCN exports and variants, ${manifest.counts.extras} detected Extras; ${missing.length} without complete captures.\n`
  )
  process.exitCode = manifest.status === 'complete' ? 0 : 1
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 2
})
