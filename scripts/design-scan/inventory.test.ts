import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { findingFingerprint } from '#control-analysis/review-ledger'
import { testComponents } from '#design-conformance/test-source'
import { GitSource } from '#design-conformance/worktree-source'
import { scannerIdentity } from './identity'
import { inspectInventory } from './inventory'
import { csv, groups, validateOutput } from './report'

const temporary: string[] = []
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const component = 'apps/sim/components/example.tsx'
const globals = 'apps/sim/app/_styles/globals.css'
const sources: Record<string, string> = {
  [globals]:
    '@theme {--text-small:13px;--font-mono:monospace;--radius-lg:8px;--shadow-card:0 1px 2px #000;} :root{--text-body:#434343;--text-muted:#777;--text-error:#f00;--border:#ddd}',
  'packages/emcn/src/index.ts': "export * from './components/button/button'",
  'packages/emcn/src/components/button/button.tsx':
    "export const Button=({className,...props}:import('react').HTMLAttributes<HTMLButtonElement>)=> <button {...props} className={cn('h-8 rounded-lg px-2 bg-[var(--text-body)] text-[var(--text-body)]',className)}/>; export const centralColour='#434343'",
}
function fixture(files: Record<string, string> = {}, includeCentral = true) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'sim-one-off-fixture-'))
  temporary.push(base)
  const repo = path.join(base, 'repo')
  mkdirSync(repo)
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim()
  git('init', '-q')
  git('config', 'user.name', 'Synthetic Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  for (const [file, text] of Object.entries({ ...(includeCentral ? sources : {}), ...files })) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    writeFileSync(path.join(repo, file), text)
  }
  git('add', '.')
  git('commit', '-qm', 'synthetic source fixture', '--allow-empty')
  return { repo, base, git, source: () => new GitSource(repo, 'HEAD') }
}
const text = (classes: string) =>
  `export const A=()=> <p className=${JSON.stringify(classes)}>Text</p>`

test('full scan records the maintained analyzer identity', () => {
  expect(scannerIdentity().policy).toBe('design-conformance/2.0.0')
  expect(scannerIdentity().sourceHash).toMatch(/^[a-f\d]{64}$/)
})

test('inventories unchanged debt, preserves source locations and ignores central literal authoring', async () => {
  const f = fixture({ [component]: `\n\n${text('text-[#434343] text-[13px]')}` })
  const r = await inspectInventory(f.source())
  expect(r.status).toBe('completed')
  expect(r.findings.map((x) => x.rule).sort()).toEqual(['central-colour', 'central-typography'])
  expect(r.findings.every((x) => x.file === component && x.line === 3 && x.column > 0)).toBe(true)
  expect(r.findings.every((x) => x.kind === 'usage-violation')).toBe(true)
  expect(r.coverage.files.central).toBe(3)
})

test('approved central choices and unrestricted ordinary layout pass', async () => {
  const f = fixture({
    [component]: text(
      'text-small text-[var(--text-body)] font-mono rounded-lg shadow-card gap-[79px] w-[321px]'
    ),
  })
  expect((await inspectInventory(f.source())).findings).toEqual([])
})

test('component ownership applies even with approved tokens', async () => {
  const f = fixture({
    [component]:
      "import {Button} from '@sim/emcn'; export const A=()=> <Button className='bg-[var(--text-body)]'>Save</Button>",
  })
  expect(
    (await inspectInventory(f.source())).findings.some((x) => x.rule === 'component-chrome')
  ).toBe(true)
})

test('local imported literals are resolved without acquiring central provenance', async () => {
  const f = fixture({
    [component]:
      "import {colour} from './palette'; export const A=()=> <p style={{color:colour}}>Text</p>",
    'apps/sim/components/palette.ts': "export const colour='#434343'",
  })
  const r = await inspectInventory(f.source())
  expect(r.findings.some((x) => x.file === component && x.rule === 'central-colour')).toBe(true)
})

test('central exports retain provenance through the same lookup', async () => {
  const f = fixture({
    [component]:
      "import {centralColour} from '@sim/emcn'; export const A=()=> <p style={{color:centralColour}}>Text</p>",
  })
  expect((await inspectInventory(f.source())).findings).toEqual([])
})

test('wrapper forwarding preserves protected component contracts', async () => {
  const f = fixture({
    [component]: "import {Wrap} from './wrap'; export const A=()=> <Wrap className='px-7'/>",
    'apps/sim/components/wrap.tsx':
      "import {Button} from '@sim/emcn'; export const Wrap=({className})=> <Button className={className}/>",
  })
  expect(
    (await inspectInventory(f.source())).findings.some(
      (x) => x.file === component && x.rule === 'component-chrome'
    )
  ).toBe(true)
})

test('separate occurrences remain separate and closure reuse does not multiply them', async () => {
  const f = fixture({
    [component]: "import {Debt} from './debt'; export const A=()=> <><Debt/><Debt/></>",
    'apps/sim/components/debt.tsx':
      "export const Debt=()=> <><p className='text-[#123456]'>A</p><p className='text-[#123456]'>B</p></>",
  })
  const r = await inspectInventory(f.source())
  expect(r.findings).toHaveLength(2)
  expect(groups(r.findings)).toHaveLength(1)
  expect(groups(r.findings)[0].occurrences).toBe(2)
})

test('scope and artwork ownership follow the shared policy', async () => {
  const svg = "export const Art=()=> <svg><path d='M0 0L2 2'/></svg>"
  const f = fixture({
    [component]: svg,
    'packages/emcn/src/icons/glyph.tsx': svg,
    'apps/sim/app/(landing)/page.tsx': text('text-[#ff0000]'),
    'apps/sim/app/(docs)/page.tsx': text('text-[#ff0000]'),
    'apps/docs/app/page.tsx': text('text-[#ff0000]'),
    'apps/sim/app/api/example/route.ts': text('text-[#ff0000]'),
    'apps/sim/components/example.test.tsx': text('text-[#ff0000]'),
    'apps/sim/blocks/provider.ts':
      "export const Block: BlockConfig={type:'provider',category:'tools',bgColor:'#ff0000'}",
  })
  const r = await inspectInventory(f.source())
  expect(r.findings).toHaveLength(1)
  expect(r.findings[0].rule).toBe('central-artwork')
  expect(r.findings[0].file).toBe(component)
})

test('full scan emits one chrome occurrence per owned property across shared passes', () => {
  const f = fixture({
    [component]:
      "import {Button} from '@sim/emcn';export const A=()=> <Button className='rounded-full'>Save</Button>",
  })
  const output = path.join(f.base, 'ownership')
  const result = spawnSync(
    'bun',
    [
      '--no-env-file',
      fileURLToPath(new URL('./scan.ts', import.meta.url)),
      '--repo',
      f.repo,
      '--ref',
      'HEAD',
      '--output',
      output,
    ],
    { encoding: 'utf8' }
  )
  expect(result.status, result.stderr).toBe(1)
  const findings = JSON.parse(readFileSync(path.join(output, 'findings.json'), 'utf8'))
  expect(
    findings.filter(
      (f: { rule: string; file: string; value: string }) =>
        f.file === component && f.rule === 'component-chrome' && f.value === 'rounded-full'
    )
  ).toHaveLength(1)
})

test('registered block swatches are excluded for providers, built-in blocks and triggers', () => {
  const provider = 'apps/sim/blocks/blocks/provider.ts'
  const product = 'apps/sim/blocks/blocks/product.ts'
  const trigger = 'apps/sim/blocks/blocks/trigger.ts'
  const f = fixture({
    [provider]: "export const Provider={category:'tools',bgColor:'#611f69',iconColor:'#611f69'}",
    [product]: "export const Product={category:'blocks',bgColor:'#ff402f'}",
    [trigger]: "export const Trigger={category:'triggers',bgColor:'#2f55ff'}",
  })
  const output = path.join(f.base, 'brand-review')
  const result = spawnSync(
    'bun',
    [
      '--no-env-file',
      fileURLToPath(new URL('./scan.ts', import.meta.url)),
      '--repo',
      f.repo,
      '--ref',
      'HEAD',
      '--output',
      output,
    ],
    { encoding: 'utf8' }
  )
  expect(result.status, result.stderr).toBe(0)
  const items = JSON.parse(readFileSync(path.join(output, 'findings.json'), 'utf8'))
  expect(
    items.some(
      (item: { file: string; rule: string }) =>
        [provider, product, trigger].includes(item.file) && item.rule === 'block-colour'
    )
  ).toBe(false)
})

test('full scan excludes Monaco theme colours but still checks styling beside the editor', () => {
  const f = fixture({
    [component]: `const syntax=[{token:'keyword',foreground:'33b4ff'}];
      monaco.editor.defineTheme('dark',{rules:syntax,colors:{'editor.background':'#1b1b1b'}});
      export const View=()=> <p className='text-[#123456]'>Text</p>`,
  })
  const output = path.join(f.base, 'monaco-review')
  const result = spawnSync(
    'bun',
    [
      '--no-env-file',
      fileURLToPath(new URL('./scan.ts', import.meta.url)),
      '--repo',
      f.repo,
      '--ref',
      'HEAD',
      '--output',
      output,
    ],
    { encoding: 'utf8' }
  )
  expect(result.status, result.stderr).toBe(1)
  const findings = JSON.parse(readFileSync(path.join(output, 'findings.json'), 'utf8'))
  const items = JSON.parse(readFileSync(path.join(output, 'findings.json'), 'utf8'))
  expect(findings.some((finding: { value: string }) => finding.value.includes('#123456'))).toBe(
    true
  )
  expect(findings.some((finding: { value: string }) => finding.value === '#1b1b1b')).toBe(false)
  expect(items.some((item: { rule: string }) => item.rule === 'syntax-colour')).toBe(false)
})

test('full scan excludes verified landing helpers until product imports them', () => {
  const helper = 'apps/sim/lib/content/mdx.tsx'
  const landingMark = 'apps/sim/app/(landing)/components/mark.tsx'
  const f = fixture({
    [helper]: "export const Mdx=()=> <div className='rounded-[13px] text-[13px]' />",
    [landingMark]: 'export const Mark=()=> <span>Logo</span>',
    'apps/sim/app/(landing)/blog/page.tsx':
      "import {Mdx} from '@/lib/content/mdx'; export default function Page(){return <><Mdx/><button className='rounded-[14px]'>Landing</button></>}",
    'apps/sim/app/(docs)/page.tsx':
      "export const Page=()=> <button className='rounded-[14px]'>Docs</button>",
    'apps/sim/components/logo-use.tsx':
      "import {Mark} from '@/app/(landing)/components/mark'; export const LogoUse=()=> <Mark/>",
  })
  const run = (name: string) => {
    const output = path.join(f.base, name)
    const result = spawnSync(
      'bun',
      [
        '--no-env-file',
        fileURLToPath(new URL('./scan.ts', import.meta.url)),
        '--repo',
        f.repo,
        '--ref',
        'HEAD',
        '--output',
        output,
      ],
      { encoding: 'utf8' }
    )
    expect([0, 1], result.stderr).toContain(result.status)
    return {
      findings: JSON.parse(readFileSync(path.join(output, 'findings.json'), 'utf8')) as {
        file: string
      }[],
      unchecked: JSON.parse(readFileSync(path.join(output, 'unchecked.json'), 'utf8')) as {
        file: string
        reason: string
      }[],
      coverage: JSON.parse(readFileSync(path.join(output, 'coverage.json'), 'utf8')) as {
        files: Record<string, number>
      },
      controls: JSON.parse(readFileSync(path.join(output, 'controls.json'), 'utf8')) as {
        records: { file: string }[]
      },
      simplifications: JSON.parse(
        readFileSync(path.join(output, 'simplifications.json'), 'utf8')
      ) as {
        unchecked: { reason: string }[]
      },
    }
  }
  const landingOnly = run('landing-only')
  expect(landingOnly.findings.some((finding) => finding.file === helper)).toBe(false)
  expect(landingOnly.findings.some((finding) => finding.file.includes('(docs)'))).toBe(false)
  expect(landingOnly.coverage.files.excluded).toBeGreaterThanOrEqual(3)
  expect(
    landingOnly.controls.records.some(
      (record) => record.file.includes('(landing)') || record.file.includes('(docs)')
    )
  ).toBe(false)
  expect(
    landingOnly.simplifications.unchecked.some((item) =>
      item.reason.includes('apps/sim/app/(landing)/components/mark:missing')
    )
  ).toBe(false)
  mkdirSync(path.dirname(path.join(f.repo, component)), { recursive: true })
  writeFileSync(
    path.join(f.repo, component),
    "import {Mdx} from '@/lib/content/mdx'; export const Product=()=> <Mdx/>"
  )
  f.git('add', '.')
  f.git('commit', '-qm', 'product adopts helper')
  const productOwned = run('product-owned')
  expect(productOwned.findings.some((finding) => finding.file === helper)).toBe(false)
  expect(
    productOwned.unchecked.some(
      (note) => note.file === component && note.reason.includes('excluded landing source')
    )
  ).toBe(true)
})

test('rendered HTML and SVG visible text retain typography checks', async () => {
  const f = fixture({
    [component]:
      "export const A=()=> <><div dangerouslySetInnerHTML={{__html:'<p style=\"color:#123456\">Text</p>'}}/><svg><text fontSize='13'>Label</text></svg></>",
  })
  const r = await inspectInventory(f.source())
  expect(r.findings.some((x) => x.rule === 'central-colour')).toBe(true)
  expect(r.findings.some((x) => x.rule === 'central-typography')).toBe(true)
})

test('opaque helpers and cycles remain unchecked while nearby literal debt is found', async () => {
  const f = fixture({
    [component]:
      "import {theme} from './a'; export const A=()=> <p className={unknown(theme)} style={{color:'#123456'}}>Text</p>",
    'apps/sim/components/a.ts': "export {theme} from './b'",
    'apps/sim/components/b.ts': "export {theme} from './a'",
  })
  const r = await inspectInventory(f.source())
  expect(r.findings.some((x) => x.rule === 'central-colour')).toBe(true)
  expect(r.unchecked.length).toBeGreaterThan(0)
})

test('oversized source and symlinks are unchecked, and source/config/plugins are not executed', async () => {
  const f = fixture({
    [component]: text('text-[#123456]'),
    'apps/sim/components/large.tsx': ' '.repeat(2 * 1024 * 1024 + 1),
  })
  const marker = path.join(f.base, 'MUST-NOT-EXIST')
  writeFileSync(
    path.join(f.repo, 'apps/sim/components/danger.tsx'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad'); ${text('text-[#234567]')}`
  )
  writeFileSync(
    path.join(f.repo, 'apps/sim/postcss.config.mjs'),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad'); export default {plugins:[()=>{throw new Error('executed')}]}`
  )
  symlinkSync('example.tsx', path.join(f.repo, 'apps/sim/components/link.tsx'))
  f.git('add', '.')
  f.git('commit', '-qm', 'synthetic limits')
  const r = await inspectInventory(f.source())
  expect(existsSync(marker)).toBe(false)
  expect(r.coverage.files.oversized).toBe(1)
  expect(r.coverage.files.nonRegular).toBe(1)
  expect(r.findings.length).toBeGreaterThanOrEqual(2)
})

test('reverse traversal and progress batches produce identical inventories', async () => {
  const f = fixture({
    [component]: text('text-[#123456]'),
    'apps/sim/components/b.tsx': text('text-[13px]'),
  })
  const a = await inspectInventory(f.source(), { order: 'forward', batchSize: 1 })
  const b = await inspectInventory(f.source(), { order: 'reverse', batchSize: 100 })
  expect(JSON.stringify(b)).toBe(JSON.stringify(a))
})

test('modal ancestry crosses a forward closure and a valid field wrapper remains exempt', async () => {
  const entry = 'apps/sim/components/entry.tsx'
  const code =
    "import {ChipModalBody} from '@sim/emcn'; import {Entry} from './entry'; export const A=()=> <ChipModalBody><Entry/></ChipModalBody>"
  const f = fixture({
    [component]: code,
    [entry]:
      "import {Label,ChipInput} from '@sim/emcn'; export function Entry(){return <div><div><Label>Thing</Label></div><section><ChipInput/></section></div>}",
  })
  const r = await inspectInventory(f.source())
  expect(
    r.findings.some(
      (x) => x.file === entry && x.rule === 'modal-field' && x.reason.includes('components/example')
    )
  ).toBe(true)
  writeFileSync(
    path.join(f.repo, component),
    code
      .replace('{ChipModalBody}', '{ChipModalBody,ChipModalField}')
      .replace('<Entry/>', '<ChipModalField type="custom" title="Thing"><Entry/></ChipModalField>')
  )
  f.git('add', '.')
  f.git('commit', '-qm', 'synthetic field ownership fix')
  expect((await inspectInventory(f.source())).findings.some((x) => x.rule === 'modal-field')).toBe(
    false
  )
})

test('shared index resolves more than 64 modules and is independent of traversal', async () => {
  const files: Record<string, string> = {}
  const imports: string[] = []
  const children: string[] = []
  for (let i = 0; i < 70; i++) {
    const name = `c${String(i).padStart(2, '0')}`
    files[`apps/sim/components/${name}.ts`] = `export const colour='#123456'`
    imports.push(`import {colour as ${name}} from './${name}'`)
    children.push(`<p style={{color:${name}}}>Text</p>`)
  }
  files[component] =
    `${imports.join(';')}; export const A=()=> <>${children.join('')}<p style={{color:'#abcdef'}}>Known</p></>`
  const f = fixture(files)
  const a = await inspectInventory(f.source(), { order: 'forward' })
  const b = await inspectInventory(f.source(), { order: 'reverse', batchSize: 1 })
  expect(a.unchecked.some((x) => x.reason.includes('module limit'))).toBe(false)
  expect(a.findings.some((x) => x.file === component && x.value.includes('#123456'))).toBe(true)
  expect(a.findings.some((x) => x.value.includes('#abcdef'))).toBe(true)
  expect(JSON.stringify(b)).toBe(JSON.stringify(a))
})

test('only committed blobs are inspected, including in shallow snapshot checkouts', async () => {
  const f = fixture({ [component]: text('font-mono') })
  const before = f.git('status', '--porcelain')
  writeFileSync(path.join(f.repo, component), text('text-[#123456]'))
  f.git('add', component)
  expect((await inspectInventory(f.source())).findings).toEqual([])
  const clone = path.join(f.base, 'shallow')
  execFileSync('git', ['clone', '-q', '--depth=1', `file://${f.repo}`, clone])
  expect((await inspectInventory(new GitSource(clone, 'HEAD'))).findings).toEqual([])
  expect(before).toBe('')
  expect(f.git('status', '--porcelain')).toContain(component)
})

test('missing required central source and invalid revisions fail operationally', async () => {
  const f = fixture({ [component]: text('font-mono') }, false)
  await expect(inspectInventory(f.source())).rejects.toThrow('Required central globals.css')
  expect(() => new GitSource(f.repo, 'not-a-ref')).toThrow('Git operation failed')
})

test('CSV formulas and output paths cannot modify the source checkout', () => {
  const f = fixture()
  expect(csv([['=1+1', '"quote"', 'line\nnext']])).toBe('"\'=1+1","""quote""","line\nnext"\n')
  expect(() => validateOutput(path.join(f.repo, 'output'), f.repo)).toThrow('outside')
  const alias = path.join(f.base, 'alias')
  symlinkSync(f.repo, alias)
  expect(() => validateOutput(path.join(alias, 'output'), f.repo)).toThrow('outside')
  expect(() => validateOutput(f.base, f.repo)).toThrow('already exists')
})

test('CLI on synthetic repositories preserves 0/1/2, writes complete reports, and is reproducible in fresh processes', () => {
  const f = fixture({ [component]: text('text-[#123456]') })
  const script = fileURLToPath(new URL('./scan.ts', import.meta.url))
  const run = (args: string[]) =>
    spawnSync('bun', ['--no-env-file', script, ...args], { encoding: 'utf8' })
  const args = ['--repo', f.repo, '--ref', 'HEAD']
  const a = path.join(f.base, 'forward')
  const b = path.join(f.base, 'reverse')
  const status = f.git('status', '--porcelain')
  expect(run([...args, '--output', a]).status).toBe(1)
  expect(run([...args, '--output', b, '--order', 'reverse', '--batch-size', '1']).status).toBe(1)
  for (const name of [
    'findings.json',
    'findings.csv',
    'groups.json',
    'unchecked.json',
    'coverage.json',
    'identity.json',
    'summary.md',
    'triage.csv',
  ])
    expect(readFileSync(path.join(a, name))).toEqual(readFileSync(path.join(b, name)))
  expect(run([...args, '--output', a]).status).toBe(2)
  const bad = path.join(f.base, 'invalid')
  expect(run(['--repo', f.repo, '--ref', 'missing', '--output', bad]).status).toBe(2)
  expect(existsSync(bad)).toBe(false)
  expect(run([]).status).toBe(2)
  const valid = fixture({ [component]: text('font-mono') })
  expect(
    run(['--repo', valid.repo, '--ref', 'HEAD', '--output', path.join(valid.base, 'quiet')]).status
  ).toBe(0)
  expect(f.git('status', '--porcelain')).toBe(status)
}, 60_000)

test.each([
  ['apps/sim/blocks/CLAUDE.md', 0, 'completed'],
  ['apps/sim/components/link.tsx', 2, 'incomplete'],
])(
  'full scanner only treats inspectable source symlinks as failures: %s',
  (file, status, state) => {
    const f = fixture({ [component]: text('font-mono') })
    mkdirSync(path.dirname(path.join(f.repo, file)), { recursive: true })
    symlinkSync('../components/example.tsx', path.join(f.repo, file))
    f.git('add', '.')
    f.git('commit', '-qm', 'synthetic source symlink')
    const output = path.join(f.base, 'symlink-scope')
    const result = spawnSync(
      process.env.DESIGN_TEST_BUN ?? 'bun',
      [
        '--no-env-file',
        fileURLToPath(new URL('./scan.ts', import.meta.url)),
        '--repo',
        f.repo,
        '--ref',
        'HEAD',
        '--output',
        output,
      ],
      { encoding: 'utf8' }
    )
    expect(result.status, result.stderr).toBe(status)
    expect(JSON.parse(readFileSync(path.join(output, 'identity.json'), 'utf8')).status).toBe(state)
    const failures = JSON.parse(readFileSync(path.join(output, 'coverage-failures.json'), 'utf8'))
    expect(failures.some((n: { file: string }) => n.file === file)).toBe(status === 2)
  },
  60_000
)

test.each([
  ['broken syntax', 'export const View=()=> <button', 'Parser failure'],
  ['source limit', `/*${'x'.repeat(2 * 1024 * 1024)}*/`, 'Source exceeds'],
])(
  'full scanner CLI fails incomplete inspection: %s',
  (_label, code, reason) => {
    const f = fixture({ [component]: code })
    const output = path.join(f.base, 'incomplete')
    const result = spawnSync(
      process.env.DESIGN_TEST_BUN ?? 'bun',
      [
        '--no-env-file',
        fileURLToPath(new URL('./scan.ts', import.meta.url)),
        '--repo',
        f.repo,
        '--ref',
        'HEAD',
        '--output',
        output,
      ],
      { encoding: 'utf8' }
    )
    expect(result.status, result.stderr).toBe(2)
    expect(JSON.parse(readFileSync(path.join(output, 'identity.json'), 'utf8')).status).toBe(
      'incomplete'
    )
    expect(
      JSON.parse(readFileSync(path.join(output, 'coverage-failures.json'), 'utf8')).some(
        (n: { file: string; reason: string }) => n.file === component && n.reason.startsWith(reason)
      )
    ).toBe(true)
    expect(readFileSync(path.join(output, 'summary.md'), 'utf8')).toContain(
      'design-conformance/2.0.0'
    )
  },
  60_000
)

test('scanner matches an external review ledger without hiding raw findings', async () => {
  const f = fixture({ [component]: text('text-[#123456]') })
  const raw = await inspectInventory(f.source())
  const ledger = path.join(f.base, 'reviews.json')
  const decision = JSON.stringify({
    version: '1.0.0',
    entries: [
      {
        fingerprint: findingFingerprint(raw.findings[0]),
        status: 'retained-extra',
        rationale: 'Reviewed test treatment',
        evidence: '/external/review',
      },
    ],
  })
  writeFileSync(ledger, decision)
  const script = fileURLToPath(new URL('./scan.ts', import.meta.url))
  const output = path.join(f.base, 'with-reviews')
  const result = spawnSync(
    'bun',
    [
      '--no-env-file',
      script,
      '--repo',
      f.repo,
      '--ref',
      'HEAD',
      '--output',
      output,
      '--reviews',
      ledger,
    ],
    { encoding: 'utf8' }
  )
  expect(result.status, result.stderr).toBe(1)
  const findings = JSON.parse(readFileSync(path.join(output, 'findings.json'), 'utf8'))
  const reviews = JSON.parse(readFileSync(path.join(output, 'review-decisions.json'), 'utf8'))
  expect(findings).toContainEqual(expect.objectContaining({ value: 'text-[#123456]' }))
  expect(reviews.matches).toHaveLength(1)
  const internal = path.join(f.repo, 'reviews.json')
  writeFileSync(internal, decision)
  expect(
    spawnSync('bun', [
      '--no-env-file',
      script,
      '--repo',
      f.repo,
      '--ref',
      'HEAD',
      '--output',
      path.join(f.base, 'invalid-reviews'),
      '--reviews',
      internal,
    ]).status
  ).toBe(2)
})

test('control associations use actual frozen findings, canonical identity and the innermost slot', async () => {
  const { inspectControls } = await import('#control-analysis/inventory')
  const f = fixture({
    [component]: `import {Button as Save} from '@sim/emcn'; import * as E from '@sim/emcn';
export const A=()=> <><Save className='h-[37px]'/><E.Button className='h-[43px]' endAdornment={<span className='text-[13px]'/>}/></>`,
  })
  let controls: ReturnType<typeof inspectControls> | undefined
  const inv = await inspectInventory(f.source(), {
    withSourceIndex: (index, findings) => {
      controls = inspectControls(f.source(), findings, 'forward', index)
    },
  })
  if (!controls) throw new Error('Control callback missing')
  const rs = controls.records.filter((r) => r.file === component)
  expect(rs).toHaveLength(2)
  for (const r of rs) {
    expect(r.findingIds.length).toBeGreaterThan(0)
    expect(r.potentialFindingIds).toEqual([])
    expect(r.findingIds.map((id) => inv.findings.find((f) => f.id === id)?.value)).toEqual([
      r.tag === 'Save' ? 'h-[37px]' : 'h-[43px]',
    ])
  }
  const child = inv.findings.find((f) => f.value === 'text-[13px]')
  if (!child) throw new Error('Expected child finding')
  expect(
    rs.every((r) => !r.findingIds.includes(child.id) && !r.potentialFindingIds.includes(child.id))
  ).toBe(true)
})

test('full CLI connects colour assignment proof to usage and retains unsafe writers', () => {
  const css = 'apps/sim/components/shimmer.module.css'
  const f = fixture({
    [component]: `export const A=()=> <span className='[--rest:var(--text-body)]'>Thinking</span>`,
    [css]: '.label { color: var(--rest, var(--text-body)); }',
  })
  const script = fileURLToPath(new URL('./scan.ts', import.meta.url))
  const run = (name: string) => {
    const output = path.join(f.base, name)
    const result = spawnSync(
      'bun',
      ['--no-env-file', script, '--repo', f.repo, '--ref', 'HEAD', '--output', output],
      { encoding: 'utf8' }
    )
    expect([0, 1], result.stderr).toContain(result.status)
    return {
      findings: JSON.parse(readFileSync(path.join(output, 'findings.json'), 'utf8')) as {
        rule: string
      }[],
      colours: JSON.parse(readFileSync(path.join(output, 'colour-assignments.json'), 'utf8')),
    }
  }
  const valid = run('valid-alias')
  expect(valid.findings.filter((finding) => finding.rule === 'central-colour')).toEqual([])
  expect(valid.colours.verifiedUsages).toHaveLength(1)
  expect(valid.colours.verifiedUsages[0].references).toContain('--text-body')
  writeFileSync(
    path.join(f.repo, component),
    `export const A=()=> <span style={{'--rest':'hotpink'}}>Thinking</span>`
  )
  f.git('add', '.')
  f.git('commit', '-qm', 'bad writer')
  const invalid = run('invalid-alias')
  expect(invalid.colours.verifiedUsages).toEqual([])
  expect(invalid.findings.some((finding) => finding.rule === 'central-colour')).toBe(true)
  expect(invalid.findings.some((finding) => finding.rule === 'central-colour-assignment')).toBe(
    true
  )
})

test('shadowed renderers and lost location evidence never receive direct central associations', async () => {
  const { inspectControls } = await import('#control-analysis/inventory')
  const f = fixture({
    [component]: `import {Button} from '@sim/emcn'; export function A({Button}){return <Button onClick={()=>{}} className='h-[37px]'/>} export const B=()=> <Button className='h-[43px]'/>`,
  })
  const inv = await inspectInventory(f.source())
  const rs = inspectControls(f.source(), inv.findings).records.filter((r) => r.file === component)
  expect(rs[0].origin).toBe('unresolved')
  expect(rs[0].findingIds).toEqual([])
  const moved = inv.findings
    .filter((f) => f.context.startsWith('B /'))
    .map((f) => ({ ...f, column: 1 }))
  const potential = inspectControls(f.source(), moved).records.find((r) => r.owner === 'B')
  if (!potential) throw new Error('Expected control B')
  expect(potential.findingIds).toEqual([])
  expect(potential.potentialFindingIds.length).toBeGreaterThan(0)
})

test('central recipe appearance never grants renderer ownership or approves later overrides', async () => {
  const { inspectControls } = await import('#control-analysis/inventory')
  const f = fixture({
    'packages/emcn/src/components/button/button.tsx': `import {cva} from 'class-variance-authority';export const buttonVariants=cva('rounded-lg',{variants:{size:{sm:'h-5'}},defaultVariants:{size:'sm'}});export const Button=()=> <button/>`,
    [component]: `import {buttonVariants as style} from '@sim/emcn';export const A=()=> <button className={style({size:'sm'})} style={{backgroundColor:'#123456'}}/>`,
  })
  let records: ReturnType<typeof inspectControls>['records'] = []
  const inv = await inspectInventory(f.source(), {
    withSourceIndex: (index, findings, system) => {
      records = inspectControls(f.source(), findings, 'forward', index, system.resolve).records
    },
  })
  const r = records.find((r) => r.file === component)
  expect(r?.origin).toBe('local-control')
  expect(r?.appearance.centralRecipes.length).toBeGreaterThan(0)
  expect(inv.findings.length).toBeGreaterThan(0)
  expect(r?.findingIds.length).toBeGreaterThan(0)
})

test('public scanner reports layout separately while retaining chrome and unknown spreads', () => {
  const f = fixture({
    ...testComponents,
    [component]: `import {ChipModalField as Field,ChipModal} from '@sim/emcn'; export const View=({props})=> <><Field className='flex-1 p-4 flex-row' {...props}/><ChipModal className='h-[90vh]'/></>`,
  })
  const output = path.join(f.base, 'layout-output')
  const result = spawnSync(
    'bun',
    [
      '--no-env-file',
      fileURLToPath(new URL('./scan.ts', import.meta.url)),
      '--repo',
      f.repo,
      '--ref',
      'HEAD',
      '--output',
      output,
    ],
    { encoding: 'utf8' }
  )
  expect(result.status, result.stderr).toBe(1)
  const allowances = JSON.parse(readFileSync(path.join(output, 'layout-allowances.json'), 'utf8'))
  const findings = JSON.parse(readFileSync(path.join(output, 'findings.json'), 'utf8'))
  expect(allowances).toHaveLength(2)
  expect(findings.some((f: { value: string }) => f.value === 'p-4')).toBe(true)
  expect(findings.some((f: { value: string }) => f.value === 'flex-row')).toBe(true)
  expect(
    JSON.parse(readFileSync(path.join(output, 'unchecked.json'), 'utf8')).length
  ).toBeGreaterThan(0)
})

test('central token resolution gaps remain visible even with no consumer findings', async () => {
  const f = fixture({ [globals]: ':root{--a:var(--b);--b:var(--a)}' })
  const result = await inspectInventory(f.source())
  expect(result.unchecked.some((n) => n.file === globals && /cycle/i.test(n.reason))).toBe(true)
})
