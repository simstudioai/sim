import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'refresh.mjs')

function write(root, name, contents) {
  const file = path.join(root, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, contents)
}

function command(root, executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

test('refresh catalogs every detection independently of review decisions', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-studio-'))
  const repo = path.join(root, 'repo')
  const scan = path.join(root, 'scan')
  const output = path.join(root, 'output')
  const ledger = path.join(root, 'reviews.json')
  mkdirSync(repo)
  mkdirSync(scan)
  write(repo, 'package.json', '{}')
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
    'findings.json',
    JSON.stringify([
      finding,
      {
        ...advisory,
        rule: advisory.kind,
        property: advisory.kind,
        context: advisory.owner,
        legacyFingerprint: createHash('sha256')
          .update(
            JSON.stringify([
              'review-item',
              advisory.file,
              advisory.owner,
              advisory.kind,
              advisory.value,
            ])
          )
          .digest('hex'),
      },
    ])
  )
  write(
    scan,
    'review-decisions.json',
    JSON.stringify({ matches: [], stale: ['old'], ambiguous: ['duplicate'] })
  )
  write(scan, 'shadow-extras.json', JSON.stringify({ approved: [] }))
  write(scan, 'coverage-failures.json', JSON.stringify([]))
  write(scan, 'typography-review.json', JSON.stringify({ classifications: [] }))
  write(
    scan,
    'identity.json',
    JSON.stringify({ commit: 'test-head', treeHash: 'test-tree', scanner: {} })
  )
  write(
    scan,
    'controls.json',
    JSON.stringify({
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
    })
  )
  writeFileSync(ledger, JSON.stringify({ version: '1.0.0', entries: [] }))

  const refresh = () => {
    command(repo, process.env.DESIGN_TEST_BUN ?? 'bun', [
      '--no-env-file',
      path.resolve('scripts/generate-design-contracts.ts'),
      '--repo',
      repo,
    ])
    const result = spawnSync('node', [script, '--inventory-only'], {
      env: {
        ...process.env,
        SIM_STUDIO_REPO: repo,
        SIM_STUDIO_SCAN_DIR: scan,
        SIM_STUDIO_OUTPUT: output,
        SIM_STUDIO_LEDGER: ledger,
      },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1, result.stderr)
    const pointer = JSON.parse(readFileSync(path.join(output, 'latest.json'), 'utf8'))
    return JSON.parse(readFileSync(path.join(pointer.path, 'manifest.json'), 'utf8'))
  }

  const first = refresh()
  assert.equal(
    first.components.some((e) => e.name === 'SPACING' || e.name === 'Compound'),
    false
  )
  assert.equal(
    first.nonvisualExports.some((e) => e.name === 'SPACING'),
    true
  )
  assert.equal(first.components.find((e) => e.name === 'Compound.Part').fixture.id, 'example')
  assert.equal(
    first.components.find((e) => e.id === 'component:Compound.Part:size=lg').fixture,
    null
  )

  assert.equal(
    first.components
      .find((e) => e.name === 'Compound.Part')
      .usages.filter((u) => u.relationship === 'direct').length,
    1
  )

  const again = refresh()
  assert.deepEqual(first.components, again.components)
  assert.equal(first.sourceRevision, again.sourceRevision)
  assert.equal(first.sampleRenderHash, again.sampleRenderHash)
  assert.deepEqual(
    first.components.map((entry) => entry.id),
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
    first.components
      .find((entry) => entry.name === 'Example')
      .usages.map((site) => site.relationship),
    ['direct', 'via Wrapper']
  )
  assert.equal(first.extras.length, 2)
  assert.deepEqual(
    first.extras.map((entry) => entry.id),
    ['finding:finding-one', 'finding:advisory-one']
  )
  assert.equal(first.extras[0].fixture.type, 'sample')
  assert.equal(first.extras[0].fixture.sample.kind, 'surface')
  assert.equal(first.extras[0].fixture.sample.tag, 'Example')
  assert.equal(first.extras[0].previewKind, 'source-style-sample')
  assert.deepEqual(first.decisions, {
    stale: [{ fingerprint: 'old' }],
    ambiguous: [{ fingerprint: 'duplicate' }],
  })

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
    refresh().components.find((entry) => entry.id === 'component:RootOnly')?.status,
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
    refresh().components.map((entry) => entry.id),
    first.components.map((entry) => entry.id)
  )

  write(
    repo,
    'apps/sim/app/product/another.tsx',
    "import { Example } from '@sim/emcn'\nexport const Another = () => <Example />\n"
  )
  const changed = refresh()
  assert.notEqual(changed.sourceRevision, first.sourceRevision)
  assert.equal(changed.sampleRenderHash, first.sampleRenderHash)
  assert.equal(changed.components.find((entry) => entry.name === 'Example').usages.length, 3)

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
    exported.components.find((entry) => entry.id === 'component:NewControl')?.status,
    'needs-fixture'
  )

  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        'finding',
        finding.file,
        finding.context,
        finding.rule,
        finding.property,
        finding.value,
      ])
    )
    .digest('hex')
  write(
    scan,
    'review-decisions.json',
    JSON.stringify({
      matches: [{ fingerprint, status: 'retained-extra', rationale: 'Reviewed source treatment' }],
      stale: [],
      ambiguous: [],
    })
  )
  const decided = refresh()
  assert.equal(decided.extras.length, 2)
  assert.equal(decided.extras[0].decision, 'retained-extra')
  assert.equal(decided.extras[0].status, 'pending-capture')

  const advisoryFingerprint = createHash('sha256')
    .update(
      JSON.stringify(['review-item', advisory.file, advisory.owner, advisory.kind, advisory.value])
    )
    .digest('hex')
  write(
    scan,
    'review-decisions.json',
    JSON.stringify({
      matches: [
        {
          fingerprint: advisoryFingerprint,
          status: 'false-positive',
          rationale: 'Historical note',
        },
      ],
      stale: [],
      ambiguous: [],
    })
  )
  const historicallyDismissed = refresh()
  assert.equal(historicallyDismissed.extras.length, 2)
  assert.equal(historicallyDismissed.extras[1].decision, 'false-positive')

  write(
    scan,
    'findings.json',
    JSON.stringify([
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
  )
  const central = refresh()
  assert.equal(central.extras.length, 4)
  assert.equal(central.extras[2].id, 'finding:central-one')
  assert.equal(central.extras[3].id, 'finding:unmatched-central')
  assert.deepEqual(
    central.components
      .find((entry) => entry.id === 'component:Example')
      ?.signals?.map((signal) => signal.id),
    ['finding:central-one']
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
  write(
    scan,
    'findings.json',
    JSON.stringify([
      ...JSON.parse(readFileSync(path.join(scan, 'findings.json'), 'utf8')),
      ...newSignals,
    ])
  )
  const discovered = refresh()
  const newEntries = discovered.extras.filter((entry) =>
    entry.source.file.endsWith('/new-action.tsx')
  )
  assert.equal(newEntries.length, 2)
  assert.deepEqual(newEntries[0].fixture, newEntries[1].fixture)
  assert.equal(newEntries[0].fixture.type, 'sample')
  assert.equal(newEntries[0].fixture.sample.tag, 'button')
  assert.match(newEntries[0].fixture.sample.className, /rounded-\[13px\]/)
  assert.equal(newEntries[0].previewKind, 'source-style-sample')

  write(
    scan,
    'findings.json',
    JSON.stringify([
      ...JSON.parse(readFileSync(path.join(scan, 'findings.json'), 'utf8')),
      {
        id: 'moved-icon',
        file: 'apps/sim/components/icons.tsx',
        line: 1000,
        owner: 'WorkflowIcon',
        kind: 'mixed-product-artwork',
        value: 'WorkflowIcon',
      },
    ])
  )
  const movedIcon = refresh().extras.find((entry) => entry.id === 'finding:moved-icon')
  assert.deepEqual(movedIcon.fixture, { type: 'extra', id: 'workflowIcon' })

  const richCss =
    'apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css'
  const showcase =
    'apps/sim/app/workspace/[workspaceId]/integrations/components/integrations-showcase/integrations-showcase.tsx'
  write(
    scan,
    'findings.json',
    JSON.stringify([
      ...JSON.parse(readFileSync(path.join(scan, 'findings.json'), 'utf8')),
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
  )
  const semantic = new Map(refresh().extras.map((entry) => [entry.id, entry]))
  assert.equal(semantic.get('finding:code-moved').fixture.id, 'rich-code')
  assert.equal(semantic.get('finding:selection-moved').fixture.id, 'rich-selection')
  assert.equal(semantic.get('finding:other-css').fixture.type, 'sample')
  assert.equal(semantic.get('finding:tile-moved').fixture.id, 'integration-tile')
  assert.equal(semantic.get('finding:showcase-moved').fixture.id, 'showcase')
  assert.equal(semantic.get('finding:other-showcase').fixture.type, 'sample')
}, 60000)
