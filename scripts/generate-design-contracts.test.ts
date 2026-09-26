import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

const roots: string[] = []
const cli = path.resolve('scripts/generate-design-contracts.ts')
const artifact = 'scripts/design-conformance/contracts.generated.json'
const checkCli = path.resolve('scripts/check-design-conformance.ts')
const bun = process.env.DESIGN_TEST_BUN ?? 'bun'
function write(root: string, file: string, source: string) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  writeFileSync(path.join(root, file), source)
}
function git(root: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'design-generate-'))
  roots.push(root)
  git(root, 'init', '-q')
  write(
    root,
    'apps/sim/app/_styles/globals.css',
    ':root{--brand:#abc;--alias:var(--brand)}.dark{--brand:#def}'
  )
  write(root, 'packages/emcn/src/index.ts', "export * from './components/example'\n")
  write(root, 'packages/emcn/src/components/example.tsx', component())
  git(root, 'add', '.')
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base')
  return root
}
function component(annotation = '', colour = 'bg-[var(--brand)]') {
  return `import { cva } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
const recipe=cva('rounded-md ${colour}',{variants:{variant:{plain:'border-0',filled:'border-2',private:'border-4'},size:{sm:'h-6',lg:'h-10'}},defaultVariants:{variant:'plain',size:'sm'}})
interface Props extends HTMLAttributes<HTMLButtonElement>{variant?:'plain'|'filled';size?:'sm'|'lg'}
/** Example. ${annotation} */
export function Example({className,variant='plain',size='sm',...props}:Props){return <button {...props} className={cn(recipe({variant,size}),className)} />}
declare function cn(...args:unknown[]):string
throw new Error('Do not execute product modules')`
}
function run(root: string, ...args: string[]) {
  return spawnSync(bun, ['--no-env-file', cli, '--repo', root, ...args], {
    encoding: 'utf8',
    timeout: 60000,
  })
}
function generated(root: string) {
  return JSON.parse(readFileSync(path.join(root, artifact), 'utf8'))
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('CLI discovers new APIs, narrows recipe variants to public props and is byte deterministic', () => {
  const root = fixture()
  const first = run(root)
  expect(first.status, first.stderr).toBe(0)
  const bytes = readFileSync(path.join(root, artifact), 'utf8')
  const entry = generated(root).exports.Example
  expect(entry.variants.variant.values).toEqual(['filled', 'plain'])
  expect(entry.variants.size.default).toBe('sm')
  expect(entry.slots.className.protected).toContain('border-radius')
  expect(run(root).status).toBe(0)
  expect(readFileSync(path.join(root, artifact), 'utf8')).toBe(bytes)
  expect(run(root, '--check').status).toBe(0)
  write(root, artifact, '{}')
  expect(run(root, '--check').status).toBe(1)
  expect(readFileSync(path.join(root, artifact), 'utf8')).toBe('{}')
})

test('public namespaces, compound roots and native props stay distinct', () => {
  const root = fixture()
  write(root, 'packages/emcn/src/icons/index.ts', "export {Example} from './example'")
  write(
    root,
    'packages/emcn/src/icons/example.tsx',
    "import type {SVGProps} from 'react';export const Example=({className,...props}:SVGProps<SVGSVGElement>)=><svg {...props} className={className}/>"
  )
  write(
    root,
    'packages/emcn/src/index.ts',
    "export * from './components/example';export {Compound} from './components/compound'"
  )
  write(
    root,
    'packages/emcn/src/components/compound.tsx',
    'export const Compound={Part:()=> <div/>}'
  )
  const outcome = run(root)
  expect(outcome.status, outcome.stderr).toBe(0)
  const metadata = generated(root)
  expect(metadata.exports.Example.kind).toBe('component')
  expect(metadata.exports['icons:Example'].kind).toBe('icon')
  expect(metadata.exports['icons:Example'].slots.fontStyle).toBeUndefined()
  expect(metadata.exports.Compound.kind).toBe('nonvisual')
  expect(metadata.exports['Compound.Part'].kind).toBe('component')
})

test('API lifecycle, reexports and immutable snapshots never read proposed component implementations', () => {
  const root = fixture()
  expect(run(root).status).toBe(0)
  const old = readFileSync(path.join(root, artifact), 'utf8')
  write(
    root,
    'packages/emcn/src/index.ts',
    "export {Example as Renamed} from './components/example'\n"
  )
  write(root, 'packages/emcn/src/components/example.tsx', component('', 'bg-black'))
  expect(run(root, '--check').status).toBe(1)
  expect(run(root, '--ref', 'HEAD').status).toBe(0)
  expect(readFileSync(path.join(root, artifact), 'utf8')).toBe(old)
  expect(run(root).status).toBe(0)
  expect(generated(root).exports.Example).toBeUndefined()
  expect(generated(root).exports.Renamed.slots.className.protected).toContain('background-color')
  write(root, 'packages/emcn/src/index.ts', 'export {}')
  expect(run(root).status).toBe(0)
  expect(Object.keys(generated(root).exports)).toHaveLength(0)
})

test('validated source ownership allows customization and rejects invalid or contradictory metadata', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    component('\n * @designAllow className border-radius\n')
  )
  expect(run(root).status).toBe(0)
  expect(generated(root).exports.Example.slots.className.allowed).toContain('border-radius')
  for (const annotation of [
    '\n * @designAllow className\n',
    '\n * @designProtect missing color\n',
    '\n * @designAllow className nonsense\n',
    '\n * @designAllow className color\n * @designProtect className colours\n',
  ]) {
    write(root, 'packages/emcn/src/components/example.tsx', component(annotation))
    expect(run(root).status).toBe(2)
  }
})

test('broken public imports, parse failures, token cycles and unresolved references remain visible', () => {
  const root = fixture()
  write(
    root,
    'apps/sim/app/_styles/globals.css',
    ':root{--a:var(--b);--b:var(--a);--missing:var(--absent)}'
  )
  expect(run(root).status).toBe(0)
  expect(
    generated(root)
      .diagnostics.map((d: { reason: string }) => d.reason)
      .join('\n')
  ).toMatch(/cycle/i)
  expect(
    generated(root)
      .diagnostics.map((d: { reason: string }) => d.reason)
      .join('\n')
  ).toMatch(/absent/)
  write(root, 'packages/emcn/src/index.ts', "export * from './missing'")
  expect(run(root).status).toBe(2)
  write(root, 'packages/emcn/src/components/example.tsx', 'export const Broken = (')
  expect(run(root).status).toBe(2)
})

test('real working-tree and immutable checks discover ownership without registration and retain originating changes', () => {
  const root = fixture()
  expect(run(root).status).toBe(0)
  git(root, 'add', '.')
  git(
    root,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-qm',
    'generated base'
  )
  const base = git(root, 'rev-parse', 'HEAD')
  write(
    root,
    'packages/emcn/src/components/new.tsx',
    component().replaceAll('Example', 'NewControl')
  )
  write(
    root,
    'packages/emcn/src/index.ts',
    "export * from './components/example';export * from './components/new'"
  )
  git(root, 'add', 'packages/emcn')
  write(
    root,
    'apps/sim/components/new.tsx',
    "import {NewControl} from '@sim/emcn';export const View=()=> <NewControl className='rounded-full'/>"
  )
  const check = (...args: string[]) => {
    const result = spawnSync(
      bun,
      ['--no-env-file', checkCli, '--repo', root, '--base', base, '--format', 'json', ...args],
      { encoding: 'utf8', timeout: 60000 }
    )
    return { exit: result.status, report: JSON.parse(result.stdout) }
  }
  const stale = check('--working-tree')
  expect(stale.exit).toBe(1)
  expect(stale.report.infrastructure.fresh).toBe(false)
  expect(
    stale.report.findings.some(
      (f: { rule: string; context: string }) =>
        f.rule === 'component-chrome' && f.context.includes('NewControl')
    )
  ).toBe(true)
  write(
    root,
    'packages/emcn/src/components/new.tsx',
    component('\n * @designAllow className border-radius\n').replaceAll('Example', 'NewControl')
  )
  expect(run(root).status).toBe(0)
  const permitted = check('--working-tree')
  expect(permitted.report.infrastructure.fresh).toBe(true)
  expect(
    permitted.report.findings.some((f: { rule: string }) => f.rule === 'component-chrome')
  ).toBe(false)
  expect(
    permitted.report.findings.some((f: { rule: string }) => f.rule === 'central-definition')
  ).toBe(true)
  git(root, 'add', '.')
  git(
    root,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-qm',
    'new control'
  )
  const head = git(root, 'rev-parse', 'HEAD')
  const immutable = check('--head', head)
  write(root, 'packages/emcn/src/components/new.tsx', 'export const Broken = (')
  expect(check('--head', head).report.findings).toEqual(immutable.report.findings)
  expect(check('--working-tree').exit).toBe(2)
  expect(check('--working-tree').report.status).toBe('failed')
}, 60000)
