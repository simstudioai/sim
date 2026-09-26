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
}, 60_000)

test('nested finite style lookups own only the selected slot chrome', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    `
import type {HTMLAttributes} from 'react'
const styles={content:'rounded-xl p-2',size:{sm:{item:'h-6 text-xs'},md:{item:'h-8 text-sm'}},scheme:{light:{content:'bg-white',label:'text-black'},dark:{content:'bg-black',label:'text-white'}}}
interface Props extends HTMLAttributes<HTMLDivElement>{scheme?:'light'|'dark'}
export function Example({className,scheme='light',...props}:Props){return <div {...props} className={cn(styles.content,styles.scheme[scheme].content,className)}/>}
declare function cn(...args:unknown[]):string
`
  )
  const result = run(root)
  expect(result.status, result.stderr).toBe(0)
  expect(generated(root).exports.Example.slots.className.protected).toEqual([
    'background-color',
    'border-radius',
    'padding',
  ])
}, 60_000)

test('styling forwarded through a barrel inherits the implementation ownership', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/index.ts',
    "export * from './components/example';export * from './components/wrapper'"
  )
  write(
    root,
    'packages/emcn/src/components/wrapper.tsx',
    `
import {Example} from '../index'
export function Wrapper({className}:{className?:string}){return <Example className={className}/>}
`
  )
  const result = run(root)
  expect(result.status, result.stderr).toBe(0)
  expect(generated(root).exports.Wrapper.slots.className.protected).toContain('border-radius')
  expect(
    generated(root).diagnostics.some((d: { reason: string }) =>
      d.reason.includes('Wrapper.className')
    )
  ).toBe(false)
}, 60_000)

test('rest forwarding keeps separately consumed class and style inputs apart', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    `
import type {HTMLAttributes} from 'react'
export function Leaf({className,...props}:HTMLAttributes<HTMLDivElement>){return <div {...props} className={cn('rounded-xl',className)}/>}
export function Other({className,...props}:HTMLAttributes<HTMLDivElement>){return <div {...props} className={cn('h-12',className)}/>}
export function Example({className,...rest}:HTMLAttributes<HTMLDivElement>){return <><Leaf className={className}/><Other {...rest}/></>}
declare function cn(...args:unknown[]):string
`
  )
  const result = run(root)
  expect(result.status, result.stderr).toBe(0)
  const slots = generated(root).exports.Example.slots
  expect(slots.className.protected).toEqual(['border-radius'])
  expect(slots.style.protected).toEqual(['height'])
}, 60_000)

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
}, 60_000)

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
}, 60_000)

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
}, 60_000)

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
}, 60_000)

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

test('lexical bindings keep unrelated local component and recipe names out of public ownership', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    `
import {cva} from 'class-variance-authority'
const recipe=cva('rounded-md')
export function Example({className}:{className?:string}){return <button className={cn(recipe(),className)}/>}
function helper(){const recipe='h-12';const Example=({className}:{className?:string})=><div className={cn('h-12',className)}/>;return {recipe,Example}}
declare function cn(...args:unknown[]):string
`
  )
  expect(run(root).status).toBe(0)
  expect(generated(root).exports.Example.slots.className.protected).toEqual(['border-radius'])
}, 60_000)

test.each(['barrel', 'namespace'])(
  'imported %s recipes retain ownership and defaults',
  (mode) => {
    const root = fixture()
    write(
      root,
      'packages/emcn/src/components/recipe.ts',
      `import {cva} from 'class-variance-authority';export const recipe=cva('rounded-md',{variants:{variant:{plain:'border-0',filled:'border-2'}},defaultVariants:{variant:'filled'}})`
    )
    write(root, 'packages/emcn/src/components/recipes.ts', "export {recipe} from './recipe'")
    write(
      root,
      'packages/emcn/src/components/example.tsx',
      `${mode === 'barrel' ? "import {recipe} from './recipes'" : "import * as recipes from './recipes'"}
export function Example({className,variant}:{className?:string;variant?:'plain'|'filled'}){return <button className={cn(${mode === 'barrel' ? 'recipe' : 'recipes.recipe'}({variant}),className)}/>}
declare function cn(...args:unknown[]):string`
    )
    expect(run(root).status).toBe(0)
    const entry = generated(root).exports.Example
    expect(entry.slots.className.protected).toContain('border-radius')
    expect(entry.variants.variant.default).toBe('filled')
    expect(generated(root).diagnostics).toEqual([])
  },
  60_000
)

test.each(['jsx', 'bundle', 'createElement'])(
  'finite %s aliases and bundles preserve ownership across class and style channels',
  (mode) => {
    const root = fixture()
    write(
      root,
      'packages/emcn/src/components/example.tsx',
      `import {createElement} from 'react'
interface Props{innerClassName?:string;innerStyle?:{color?:string}}
export function Example({innerClassName,innerStyle}:Props){
const classes=cn('rounded-md',innerClassName);const chrome={color:'red'};const styles={...chrome,...innerStyle};const attrs={className:classes,style:styles};
return ${mode === 'jsx' ? '<div className={classes} style={styles}/>' : mode === 'bundle' ? '<div {...attrs}/>' : "createElement('div',attrs)"}
}
declare function cn(...args:unknown[]):string`
    )
    expect(run(root).status).toBe(0)
    const slots = generated(root).exports.Example.slots
    expect(slots.innerClassName.protected).toEqual(['border-radius', 'color'])
    expect(slots.innerStyle.protected).toEqual(['border-radius', 'color'])
  },
  60_000
)

test('finite bound CVA config and spreads retain axes, chrome and recipe defaults', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    `import {cva} from 'class-variance-authority'
const axes={variant:{plain:'border-0',filled:'border-2'}};const defaults={variant:'filled'} as const;const config={variants:{...axes},defaultVariants:{...defaults}} as const;const recipe=cva('rounded-md',config)
export function Example({className,variant}:{className?:string;variant?:'plain'|'filled'}){return <div className={cn(recipe({variant}),className)}/>};declare function cn(...args:unknown[]):string`
  )
  expect(run(root).status).toBe(0)
  const metadata = generated(root)
  expect(metadata.exports.Example.variants.variant.default).toBe('filled')
  expect(metadata.exports.Example.slots.className.protected).toContain('border-width')
}, 60_000)

test.each(['constant', 'body'])(
  'component %s defaults override recipe defaults',
  (mode) => {
    const root = fixture()
    const source = component().replace("variant:'plain',size:'sm'", "variant:'filled',size:'sm'")
    write(
      root,
      'packages/emcn/src/components/example.tsx',
      mode === 'constant'
        ? source.replace(
            "export function Example({className,variant='plain'",
            "const DEFAULT='plain' as const;export function Example({className,variant=DEFAULT"
          )
        : source.replace(
            "export function Example({className,variant='plain',size='sm',...props}:Props){",
            "export function Example(input:Props){const {className,variant='plain',size='sm',...props}=input;"
          )
    )
    expect(run(root).status).toBe(0)
    expect(generated(root).exports.Example.variants.variant.default).toBe('plain')
  },
  60_000
)

test('public declaration files participate in finite prop extraction and staleness', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/index.ts',
    "export * from './components/example';export type {Props} from './components/props'"
  )
  write(
    root,
    'packages/emcn/src/components/props.d.ts',
    "export interface Props{className?:string;variant?:'plain'|'filled'}"
  )
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    "import type {Props} from './props';export function Example({className,variant='plain'}:Props){return <div className={cn('rounded-md',className)}/>};declare function cn(...args:unknown[]):string"
  )
  expect(run(root).status).toBe(0)
  expect(generated(root).exports.Example.variants.variant.values).toEqual(['filled', 'plain'])
  write(
    root,
    'packages/emcn/src/components/props.d.ts',
    "export interface Props{className?:string;variant?:'plain'|'filled'|'new'}"
  )
  expect(run(root, '--check').status).toBe(1)
}, 60_000)

test.each([
  "import type {Props} from '../absent';export function Example({className}:Props){return <button className={className}/>} ",
  'interface Props extends Missing{className?:string};export function Example({className}:Props){return <button className={className}/>} ',
])(
  'unresolved public props preserve unchecked styling inputs: %s',
  (source) => {
    const root = fixture()
    write(root, 'packages/emcn/src/components/example.tsx', source)
    expect(run(root).status).toBe(0)
    const metadata = generated(root)
    expect(
      metadata.diagnostics.some((d: { reason: string }) =>
        /public props.*unchecked/i.test(d.reason)
      )
    ).toBe(true)
    expect(metadata.exports.Example.slots.className.unchecked.join('\n')).toMatch(/public props/i)
  },
  60_000
)

test('unrelated unresolved data imports do not invalidate known public props', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    "import {data} from '../absent';export function Example({className}:{className?:string}){return <button className={className}/>};export const exampleData=data"
  )
  expect(run(root).status).toBe(0)
  expect(generated(root).diagnostics).toEqual([])
  expect(generated(root).exports.Example.slots.className.unchecked).toBeUndefined()
}, 60_000)

test.each(['missing', 'ambiguous'])(
  'invalid %s public symbols fail extraction',
  (mode) => {
    const root = fixture()
    write(root, 'packages/emcn/src/components/other.tsx', 'export const Example=()=> <div/>')
    write(
      root,
      'packages/emcn/src/index.ts',
      mode === 'missing'
        ? "export {Missing} from './components/example'"
        : "export * from './components/example';export * from './components/other'"
    )
    const result = run(root)
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/public export/i)
  },
  60_000
)

test('unresolved styling calls remain explicit unchecked evidence', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    'export function Example({className}:{className?:string}){return <div className={cn(styleFactory(),className)}/>};declare function styleFactory():string;declare function cn(...args:unknown[]):string'
  )
  expect(run(root).status).toBe(0)
  expect(
    generated(root).diagnostics.some((d: { reason: string }) => /styling call/i.test(d.reason))
  ).toBe(true)
}, 60_000)

test('ownership metadata rejects longhand permissions overlapping a protected family', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    component(
      '\n * @designAllow className border-top-color\n * @designProtect className border-color\n'
    )
  )
  const result = run(root)
  expect(result.status).toBe(2)
  expect(result.stderr).toMatch(/contradictory/i)
}, 60_000)

test('ownership metadata permits independent physical longhands', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    component(
      '\n * @designAllow className padding-left\n * @designProtect className padding-right\n'
    )
  )
  const result = run(root)
  expect(result.status, result.stderr).toBe(0)
  const slot = generated(root).exports.Example.slots.className
  expect(slot.allowed).toEqual(['padding-left'])
  expect(slot.protected).toContain('padding-right')
}, 60_000)

test.each([
  ['font-size', 'font'],
  ['border-top-color', 'border'],
])(
  'ownership metadata rejects %s permission overlapping %s shorthand',
  (allowed, protectedProperty) => {
    const root = fixture()
    write(
      root,
      'packages/emcn/src/components/example.tsx',
      component(
        `\n * @designAllow className ${allowed}\n * @designProtect className ${protectedProperty}\n`
      )
    )
    const result = run(root)
    expect(result.status, result.stderr).toBe(2)
    expect(result.stderr).toMatch(/contradictory/i)
  },
  60_000
)

test('token cycles require matching finite CSS contexts and cross-context availability stays unchecked', () => {
  const root = fixture()
  write(
    root,
    'apps/sim/app/_styles/globals.css',
    ':root{--a:var(--b);--b:red}.dark{--a:blue;--b:var(--a)}@theme{--bridge:var(--a)}'
  )
  expect(run(root).status).toBe(0)
  const notes = generated(root)
    .diagnostics.map((d: { reason: string }) => d.reason)
    .join('\n')
  expect(notes).not.toMatch(/alias cycle/i)
  expect(notes).toMatch(/context.*unchecked/i)
}, 60_000)

test('mutated styling bindings remain unchecked instead of freezing their initializer', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    "export function Example({className}:{className?:string}){let classes='rounded-md';classes=styleFactory();return <div className={cn(classes,className)}/>};declare function styleFactory():string;declare function cn(...args:unknown[]):string"
  )
  expect(run(root).status).toBe(0)
  expect(
    generated(root).exports.Example.slots.className.unchecked.some((reason: string) =>
      /mutable|mutated/i.test(reason)
    )
  ).toBe(true)
}, 60_000)

test('generated unresolved ownership reaches the consumer CLI after regeneration', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    'export function Example({className}:{className?:string}){return <div className={cn(styleFactory(),className)}/>};declare function styleFactory():string;declare function cn(...args:unknown[]):string'
  )
  write(
    root,
    'apps/sim/components/use-example.tsx',
    "import {Example} from '@sim/emcn';export const View=()=> <Example className='rounded-full'/>"
  )
  expect(run(root).status).toBe(0)
  expect(generated(root).exports.Example.slots.className.unchecked.join('\n')).toMatch(
    /styling call/i
  )
  const result = spawnSync(
    bun,
    [
      '--no-env-file',
      checkCli,
      '--repo',
      root,
      '--base',
      'HEAD',
      '--working-tree',
      '--format',
      'json',
    ],
    { encoding: 'utf8', timeout: 60000 }
  )
  expect(result.status).not.toBe(2)
  const report = JSON.parse(result.stdout)
  expect(report.infrastructure.fresh).toBe(true)
  expect(
    report.unchecked.some(
      (note: { file: string; reason: string }) =>
        note.file === 'apps/sim/components/use-example.tsx' && /styling call/i.test(note.reason)
    )
  ).toBe(true)
}, 60_000)

test.each(['private', 'delegated'])(
  '%s unsupported styling ownership reaches the public slot',
  (mode) => {
    const root = fixture()
    write(
      root,
      'packages/emcn/src/components/example.tsx',
      mode === 'private'
        ? "declare const Dynamic:(props:{className?:string})=>React.ReactNode;function Private({className}:{className?:string}){return <Dynamic className={className}/>};export function Example({className}:{className?:string}){return <Private className={className}/>};import type React from 'react'"
        : "export declare function Example(props:{className?:string}):React.ReactNode;import type React from 'react'"
    )
    expect(run(root).status).toBe(0)
    expect(generated(root).exports.Example.slots.className.unchecked?.length ?? 0).toBeGreaterThan(
      0
    )
  },
  60_000
)

test('source custom classes retain unchecked ownership when no declarative utility is known', () => {
  const root = fixture()
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    "export function Example({className}:{className?:string}){return <div className={cn('custom-chrome',className)}/>};declare function cn(...args:unknown[]):string"
  )
  expect(run(root).status).toBe(0)
  expect(generated(root).exports.Example.slots.className.unchecked?.join('\n') ?? '').toMatch(
    /custom-chrome/
  )
}, 60_000)

test('private lexical forwarding references stay stable across source line shifts', () => {
  const root = fixture()
  const source =
    "export function Example({className}:{className?:string}){const Inner=({className}:{className?:string})=><div className={cn('rounded-md',className)}/>;return <Inner className={className}/>};declare function cn(...args:unknown[]):string"
  write(root, 'packages/emcn/src/components/example.tsx', source)
  expect(run(root).status).toBe(0)
  const before = generated(root).exports.Example.slots.className
  write(
    root,
    'packages/emcn/src/components/example.tsx',
    source.replace('const Inner', '\n\nconst Inner')
  )
  expect(run(root).status).toBe(0)
  expect(generated(root).exports.Example.slots.className).toEqual(before)
}, 60_000)
