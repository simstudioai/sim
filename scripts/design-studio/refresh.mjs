#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
/** Regenerate the local Design Studio inventory from product source. */
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
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { productScope } from '../design-conformance/control-scope.ts'

const toolRoot = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(process.env.SIM_STUDIO_REPO ?? path.join(toolRoot, '../..'))
const { parse } = createRequire(import.meta.url)('@babel/parser')
const outputRoot = path.resolve(
  process.env.SIM_STUDIO_OUTPUT ?? path.join(homedir(), '.local/state/sim2/design-studio')
)
const bun = process.execPath
const bunDirectory = path.dirname(bun)
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
        const file = path.join(directory, item.name)
        if (productScope(relative(file)) === 'check') files.push(file)
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
    for (const statement of node.consequent)
      walk(statement, (part) => {
        if (part.type !== 'JSXOpeningElement') return
        const name = jsxName(part.name)
        names.add(name)
      })
    cases.set(node.test.value, { names })
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
  const fixtureContracts = JSON.parse(
    readFileSync(path.join(repo, 'tools/design-studio/_components/fixture-contracts.json'), 'utf8')
  )
  const entries = []
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
    if (fixture && fixtureContracts.defaultStates?.[item.name])
      fixture.defaultState = fixtureContracts.defaultStates[item.name]
    if (fixture && fixtureContracts.requiredElements?.[item.name])
      fixture.requiredElement = fixtureContracts.requiredElements[item.name]
    const base = {
      id: `${item.kind}:${item.name}`,
      kind: item.kind,
      name: item.name,
      family,
      source: { file: item.facts.source.file, line: item.facts.source.line },
      rationale: nonvisualNames.get(item.name),
      usages: uses.get(`${item.kind}:${item.name}`) ?? [],
      fixture,
      states: fixtureContracts.states?.[item.name] ?? [],
      status: fixture ? 'ready' : 'needs-fixture',
    }
    entries.push(base)
    if (item.kind !== 'component') continue
    const seenVariants = new Set()
    const axes = Object.entries(item.facts.variants).map(([name, axis]) => ({
      name,
      values: axis.values.map(String),
      defaultValue: axis.default === undefined ? undefined : String(axis.default),
    }))
    for (const axis of axes)
      for (const value of axis.values) {
        if (value === axis.defaultValue) continue
        const identity = `${axis.name}=${value}`
        if (seenVariants.has(identity)) continue
        seenVariants.add(identity)
        const supportsVariant = Boolean(
          fixture && fixtureContracts.variants?.[item.name]?.includes(axis.name)
        )
        const disabled = axis.name === 'disabled' && value === 'true'
        const closed = axis.name === 'open' && value === 'false'
        const applicable = (state) =>
          !((disabled || closed) && state === 'open') && !(disabled && state === 'focus')
        const variantFixture = supportsVariant
          ? { ...fixture, variant: { axis: axis.name, value } }
          : null
        if (variantFixture?.defaultState && !applicable(variantFixture.defaultState))
          variantFixture.defaultState = undefined
        entries.push({
          ...base,
          id: `component:${item.name}:${axis.name}=${value}`,
          name: `${item.name} · ${axis.name}: ${value}`,
          variant: { axis: axis.name, value, defaultValue: axis.defaultValue },
          fixture: variantFixture,
          states: base.states.filter(applicable),
          status: supportsVariant ? 'ready' : 'needs-fixture',
        })
      }
  }
  return { entries, nonvisual, failures }
}

/** The scanner already resolves product wrappers to EMCN terminal renderers. */
function attachTracedUses(entries, controls) {
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

function extraInventory(findings) {
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
      rationale: item.reason ?? '',
      fixture,
      previewKind: fixtureId
        ? 'source-component'
        : fixture.sample.className || fixture.sample.values.length || fixture.sample.property
          ? 'source-style-sample'
          : 'indicative-sample',
      status: 'ready',
    }
    if (item.file.startsWith('packages/emcn/')) centralSignals.push(entry)
    entries.push(entry)
  }
  return { entries, centralSignals }
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
  const initialSourceRevision = sourceRevision()
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
        '--output',
        scanDir,
        '--batch-size',
        '1000',
      ],
      {
        cwd: repo,
        env: { ...process.env, PATH: `${bunDirectory}:${process.env.PATH}` },
      }
    )
    if (scan.code > 1) throw new Error(`Scanner failed with exit ${scan.code}`)
  }
  const scanReport = JSON.parse(readFileSync(path.join(scanDir, 'scan.json'), 'utf8'))
  if (scanReport.version !== 1 || !scanReport.inventory || !scanReport.controls)
    throw new Error('Invalid scanner report')
  const { identity, inventory, controls } = scanReport
  const components = componentInventory()
  attachTracedUses(components.entries, controls)
  const extras = extraInventory(inventory.findings)
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
  const scannerFailures = inventory.coverageFailures
  const fixtureSources = [
    'tools/design-studio/_components/component-fixtures.tsx',
    'tools/design-studio/_components/fixture-contracts.json',
    'tools/design-studio/_components/studio-fixture.tsx',
    'tools/design-studio/app/fixture/page.tsx',
    'tools/design-studio/app/studio.css',
    'tools/design-studio/app/layout.tsx',
  ]
  const fixtureHash = sha(
    fixtureSources.map((file) => `${file}:${sha(readFileSync(path.join(repo, file)))}`).join('\n')
  )
  const manifest = {
    version: 2,
    runId,
    identity,
    sourceRevision: initialSourceRevision,
    fixtureHash,
    components: components.entries,
    nonvisualExports: components.nonvisual,
    extras: extras.entries,
    coverageFailures: [...scannerFailures, ...components.failures],
    analysis: {
      stylingUnchecked: inventory.unchecked,
      controlUnchecked: controls.unchecked,
      limitations: inventory.limitations,
    },
  }
  if (sourceRevision() !== manifest.sourceRevision)
    manifest.coverageFailures.push({
      file: '<product-working-tree>',
      reason: 'Source changed during refresh; refresh again.',
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
    `Studio run: ${runDir}\nEntries: ${manifest.counts.components} EMCN exports and variants, ${manifest.counts.extras} detected Extras; ${missing.length} need fixtures.\n`
  )
  process.exitCode = manifest.status === 'complete' ? 0 : 1
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 2
})
