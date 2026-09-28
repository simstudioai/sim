import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'
import { workingTreeRevision } from '../design-conformance/source-revision.ts'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'refresh.mjs')
const metadataScript = `
import {generateContracts} from ${JSON.stringify(path.resolve('scripts/design-conformance/generated-contracts.ts'))}
import {GitSource} from ${JSON.stringify(path.resolve('scripts/design-conformance/worktree-source.ts'))}
const source = new GitSource(process.env.DESIGN_TEST_REPO, 'HEAD', true)
process.stdout.write(JSON.stringify(await generateContracts(source.central())))
`

function updateMetadata(repo, scan) {
  const result = spawnSync(
    process.env.DESIGN_TEST_BUN ?? 'bun',
    ['--no-env-file', '-e', metadataScript],
    {
      encoding: 'utf8',
      env: { ...process.env, DESIGN_TEST_REPO: repo },
    }
  )
  assert.equal(result.status, 0, result.stderr)
  const file = path.join(scan, 'scan.json')
  const report = JSON.parse(readFileSync(file, 'utf8'))
  const { version, sourceHash, exports, diagnostics } = JSON.parse(result.stdout)
  report.inventory.metadata = { version, sourceHash, exports, diagnostics }
  report.inventory.mode = 'working-tree'
  report.identity.sourceRevision = workingTreeRevision(repo)
  writeFileSync(file, JSON.stringify(report))
}

function write(root, name, contents) {
  const file = path.join(root, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, contents)
}

function findings(scan) {
  return JSON.parse(readFileSync(path.join(scan, 'scan.json'), 'utf8')).inventory.findings
}

function setFindings(scan, next) {
  const file = path.join(scan, 'scan.json')
  const report = JSON.parse(readFileSync(file, 'utf8'))
  report.inventory.findings = next
  writeFileSync(file, JSON.stringify(report))
}

function components(manifest) {
  return manifest.components.flatMap((treatment) => treatment.entries)
}

function variants(manifest) {
  return components(manifest).flatMap((entry) => entry.variants ?? [])
}

function extras(manifest) {
  return manifest.extras.flatMap((treatment) => treatment.entries)
}

function command(root, executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

/** Exercises publication guards through the real CLI against a disposable Git repository. */
function guardedRefresh() {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-studio-guards-'))
  const repo = path.join(root, 'repo')
  const scan = path.join(root, 'scan')
  const output = path.join(root, 'output')
  mkdirSync(repo)
  mkdirSync(scan)
  for (const file of [
    'package.json',
    'packages/emcn/src/lib/cn.ts',
    'packages/emcn/src/icons/index.ts',
    'packages/emcn/src/components/charts/index.ts',
    'tools/design-studio/app/studio.css',
    'tools/design-studio/app/layout.tsx',
    'tools/design-studio/app/fixture/page.tsx',
    'tools/design-studio/_components/studio-fixture.tsx',
  ])
    write(repo, file, file === 'package.json' ? '{}' : '')
  write(repo, 'packages/emcn/src/index.ts', "export * from './components'\n")
  write(
    repo,
    'packages/emcn/src/components/index.ts',
    "export { Example } from './example/example'\n"
  )
  write(
    repo,
    'packages/emcn/src/components/example/example.tsx',
    "export const Example = ({size, variant}: {size?: 'sm' | 'lg'; variant?: 'plain' | 'filled'}) => <button />\n"
  )
  write(
    repo,
    'tools/design-studio/_components/component-fixtures.tsx',
    "export function ComponentPreview({id}) { switch(id) { case 'example': return <Example {...variantProps} />; default: return null } }\n"
  )
  write(
    repo,
    'tools/design-studio/_components/fixture-contracts.json',
    JSON.stringify({ variants: { Example: ['variant'] } })
  )
  write(repo, 'apps/sim/app/_styles/globals.css', '@import "./tailwind.css";\n:root{--brand:#abc}')
  write(repo, 'apps/sim/app/_styles/tailwind.css', '@theme { --color-example: red; }')
  write(
    scan,
    'scan.json',
    JSON.stringify({
      version: 3,
      identity: { commit: 'test', treeHash: 'test', scanner: {} },
      inventory: {
        findings: [],
        unchecked: [{ file: 'example.tsx', line: 1, reason: 'Computed styling is unchecked' }],
        coverageFailures: [],
        limitations: ['Runtime cascade is unsupported.'],
      },
      controls: {
        records: [],
        unchecked: [{ file: 'example.tsx', line: 2, reason: 'Unknown spread' }],
      },
    })
  )
  command(repo, 'git', ['init', '-q'])
  command(repo, 'git', ['add', '.'])
  command(repo, 'git', [
    '-c',
    'user.name=Studio Test',
    '-c',
    'user.email=studio@example.test',
    'commit',
    '-qm',
    'fixture',
  ])
  const refresh = () => {
    updateMetadata(repo, scan)
    const result = spawnSync('node', [script], {
      env: {
        ...process.env,
        SIM_STUDIO_REPO: repo,
        SIM_STUDIO_SCAN_DIR: scan,
        SIM_STUDIO_OUTPUT: output,
      },
      encoding: 'utf8',
    })
    assert.ok([0, 1].includes(result.status), result.stderr)
    const pointer = JSON.parse(readFileSync(path.join(output, 'latest.json'), 'utf8'))
    return JSON.parse(readFileSync(path.join(pointer.path, 'manifest.json'), 'utf8'))
  }
  return { repo, refresh }
}

function runScanner(repo, source = '--working-tree') {
  const scan = path.join(path.dirname(repo), `real-scan-${source.slice(2)}`)
  const scanned = spawnSync(
    process.env.DESIGN_TEST_BUN ?? 'bun',
    [
      '--no-env-file',
      path.resolve('scripts/design-scan/scan.ts'),
      '--repo',
      repo,
      source,
      ...(source === '--ref' ? ['HEAD'] : []),
      '--output',
      scan,
    ],
    { encoding: 'utf8', timeout: 120000 }
  )
  assert.ok([0, 1].includes(scanned.status), scanned.stderr)
  return scan
}

function publishScan(repo, scan, output) {
  return spawnSync('node', [script], {
    env: {
      ...process.env,
      SIM_STUDIO_REPO: repo,
      SIM_STUDIO_SCAN_DIR: scan,
      SIM_STUDIO_OUTPUT: output,
    },
    encoding: 'utf8',
    timeout: 120000,
  })
}

test('Studio consumes the unmodified report written by the scanner CLI', () => {
  const { repo } = guardedRefresh()
  write(
    repo,
    'apps/sim/app/product/page.tsx',
    "import { Example } from '@sim/emcn'\nexport default function Page() { return <div style={{ color: '#123456' }}><Example /></div> }\n"
  )
  const root = path.dirname(repo)
  const scan = runScanner(repo)
  const reportFile = path.join(scan, 'scan.json')
  const reportBytes = readFileSync(reportFile)
  const report = JSON.parse(reportBytes.toString())
  assert.equal(report.version, 3)
  assert.ok(report.inventory.metadata.exports.Example)
  assert.ok(report.inventory.findings.some((finding) => finding.value === '#123456'))

  const output = path.join(root, 'real-studio')
  const refreshed = publishScan(repo, scan, output)
  assert.ok([0, 1].includes(refreshed.status), refreshed.stderr)
  assert.deepEqual(readFileSync(reportFile), reportBytes)
  const pointer = JSON.parse(readFileSync(path.join(output, 'latest.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(path.join(pointer.path, 'manifest.json'), 'utf8'))
  const example = components(manifest).find((entry) => entry.name === 'Example')
  assert.ok(example)
  assert.ok(example.variants.some((entry) => entry.id === 'component:Example:variant=filled'))
  assert.ok(
    example.usages.some(
      (usage) => usage.file === 'apps/sim/app/product/page.tsx' && usage.relationship === 'direct'
    )
  )
  assert.ok(
    extras(manifest).some((entry) =>
      report.inventory.findings.some((finding) => entry.id === `finding:${finding.id}`)
    )
  )
}, 120000)

for (const [name, change] of [
  [
    'tracked edit',
    (repo) =>
      write(
        repo,
        'packages/emcn/src/components/example/example.tsx',
        "export const Example = ({size, variant}: {size?: 'sm' | 'lg'; variant?: 'plain' | 'filled'}) => <button data-changed />\n"
      ),
  ],
  [
    'new product file',
    (repo) =>
      write(
        repo,
        'apps/sim/app/product/new.tsx',
        'export const NewProductSurface = () => <button />\n'
      ),
  ],
]) {
  test(`a ${name} makes an injected scan stale without replacing the latest publication`, () => {
    const { repo } = guardedRefresh()
    const scan = runScanner(repo)
    const output = path.join(path.dirname(repo), 'real-studio')
    const first = publishScan(repo, scan, output)
    assert.ok([0, 1].includes(first.status), first.stderr)
    const pointer = path.join(output, 'latest.json')
    const published = readFileSync(pointer)

    change(repo)
    const stale = publishScan(repo, scan, output)
    assert.equal(stale.status, 2, stale.stderr)
    assert.match(stale.stderr, /scan.*source revision|source revision.*scan/i)
    assert.deepEqual(readFileSync(pointer), published)
  }, 120000)
}

test('an immutable scan cannot publish a current Studio catalog', () => {
  const { repo } = guardedRefresh()
  const scan = runScanner(repo, '--ref')
  const output = path.join(path.dirname(repo), 'real-studio')
  const result = publishScan(repo, scan, output)
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /working.tree scan/i)
  assert.equal(existsSync(path.join(output, 'latest.json')), false)
}, 120000)

test('refresh tracks source changes in imported stylesheets', () => {
  const { repo, refresh } = guardedRefresh()
  const first = refresh()
  write(repo, 'apps/sim/app/_styles/tailwind.css', '@theme { --color-example: blue; }')
  const changed = refresh()
  assert.notEqual(changed.sourceRevision, first.sourceRevision)
}, 60000)

test('refresh requires a fixture mapping for each variant axis', () => {
  const { refresh } = guardedRefresh()
  const manifest = refresh()
  assert.ok(
    variants(manifest).find((entry) => entry.id === 'component:Example:variant=filled').fixture
  )
  assert.equal(
    variants(manifest).find((entry) => entry.id === 'component:Example:size=lg').fixture,
    null
  )
}, 60000)

test('refresh keeps disabled variants without impossible interaction states', () => {
  const { repo, refresh } = guardedRefresh()
  write(
    repo,
    'packages/emcn/src/components/example/example.tsx',
    'export const Example = ({disabled}: {disabled?: boolean}) => <button disabled={disabled} />\n'
  )
  write(
    repo,
    'tools/design-studio/_components/fixture-contracts.json',
    JSON.stringify({
      variants: { Example: ['disabled'] },
      states: { Example: ['open', 'focus', 'disabled'] },
      defaultStates: { Example: 'open' },
    })
  )
  const manifest = refresh()
  const enabled = variants(manifest).find(
    (entry) => entry.id === 'component:Example:disabled=false'
  )
  const disabled = variants(manifest).find(
    (entry) => entry.id === 'component:Example:disabled=true'
  )
  assert.deepEqual(enabled.states, ['open', 'focus', 'disabled'])
  assert.equal(enabled.fixture.defaultState, 'open')
  assert.deepEqual(disabled.states, ['disabled'])
  assert.equal(disabled.fixture.defaultState, undefined)
  assert.deepEqual(disabled.fixture.variant, { axis: 'disabled', value: 'true' })
  assert.equal(disabled.status, 'ready')
}, 60000)

test('refresh keeps explicitly closed variants out of open states', () => {
  const { repo, refresh } = guardedRefresh()
  write(
    repo,
    'packages/emcn/src/components/example/example.tsx',
    'export const Example = ({open}: {open?: boolean}) => <button data-open={open} />\n'
  )
  write(
    repo,
    'tools/design-studio/_components/fixture-contracts.json',
    JSON.stringify({
      variants: { Example: ['open'] },
      states: { Example: ['open', 'focus'] },
      defaultStates: { Example: 'open' },
    })
  )
  const manifest = refresh()
  const closed = variants(manifest).find((entry) => entry.id === 'component:Example:open=false')
  const opened = variants(manifest).find((entry) => entry.id === 'component:Example:open=true')
  assert.deepEqual(closed.states, ['focus'])
  assert.equal(closed.fixture.defaultState, undefined)
  assert.deepEqual(opened.states, ['open', 'focus'])
  assert.equal(opened.fixture.defaultState, 'open')
}, 60000)

test('refresh publishes unresolved analysis and scanner limits separately from inspection failures', () => {
  const { refresh } = guardedRefresh()
  const manifest = refresh()
  assert.deepEqual(manifest.analysis.stylingUncheckedSample, [
    { file: 'example.tsx', line: 1, reason: 'Computed styling is unchecked' },
  ])
  assert.deepEqual(manifest.analysis.controlUncheckedSample, [
    { file: 'example.tsx', line: 2, reason: 'Unknown spread' },
  ])
  assert.deepEqual(manifest.analysis.limitations, ['Runtime cascade is unsupported.'])
  assert.deepEqual(manifest.coverageFailures, [])
}, 60000)

test('refresh catalogs every detected treatment and new EMCN export', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-studio-'))
  const repo = path.join(root, 'repo')
  const scan = path.join(root, 'scan')
  const output = path.join(root, 'output')
  mkdirSync(repo)
  mkdirSync(scan)
  write(repo, 'package.json', '{}')
  write(repo, 'packages/emcn/src/lib/cn.ts', '')
  write(repo, 'tools/design-studio/app/studio.css', '')
  write(repo, 'tools/design-studio/app/layout.tsx', '')
  write(
    repo,
    'packages/emcn/src/index.ts',
    "export * from './components'\nexport * from './icons'\n"
  )
  write(
    repo,
    'packages/emcn/src/components/index.ts',
    "export { Example, SPACING, Compound } from './example/example'\n"
  )
  write(repo, 'packages/emcn/src/components/charts/index.ts', '')
  write(repo, 'packages/emcn/src/icons/index.ts', "export { StarIcon } from './star'\n")
  write(repo, 'packages/emcn/src/icons/star.tsx', 'export const StarIcon = () => <svg />\n')
  write(
    repo,
    'packages/emcn/src/components/example/example.tsx',
    "import {cva} from 'class-variance-authority'\nconst exampleVariants = cva('', { variants: { size: { sm: '', lg: '' } }, defaultVariants: { size: 'sm' } })\ninterface ExampleProps { variant?: 'plain' | 'filled' }\nexport const Example = ({variant, size}: ExampleProps & {size?: 'sm' | 'lg'}) => <button className={exampleVariants({size})} />\nexport const SPACING=8;export const Compound={Part:({size='sm'}:{size?:'sm'|'lg'})=> <div/>}\n"
  )
  write(
    repo,
    'tools/design-studio/_components/component-fixtures.tsx',
    "export function ComponentPreview({ id }) { switch (id) { case 'example': return <><Example {...variantProps} /><Compound.Part /></>; default: return null } }\n"
  )
  write(
    repo,
    'tools/design-studio/_components/fixture-contracts.json',
    JSON.stringify({ variants: { Example: ['variant', 'size'] } })
  )
  write(
    repo,
    'tools/design-studio/_components/studio-fixture.tsx',
    'export const Fixture = () => null\n'
  )
  write(
    repo,
    'tools/design-studio/app/fixture/page.tsx',
    'export default function Page() { return null }\n'
  )
  write(
    repo,
    'apps/sim/app/product/page.tsx',
    "import { Example, Compound } from '@sim/emcn'\nexport default function Page() { return <><Example /><Compound.Part /></> }\n"
  )
  write(
    repo,
    'apps/sim/app/(landing)/page.tsx',
    "import { Example, Compound } from '@sim/emcn'\nexport default function Page() { return <><Example /><Compound.Part /></> }\n"
  )
  write(
    repo,
    'apps/sim/docs/page.tsx',
    "import { Example, Compound } from '@sim/emcn'\nexport default function Page() { return <><Example /><Compound.Part /></> }\n"
  )
  write(repo, 'apps/sim/app/_styles/globals.css', ':root{--brand:#abc}')
  command(repo, 'git', ['init', '-q'])
  command(repo, 'git', ['add', '.'])
  command(repo, 'git', [
    '-c',
    'user.name=Studio Test',
    '-c',
    'user.email=studio@example.test',
    'commit',
    '-qm',
    'fixture',
  ])
  const finding = {
    id: 'finding-one',
    file: 'apps/sim/app/product/page.tsx',
    line: 2,
    context: 'Page',
    rule: 'central-radius',
    property: 'border-radius',
    value: '7px',
  }
  const advisory = {
    id: 'advisory-one',
    file: 'apps/sim/app/product/page.tsx',
    line: 2,
    owner: 'Page',
    kind: 'recipe-review',
    value: 'rounded',
  }
  write(
    scan,
    'scan.json',
    JSON.stringify({
      version: 3,
      identity: { commit: 'test-head', treeHash: 'test-tree', scanner: {} },
      inventory: {
        findings: [
          finding,
          { ...advisory, rule: advisory.kind, property: advisory.kind, context: advisory.owner },
        ],
        unchecked: [],
        coverageFailures: [],
        limitations: [],
      },
      controls: {
        records: [
          {
            origin: 'emcn-component',
            projection: true,
            file: 'apps/sim/app/product/wrapper.tsx',
            line: 7,
            tag: 'Wrapper',
            terminals: ['central:packages/emcn/src/components/example/example.tsx#Example@1'],
          },
        ],
        unchecked: [],
      },
    })
  )

  const refresh = () => {
    updateMetadata(repo, scan)
    const result = spawnSync('node', [script], {
      env: {
        ...process.env,
        SIM_STUDIO_REPO: repo,
        SIM_STUDIO_SCAN_DIR: scan,
        SIM_STUDIO_OUTPUT: output,
      },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1, result.stderr)
    const pointer = JSON.parse(readFileSync(path.join(output, 'latest.json'), 'utf8'))
    return JSON.parse(readFileSync(path.join(pointer.path, 'manifest.json'), 'utf8'))
  }

  const first = refresh()
  assert.equal(first.version, 3)
  assert.equal(first.counts.components, components(first).length + variants(first).length)
  assert.equal(first.counts.extras, extras(first).length)
  assert.equal(
    new Set([...components(first), ...variants(first), ...extras(first)].map((entry) => entry.id))
      .size,
    first.counts.components + first.counts.extras
  )
  assert.ok(variants(first).every((entry) => !('usages' in entry)))
  assert.equal(
    components(first).some((e) => e.name === 'SPACING' || e.name === 'Compound'),
    false
  )
  assert.equal(
    first.nonvisualExports.some((e) => e.name === 'SPACING'),
    true
  )
  assert.equal(components(first).find((e) => e.name === 'Compound.Part').fixture.id, 'example')
  assert.equal(
    variants(first).find((e) => e.id === 'component:Compound.Part:size=lg').fixture,
    null
  )

  assert.equal(
    components(first)
      .find((e) => e.name === 'Compound.Part')
      .usages.filter((u) => u.relationship === 'direct').length,
    1
  )

  const again = refresh()
  assert.deepEqual(first.components, again.components)
  assert.equal(first.sourceRevision, again.sourceRevision)

  write(
    repo,
    'packages/emcn/src/lib/cn.ts',
    'export const cn = (...values) => values.filter(Boolean).join(" " )\n'
  )
  const changedClassMerger = refresh()
  assert.notEqual(changedClassMerger.sourceRevision, first.sourceRevision)
  write(repo, 'packages/emcn/src/lib/cn.ts', '')
  assert.deepEqual(
    components(first).flatMap((entry) => [
      entry.id,
      ...(entry.variants ?? []).map((variant) => variant.id),
    ]),
    [
      'component:Compound.Part',
      'component:Compound.Part:size=lg',
      'component:Example',
      'component:Example:variant=filled',
      'component:Example:variant=plain',
      'component:Example:size=lg',
      'icon:StarIcon',
    ]
  )
  assert.deepEqual(
    components(first)
      .find((entry) => entry.name === 'Example')
      .usages.map((site) => site.relationship),
    ['direct', 'via Wrapper']
  )
  assert.equal(extras(first).length, 2)
  assert.deepEqual(
    extras(first).map((entry) => entry.id),
    ['finding:finding-one', 'finding:advisory-one']
  )
  assert.equal(extras(first)[0].fixture.type, 'sample')
  assert.equal(extras(first)[0].fixture.sample.kind, 'surface')
  assert.equal(extras(first)[0].fixture.sample.tag, 'Example')
  assert.equal(extras(first)[0].previewKind, 'source-style-sample')

  write(
    repo,
    'packages/emcn/src/components/root-only.tsx',
    'export const RootOnly = () => <div />\n'
  )
  write(
    repo,
    'packages/emcn/src/index.ts',
    "export * from './components'\nexport * from './icons'\nexport { RootOnly } from './components/root-only'\n"
  )
  assert.equal(
    components(refresh()).find((entry) => entry.id === 'component:RootOnly')?.status,
    'needs-fixture'
  )
  write(
    repo,
    'packages/emcn/src/index.ts',
    "export * from './components'\nexport * from './icons'\n"
  )

  write(repo, 'packages/emcn/src/components/cycle-a.ts', "export * from './cycle-b'\n")
  write(repo, 'packages/emcn/src/components/cycle-b.ts', "export * from './cycle-a'\n")
  write(
    repo,
    'packages/emcn/src/components/index.ts',
    "export { Example, SPACING, Compound } from './example/example'\nexport * from './cycle-a'\n"
  )
  assert.deepEqual(
    components(refresh()).flatMap((entry) => [
      entry.id,
      ...(entry.variants ?? []).map((variant) => variant.id),
    ]),
    components(first).flatMap((entry) => [
      entry.id,
      ...(entry.variants ?? []).map((variant) => variant.id),
    ])
  )

  write(
    repo,
    'apps/sim/app/product/another.tsx',
    "import { Example } from '@sim/emcn'\nexport const Another = () => <Example />\n"
  )
  const changed = refresh()
  assert.notEqual(changed.sourceRevision, first.sourceRevision)
  assert.equal(components(changed).find((entry) => entry.name === 'Example').usages.length, 3)

  write(
    repo,
    'packages/emcn/src/components/index.ts',
    "export { Example, SPACING, Compound } from './example/example'\nexport { NewControl } from './new-control/new-control'\n"
  )
  write(
    repo,
    'packages/emcn/src/components/new-control/new-control.tsx',
    'export const NewControl = () => <button />\n'
  )
  const exported = refresh()
  assert.equal(
    components(exported).find((entry) => entry.id === 'component:NewControl')?.status,
    'needs-fixture'
  )

  setFindings(scan, [
    finding,
    advisory,
    {
      id: 'central-one',
      file: 'packages/emcn/src/components/example/example.tsx',
      line: 1,
      owner: 'Example',
      kind: 'stock-shadow',
      value: 'shadow-sm',
    },
    {
      id: 'unmatched-central',
      file: 'packages/emcn/src/components/internal.tsx',
      line: 2,
      owner: 'Internal',
      kind: 'local-typography',
      value: 'text-sm',
    },
  ])
  const central = refresh()
  assert.equal(extras(central).length, 4)
  assert.equal(extras(central)[2].id, 'finding:central-one')
  assert.equal(extras(central)[3].id, 'finding:unmatched-central')
  assert.equal(
    components(central).find((entry) => entry.id === 'component:Example')?.signals,
    undefined
  )

  write(
    repo,
    'apps/sim/app/product/new-action.tsx',
    "export const NewAction = () => <button className='rounded-[13px] bg-[#123456] px-3'>Run</button>\n"
  )
  const newSignals = [
    {
      id: 'new-control',
      file: 'apps/sim/app/product/new-action.tsx',
      line: 1,
      owner: 'NewAction',
      kind: 'local-control',
      value: 'button',
    },
    {
      id: 'new-alpha',
      file: 'apps/sim/app/product/new-action.tsx',
      line: 1,
      owner: 'NewAction',
      kind: 'local-alpha',
      value: 'bg-[#123456]',
    },
  ]
  setFindings(scan, [...findings(scan), ...newSignals])
  const discovered = refresh()
  const newEntries = extras(discovered).filter((entry) =>
    entry.source.file.endsWith('/new-action.tsx')
  )
  assert.equal(newEntries.length, 2)
  assert.notDeepEqual(newEntries[0].fixture, newEntries[1].fixture)
  assert.equal(newEntries[0].fixture.type, 'sample')
  assert.equal(newEntries[0].fixture.sample.tag, 'button')
  assert.equal(newEntries[0].fixture.sample.className, '')
  assert.equal(newEntries[1].fixture.sample.className, 'bg-[#123456]')
  assert.equal(newEntries[0].previewKind, 'indicative-sample')

  write(
    repo,
    'apps/sim/app/product/conditional.tsx',
    "export const Conditional = ({active}) => <button className={active ? 'rounded-[13px]' : 'rounded-[8px]'} />\n"
  )
  setFindings(scan, [
    ...findings(scan),
    ...['rounded-[13px]', 'rounded-[8px]'].map((value, index) => ({
      id: `conditional-${index}`,
      file: 'apps/sim/app/product/conditional.tsx',
      line: 1,
      owner: 'Conditional',
      kind: 'central-radius',
      value,
    })),
  ])
  const conditional = extras(refresh()).filter((entry) =>
    entry.source.file.endsWith('/conditional.tsx')
  )
  assert.deepEqual(
    conditional.map((entry) => entry.fixture.sample.className),
    ['rounded-[13px]', 'rounded-[8px]']
  )

  setFindings(scan, [
    ...findings(scan),
    {
      id: 'moved-icon',
      file: 'apps/sim/components/icons.tsx',
      line: 1000,
      owner: 'WorkflowIcon',
      kind: 'mixed-product-artwork',
      value: 'WorkflowIcon',
    },
  ])
  const movedIcon = extras(refresh()).find((entry) => entry.id === 'finding:moved-icon')
  assert.deepEqual(movedIcon.fixture, { type: 'extra', id: 'workflowIcon' })

  const richCss =
    'apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css'
  const showcase =
    'apps/sim/app/workspace/[workspaceId]/integrations/components/integrations-showcase/integrations-showcase.tsx'
  setFindings(scan, [
    ...findings(scan),
    {
      id: 'code-moved',
      file: richCss,
      line: 800,
      context: 'css / .rich-markdown-prose code',
      kind: 'local-typography',
      value: 'font-size: 0.875em',
    },
    {
      id: 'selection-moved',
      file: richCss,
      line: 20,
      context: 'css / .rich-markdown-nodes hr.rich-leaf-in-selection',
      kind: 'central-radius',
      value: '1px',
    },
    {
      id: 'other-css',
      file: richCss,
      line: 10,
      owner: 'css',
      kind: 'local-typography',
      value: 'line-height: 1.2',
    },
    {
      id: 'tile-moved',
      file: showcase,
      line: 900,
      context: 'IntegrationTile / div / className',
      kind: 'stock-shadow',
      value: 'shadow-xs',
    },
    {
      id: 'showcase-moved',
      file: showcase,
      line: 1,
      context: 'IntegrationsShowcase',
      kind: 'central-artwork',
      value: 'artwork',
    },
    {
      id: 'other-showcase',
      file: showcase,
      line: 10,
      context: 'UnknownPanel',
      kind: 'local-alpha',
      value: 'bg-black/10',
    },
  ])
  const semantic = new Map(extras(refresh()).map((entry) => [entry.id, entry]))
  assert.equal(semantic.get('finding:code-moved').fixture.id, 'rich-code')
  assert.equal(semantic.get('finding:selection-moved').fixture.id, 'rich-selection')
  assert.equal(semantic.get('finding:other-css').fixture.id, 'rich-type')
  assert.equal(semantic.get('finding:tile-moved').fixture.id, 'integration-tile')
  assert.equal(semantic.get('finding:showcase-moved').fixture.id, 'showcase')
  assert.equal(semantic.get('finding:other-showcase').fixture.type, 'sample')
}, 60000)
