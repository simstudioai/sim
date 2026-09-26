import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { inspectControls } from '#control-analysis/inventory'
import { inspectTypography } from '#control-analysis/typography'
import { GitSource } from '#design-conformance/worktree-source'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const location = 'apps/sim/components/example.tsx'
function fixture(files: Record<string, string>) {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'control-origin-test-'))
  dirs.push(repo)
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim()
  git('init', '-q')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  const write = (name: string, code: string) => {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true })
    writeFileSync(path.join(repo, name), code)
  }
  for (const [name, code] of Object.entries({
    'packages/emcn/src/index.ts': "export * from './components/button/button'",
    'packages/emcn/src/components/button/button.tsx':
      "export const Button=()=> <button/>; export const chipVariants=()=> 'central classes'",
    ...files,
  }))
    write(name, code)
  git('add', '.')
  git('commit', '-qm', 'fixture')
  return {
    repo,
    git,
    write,
    source: () => new GitSource(repo, 'HEAD'),
    scan: () => inspectControls(new GitSource(repo, 'HEAD'), []),
  }
}
const consumer = (r: ReturnType<typeof inspectControls>) =>
  r.records.filter((x) => x.file === location)

test('direct imports and named aliases preserve real EMCN origin', () => {
  const f = fixture({
    [location]:
      "import {Button as Save} from '@sim/emcn'; export const A=()=> <Save variant='primary'>Save</Save>",
  })
  expect(consumer(f.scan())).toHaveLength(1)
  expect(consumer(f.scan())[0].origin).toBe('emcn-component')
  expect(consumer(f.scan())[0].inputs.variant.values).toEqual(['primary'])
})
test('namespace imports, re-exports, static aliases and default behavioral wrappers are followed', () => {
  const f = fixture({
    [location]: "import Save from './wrap'; export const A=()=> <Save/>",
    'apps/sim/components/wrap.tsx':
      "import * as E from './barrel'; import {memo,forwardRef} from 'react'; const Alias=E.Button; export default memo(forwardRef((props,ref)=> <Alias {...props} ref={ref}/>))",
    'apps/sim/components/barrel.ts': "export {Button} from '@sim/emcn'",
  })
  expect(consumer(f.scan())[0].origin).toBe('emcn-component')
  expect(consumer(f.scan())[0].authoredAt.some((v) => v.includes('/wrap.tsx'))).toBe(true)
})
test('shadowed imports cannot grant EMCN origin', () => {
  const f = fixture({
    [location]:
      "import {Button} from '@sim/emcn'; export function A({Button}){return <Button onClick={()=>{}}/>}",
  })
  expect(consumer(f.scan())[0].origin).toBe('unresolved')
})
test('local native controls, semantic roles and standalone navigation remain discoverable', () => {
  const f = fixture({
    [location]:
      "export const A=()=> <><button/><div role='tab'/><input type='checkbox'/><a href='/x'>Go</a><select/><summary>Open</summary><input type='text'/><p>Text</p></>",
  })
  const r = consumer(f.scan())
  expect(r).toHaveLength(6)
  expect(r.every((v) => v.origin === 'local-control')).toBe(true)
})
test('central token use does not authorize a separately implemented button', () => {
  const f = fixture({
    [location]:
      "import {cn} from '@sim/emcn'; export const A=()=> <button className={cn('text-[var(--text-body)]')}/>",
  })
  expect(consumer(f.scan())[0].origin).toBe('local-control')
})
test('noninteractive roles and input change handlers are not button evidence', () => {
  const f = fixture({
    [location]:
      "const Field=()=> <input type='text'/>; export const A=()=> <><p role='alert'/><div role='status'/><Field onChange={()=>{}}/><div onClick={()=>{}}/></>",
  })
  expect(consumer(f.scan()).map((r) => [r.tag, r.origin])).toEqual([
    ['div', 'interaction-candidate'],
  ])
})
test('semantic EMCN renderers are proven while roles on imported components retain their real origin', () => {
  const f = fixture({
    'packages/emcn/src/index.ts':
      "export {Button} from './components/button/button'; export const PopoverItem=()=> <div role='menuitem'/>",
    [location]:
      "import {Button,PopoverItem} from '@sim/emcn'; export const A=()=> <><Button role='tab'/><PopoverItem/></>",
  })
  expect(consumer(f.scan()).map((r) => r.origin)).toEqual(['emcn-component', 'emcn-component'])
})
test('Radix context providers are not classified as interactive controls by their Root export name', () => {
  const f = fixture({
    [location]:
      "import {Root as Menu} from '@radix-ui/react-dropdown-menu'; import {Root as Check} from '@radix-ui/react-checkbox'; export const A=()=> <><Menu/><Check/></>",
  })
  expect(consumer(f.scan()).map((r) => [r.tag, r.origin])).toEqual([['Check', 'external-control']])
})
test('native action-input wrappers retain their origin and unknown native spreads remain explicit', () => {
  const f = fixture({
    [location]:
      "const Check=()=> <input type='checkbox'/>; export const A=({props})=> <><Check/><div {...props}/></>",
  })
  expect(consumer(f.scan()).map((r) => r.origin)).toEqual(['local-control', 'local-control'])
  expect(f.scan().unchecked.some((r) => r.reason.includes('Unknown spread may supply'))).toBe(true)
})
test('compositions are not mistaken for button wrappers, and children remain inventoried', () => {
  const f = fixture({
    [location]:
      "import {Button} from '@sim/emcn'; const Form=()=> <form><input/><Button/></form>; export const Page=()=> <Form/>",
  })
  expect(consumer(f.scan()).map((x) => x.tag)).toEqual(['Button'])
})
test('conditional returns retain local and central alternatives rather than hiding local branches', () => {
  const f = fixture({
    [location]:
      "import {Button} from '@sim/emcn'; const Mixed=({custom})=> custom ? <button/> : <Button/>; export const Page=()=> <Mixed/>",
  })
  const mixed = consumer(f.scan()).find((x) => x.tag === 'Mixed')
  if (!mixed) throw new Error('Missing Mixed use')
  expect(mixed.terminals).toContain('native:button')
  expect(mixed.origin).not.toBe('emcn-component')
})
test('static spreads retain finite choices; later unknown spreads invalidate apparent certainty', () => {
  const f = fixture({
    [location]:
      "import {Button} from '@sim/emcn'; const known={size:'icon'}; export const A=({active,props})=> <><Button {...known} variant={active?'primary':'quiet'}/><Button size='icon' {...props}/></>",
  })
  const [a, b] = consumer(f.scan())
  expect(a.inputs.size.values).toEqual(['icon'])
  expect(a.inputs.variant.values).toEqual(['primary', 'quiet'])
  expect(a.spread).toBe(false)
  expect(b.spread).toBe(true)
  expect(b.inputs.size.unresolved).toBe(true)
})
test('repeated source uses are counted once and labelled instead of fabricating runtime multiplicity', () => {
  const f = fixture({
    [location]:
      "import {Button} from '@sim/emcn'; export const A=({items})=> <>{items.map(i=> <Button key={i}/>)}</>",
  })
  expect(consumer(f.scan())).toHaveLength(1)
  expect(consumer(f.scan())[0].multiplicity).toBe('repeated-source')
})
test('cycles and unsupported factories remain unresolved and discovery order is deterministic', () => {
  const f = fixture({
    [location]:
      "import {Button} from './a'; const Special=makeButton(); export const A=()=> <><Button onClick={()=>{}}/><Special onClick={()=>{}}/></>",
    'apps/sim/components/a.ts': "export {Button} from './b'",
    'apps/sim/components/b.ts': "export {Button} from './a'",
  })
  const r = f.scan()
  expect(consumer(r).every((v) => v.origin === 'unresolved')).toBe(true)
  expect(r.unchecked.length).toBeGreaterThan(0)
  expect(inspectControls(f.source(), [], 'reverse')).toEqual(r)
})
test('React createElement and literal rendered HTML are found; arbitrary strings are not controls', () => {
  const f = fixture({
    [location]:
      "import React from 'react'; const unused='<button>not rendered</button>'; export const A=()=> <><div dangerouslySetInnerHTML={{__html:'<button>Save</button>'}}/>{React.createElement('button',{type:'submit'},'Save')}</>",
  })
  const r = consumer(f.scan())
  expect(r).toHaveLength(2)
  expect(r.map((v) => v.syntax).sort()).toEqual(['create-element', 'html'])
})
test('dynamic HTML and imperative DOM remain visible analysis gaps', () => {
  const f = fixture({
    [location]:
      "export const A=({html})=> <div dangerouslySetInnerHTML={{__html:html}}/>; document.createElement('button');",
  })
  const r = f.scan()
  expect(r.unchecked.some((v) => v.reason.includes('HTML sink'))).toBe(true)
  expect(r.unchecked.some((v) => v.reason.includes('Imperative DOM'))).toBe(true)
})
test('runtime input semantics and literal HTML click handlers remain reviewable', () => {
  const f = fixture({
    [location]:
      'export const A=({type})=> <><input type={type}/><div dangerouslySetInnerHTML={{__html:\'<div onclick="run()">Open</div>\'}}/></>',
  })
  expect(Object.fromEntries(consumer(f.scan()).map((r) => [r.tag, r.origin]))).toEqual({
    input: 'unresolved',
    div: 'interaction-candidate',
  })
})
test('known Radix controls are external origins while hidden submit buttons are nonvisual', () => {
  const f = fixture({
    [location]:
      "import {Item} from '@radix-ui/react-dropdown-menu'; export const A=()=> <><Item/><button hidden type='submit'/></>",
  })
  expect(consumer(f.scan()).map((v) => v.origin)).toEqual(['external-control', 'nonvisual'])
})
test('landing and tests stay excluded; parsing failures are never invisible', () => {
  const f = fixture({
    [location]: 'export const A=()=> <button>',
    'apps/sim/app/(landing)/page.tsx': 'export const A=()=> <button/>',
    'apps/sim/components/a.test.tsx': 'export const A=()=> <button/>',
  })
  const r = f.scan()
  expect(r.coverage.parseFailures).toBe(1)
  expect(r.coverage.excludedFiles).toContain('apps/sim/app/(landing)/page.tsx')
  expect(r.coverage.excludedFiles).toContain('apps/sim/components/a.test.tsx')
})
test('working-tree source includes changed/untracked files and deletions; source mutation prevents publication', () => {
  const f = fixture({ [location]: 'export const A=()=> <button/>' })
  f.write(location, 'export const A=()=> <button aria-label="Changed"/>')
  f.write('apps/sim/components/new.tsx', 'export const A=()=> <button/>')
  const source = new GitSource(f.repo, 'HEAD', true)
  expect(inspectControls(source, []).records.some((v) => v.file.endsWith('/new.tsx'))).toBe(true)
  expect(consumer(inspectControls(source, []))[0].inputs['aria-label'].values).toEqual(['Changed'])
  expect(consumer(f.scan())[0].inputs['aria-label']).toBeUndefined()
  source.assertUnchanged()
  f.write(location, 'export const A=()=> <button aria-label="Another edit"/>')
  expect(() => source.assertUnchanged()).toThrow('changed during')
  rmSync(path.join(f.repo, location))
  expect(new GitSource(f.repo, 'HEAD', true).entries.some((v) => v.path === location)).toBe(false)
})
test('EMCN test fixtures stay excluded in both snapshot and working-tree discovery', () => {
  const file = 'packages/emcn/src/components/button/button.test.tsx'
  const f = fixture({
    [file]: 'export const Test=()=> <button/>',
    [location]: 'export const A=()=> <button/>',
  })
  for (const source of [f.source(), new GitSource(f.repo, 'HEAD', true)]) {
    const result = inspectControls(source, [])
    expect(result.coverage.excludedFiles).toContain(file)
    expect(result.records.some((r) => r.file === file)).toBe(false)
  }
})

test('imported immutable appearances, templates, reexports, spreads and undefined preserve precedence', () => {
  const f = fixture({
    [location]: `import {Button} from '@sim/emcn'; import {props,label} from './barrel'; export const A=({flag})=><><Button {...props} size='icon' className={label}/><Button size='icon' {...props}/><Button variant={flag?'primary':undefined}/><Button {...props} {...runtime} size='sm'/></>`,
    'apps/sim/components/barrel.ts': `export {props,label} from './constants'`,
    'apps/sim/components/constants.ts':
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source for the parser fixture
      "const height='h-9'; const base={size:'lg'}; export const props={...base,size:undefined}; export const label=`${height} w-full`;",
  })
  const [a, b, c, d] = consumer(f.scan())
  expect(a.inputs.className.values).toEqual(['h-9 w-full'])
  expect(a.inputs.size.values).toEqual(['icon'])
  expect(a.spread).toBe(false)
  expect(b.inputs.size.mayBeUndefined).toBe(true)
  expect(b.inputs.size.values).toEqual([])
  expect(c.inputs.variant.values).toEqual(['primary'])
  expect(c.inputs.variant.mayBeUndefined).toBe(true)
  expect(d.inputs.size.values).toEqual(['sm'])
  expect(d.spread).toBe(true)
})

test('mutations, escapes, cycles, arbitrary helpers and shadowed undefined remain uncertain', () => {
  const f = fixture({
    [location]: `import {Button} from '@sim/emcn'; const props={size:'sm'}; props.size='lg'; const cycle=cycle; const escaped={variant:'primary'}; mutate(escaped); export const A=({undefined})=><><Button {...props}/><Button {...escaped}/><Button size={cycle}/><Button size={compute()}/><Button variant={undefined}/></>`,
  })
  const r = consumer(f.scan())
  expect(r[0].spread).toBe(true)
  expect(r[1].spread).toBe(true)
  expect(r.slice(2).every((x) => Object.values(x.inputs).some((i) => i.unresolved))).toBe(true)
})

const poly = `import {forwardRef} from 'react'; import {Slot} from '@radix-ui/react-slot'; export const Local=forwardRef(({asChild=false,...props},ref)=>{const Comp=asChild?Slot:'button';return <Comp className='local' {...props} ref={ref}/>})`
test('polymorphic defaults, false, true, conditional and missing children retain styling ownership', () => {
  const f = fixture({
    [location]: `import {Button} from '@sim/emcn'; import {Local} from './local'; export const A=({flag})=><><Local/><Local asChild={false}/><Local asChild><Button/></Local><Local asChild><a href='/x'/></Local><Local asChild={flag}><Button/></Local><Local asChild/><Local asChild><Button/><Button/></Local></>`,
    'apps/sim/components/local.tsx': poly,
  })
  const r = consumer(f.scan()).filter((r) => r.tag === 'Local')
  expect(r).toHaveLength(7)
  expect(r.slice(0, 2).map((x) => x.origin)).toEqual(['local-control', 'local-control'])
  expect(r[2].origin).toBe('emcn-component')
  expect(r[2].stylingOwners.some((x) => x.includes('#Local@'))).toBe(true)
  expect(r[2].relationship).toContain('delegates-to-child')
  expect(r[3].origin).toBe('local-control')
  expect(r.slice(4).every((x) => x.origin === 'unresolved')).toBe(true)
})

const tooltip = `import * as React from 'react'; import {Slot} from '@radix-ui/react-slot'; const Context=React.createContext(null); function Root({children}){return <Context.Provider value={{}}>{children}</Context.Provider>} const Trigger=React.forwardRef(({asChild=false,...props},ref)=>{const Comp=asChild?Slot:'button'; return <Comp ref={ref} {...props}/>}); const Content=({children})=><div role='tooltip'>{children}</div>; export const Tooltip={Root,Trigger,Content};`
test('compound exports establish single delegated controls, not composition inheritance', () => {
  const f = fixture({
    'packages/emcn/src/index.ts': `export * from './components/button/button';export * from './components/tooltip/tooltip'`,
    'packages/emcn/src/components/tooltip/tooltip.tsx': tooltip,
    'apps/sim/components/wrap.tsx': `import {Tooltip,Button} from '@sim/emcn'; export const Tool=()=> <Tooltip.Root><Tooltip.Trigger asChild><Button/></Tooltip.Trigger><Tooltip.Content>Help</Tooltip.Content></Tooltip.Root>; export const Multi=()=> <Tooltip.Root><Button/><Button/></Tooltip.Root>; export const Local=()=> <div><Button/></div>`,
    [location]: `import {Tool,Multi,Local} from './wrap'; export const A=()=> <><Tool/><Multi/><Local/></>`,
  })
  const r = consumer(f.scan())
  expect(r.map((x) => x.tag)).toEqual(['Tool'])
  expect(r[0].origin).toBe('emcn-component')
  expect(r[0].relationship).toContain('delegates-to-child')
})
test('mutated compound exports and unrelated central imports do not grant central origin', () => {
  const f = fixture({
    [location]: `import {Button} from '@sim/emcn'; const Parts={Root:Button}; Parts.Root=Other; export const A=()=> <><Parts.Root onClick={()=>{}}/><Unknown onClick={()=>{}}/></>`,
  })
  expect(consumer(f.scan()).every((r) => r.origin === 'unresolved')).toBe(true)
})
test('literal attached imperative controls retain assignments, names and handlers', () => {
  const f = fixture({
    [location]: `export function widget(label){ const root=document.createElement('span'); if(label){const cancel=document.createElement('button'); cancel.type='button'; cancel.className='underline'; cancel.textContent='Cancel insertion'; cancel.setAttribute('aria-label',\`Cancel \${label}\`);cancel.addEventListener('click',()=>{const restore=document.activeElement===cancel; doAction(restore)});root.append(cancel)} return root}`,
  })
  const [r] = consumer(f.scan())
  expect(r.syntax).toBe('imperative')
  expect(r.inputs.type.values).toEqual(['button'])
  expect(r.inputs.textContent.values).toEqual(['Cancel insertion'])
  expect(r.inputs['aria-label'].unresolved).toBe(true)
  expect(r.handlers).toContain('onclick')
})
test('unattached, dynamic and escaped DOM references stay explicit gaps', () => {
  const f = fixture({
    [location]: `document.createElement('button'); const x=document.createElement(tag); export function widget(){const b=document.createElement('button'); mutate(b); return b}`,
  })
  expect(consumer(f.scan())).toEqual([])
  expect(f.scan().unchecked.filter((x) => x.reason.includes('Imperative DOM'))).toHaveLength(3)
})
test('decorative trees are accounted for; pointer inert focus and interactive HTML remain gaps or controls', () => {
  const f = fixture({
    [location]: `export function ghost(){const d=document.createElement('div');d.style.cssText='pointer-events:none'; const s=document.createElement('span');s.innerHTML='<svg><path d="M0 0"/></svg>'; d.append(s);return d} export function focus(){const d=document.createElement('div');d.style.cssText='pointer-events:none';d.tabIndex=0;return d} export function unknown(){const d=document.createElement('div');d.innerHTML='<button>Hi</button>';return d}`,
  })
  const r = f.scan()
  expect(r.nonUi).toHaveLength(3)
  expect(consumer(r).some((x) => x.inputs.tabIndex?.values?.includes(0))).toBe(true)
  expect(r.unchecked.some((x) => x.reason.includes('HTML assignment'))).toBe(true)
})
test('only proven data-only script transports leave HTML diagnostics', () => {
  const f = fixture({
    [location]:
      String.raw`function serialize(env){return JSON.stringify(env).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')} export const A=({env,html})=><><script dangerouslySetInnerHTML={{__html:\`window['__ENV'] = \${serialize(env)}\`}}/>
<script dangerouslySetInnerHTML={{__html:html}}/>
<script dangerouslySetInnerHTML={{__html:\`document.write(\${serialize(env)})\`}}/></>`
        .replaceAll('\\`', '`')
        .replaceAll('\\${', '${'),
  })
  const r = f.scan()
  expect(r.nonUi).toHaveLength(1)
  expect(r.unchecked.filter((x) => x.reason.includes('HTML sink'))).toHaveLength(2)
})

test('central CVA defaults distinguish omitted, undefined, explicit and null inputs', () => {
  const f = fixture({
    'packages/emcn/src/components/button/button.tsx': `import {cva} from 'class-variance-authority'; const buttonVariants=cva('base',{variants:{size:{sm:'small',md:'medium'}},defaultVariants:{size:'md'}}); export const Button=({size,className,...props})=><button {...props} className={buttonVariants({size,className})}/>`,
    [location]: `import {Button} from '@sim/emcn';export const A=({flag})=><><Button/><Button size={flag?'sm':undefined}/><Button size={null}/></>`,
  })
  const [a, b, c] = consumer(f.scan())
  expect(a.inputs.size.omitted).toBe(true)
  expect(a.inputs.size.effectiveValues).toEqual(['md'])
  expect(b.inputs.size.effectiveValues).toEqual(['sm', 'md'])
  expect(c.inputs.size.effectiveValues).toEqual([null])
})
test('asChild syntax inside a multi-control composition cannot impersonate a governing renderer', () => {
  const f = fixture({
    [location]: `import {Slot} from '@radix-ui/react-slot';import {Button} from '@sim/emcn';const Multi=({asChild=false,...props})=>{const Comp=asChild?Slot:'button';return <div><Comp {...props}/><Button/></div>};export const A=()=> <Multi asChild><Button/></Multi>`,
  })
  expect(consumer(f.scan()).some((r) => r.tag === 'Multi')).toBe(false)
})

test('cross-module object mutation and nested escape cannot establish immutable appearance', () => {
  const f = fixture({
    [location]: `import {Button} from '@sim/emcn'; import {props} from './data';props.size='lg'; const base={size:'sm'};const box={base}; mutate(box); export const A=()=> <><Button {...props}/><Button {...base}/></>`,
    'apps/sim/components/data.ts': `export const props={size:'sm'}`,
  })
  expect(consumer(f.scan()).every((r) => r.spread)).toBe(true)
})
test('namespace static values and conditional object spreads retain alternatives', () => {
  const f = fixture({
    [location]: `import {Button} from '@sim/emcn';import * as C from './data';export const A=({flag})=><><Button className={C.label}/><Button size='sm' {...(flag?C.props:{})}/></>`,
    'apps/sim/components/data.ts': `export const label='h-9';export const props={size:'lg'}`,
  })
  const [a, b] = consumer(f.scan())
  expect(a.inputs.className.values).toEqual(['h-9'])
  expect(b.inputs.size.values).toEqual(['lg', 'sm'])
  expect(b.spread).toBe(false)
})
test('imperative parent escape prevents claims about its attached control', () => {
  const f = fixture({
    [location]: `export function widget(){const root=document.createElement('div');const button=document.createElement('button');root.append(button);mutate(root);return root}`,
  })
  expect(consumer(f.scan())).toHaveLength(0)
  expect(f.scan().unchecked.some((n) => n.reason.includes('Imperative DOM'))).toBe(true)
})
test('source modules are parsed without executing top-level code', () => {
  const f = fixture({
    [location]: `import {Button} from '@sim/emcn';import {label} from './data';export const A=()=> <Button className={label}/>`,
    'apps/sim/components/data.ts': `throw new Error('MUST NEVER EXECUTE');export const label='h-9'`,
  })
  expect(consumer(f.scan())[0].inputs.className.values).toEqual(['h-9'])
})

test('input branch and recursion budgets retain unresolved results without executing helpers', () => {
  const f = fixture({
    [location]: `import {Button} from '@sim/emcn';const bit=flag?'a':'b';const a0='x';${Array.from({ length: 25 }, (_, i) => `const a${i + 1}=a${i};`).join('')} export const A=()=> <><Button className={\`\${bit}\${bit}\${bit}\${bit}\${bit}\${bit}\${bit}\`}/><Button className={a25}/></>`,
  })
  expect(consumer(f.scan()).every((r) => r.inputs.className.unresolved)).toBe(true)
})

test('static style objects expose properties and later spreads preserve uncertainty', () => {
  const f = fixture({
    [location]: `import {Button} from '@sim/emcn';import {style} from './data';export const A=()=> <><Button style={{...style,color:'red'}}/><Button style={{...style,...runtime}}/></>`,
    'apps/sim/components/data.ts': `export const style={color:'blue',height:36}`,
  })
  const [a, b] = consumer(f.scan())
  expect(a.inputs.style.unresolved).toBe(false)
  expect(a.inputs.style.properties?.color.values).toEqual(['red'])
  expect(a.inputs.style.properties?.height.values).toEqual([36])
  expect(b.inputs.style.unresolved).toBe(true)
})
test('compound namespace and immutable local aliases retain delegation', () => {
  const f = fixture({
    'packages/emcn/src/index.ts': `export * from './components/button/button';export * from './components/tooltip/tooltip'`,
    'packages/emcn/src/components/tooltip/tooltip.tsx': tooltip,
    [location]: `import * as E from '@sim/emcn';const T=E.Tooltip;export const Tool=()=> <T.Root><T.Trigger asChild><E.Button/></T.Trigger><T.Content>Help</T.Content></T.Root>`,
  })
  const r = consumer(f.scan()).find((r) => r.tag === 'T.Root')
  expect(r?.origin).toBe('emcn-component')
  expect(r?.relationship).toContain('delegates-to-child')
})

test('arbitrary literal scripts remain analysis gaps rather than being parsed as HTML', () => {
  const f = fixture({
    [location]: `export const A=()=> <script dangerouslySetInnerHTML={{__html:'document.body.innerHTML="<button>Run</button>"'}}/>`,
  })
  expect(consumer(f.scan())).toHaveLength(0)
  expect(f.scan().unchecked.some((n) => n.reason.includes('Script HTML sink'))).toBe(true)
})

test('a styling-only Slot wrapper around a span is not invented as a control', () => {
  const f = fixture({
    [location]: `import {Local} from './local';export const A=()=> <Local asChild><span>Text</span></Local>`,
    'apps/sim/components/local.tsx': poly,
  })
  expect(consumer(f.scan())).toEqual([])
})
test('mutation of a finite object alternative remains unresolved', () => {
  const f = fixture({
    [location]: `import {Button} from '@sim/emcn';const props=flag?{size:'sm'}:{size:'lg'};props.size=runtime;export const A=()=> <Button {...props}/>`,
  })
  expect(consumer(f.scan())[0].spread).toBe(true)
})

test('mutating an imported compound member invalidates its renderer proof', () => {
  const f = fixture({
    'packages/emcn/src/index.ts': `export * from './components/button/button';export * from './components/tooltip/tooltip'`,
    'packages/emcn/src/components/tooltip/tooltip.tsx': tooltip,
    [location]: `import {Tooltip,Button} from '@sim/emcn';Tooltip.Trigger=runtime;export const A=()=> <Tooltip.Trigger asChild onClick={()=>{}}><Button/></Tooltip.Trigger>`,
  })
  expect(consumer(f.scan()).find((r) => r.tag === 'Tooltip.Trigger')?.origin).toBe('unresolved')
})

test('working-tree source identity notices changes in excluded marketing sources without parsing them', () => {
  const helper = 'apps/sim/lib/content/mdx.tsx'
  const landing = 'apps/sim/app/(landing)/page.tsx'
  const f = fixture({
    [helper]: 'export const components = {}',
    [landing]: 'import { components } from "@/lib/content/mdx"',
  })
  const source = new GitSource(f.repo, 'HEAD', true)
  expect(inspectTypography(source).ownership).toEqual([])
  expect(inspectControls(source, []).coverage.excludedFiles).toContain(landing)
  expect(inspectControls(source, []).coverage.excludedFiles).toContain(helper)
  source.assertUnchanged()
  f.write(landing, 'export const Page = () => null')
  expect(() => source.assertUnchanged()).toThrow('changed during')
  expect(inspectTypography(new GitSource(f.repo, 'HEAD', true)).ownership).toEqual([])
})

test('oversized nonimporting data does not cause marketing source inspection', () => {
  const f = fixture({
    'apps/sim/lib/content/mdx.tsx': 'export const mdxComponents = {}',
    'apps/sim/app/(landing)/page.tsx': 'import {mdxComponents} from "@/lib/content/mdx"',
    'apps/sim/tools/generated/tool-metadata.ts': `export const data = '${'x'.repeat(2 * 1024 * 1024)}'`,
  })
  expect(inspectTypography(f.source()).ownership).toEqual([])
})

test('inline DOM event attributes preserve interactivity', () => {
  const f = fixture({
    [location]: `export function widget(){const el=document.createElement('div');el.className='bg-red-500';el.setAttribute('onclick','doSomething()');return el}`,
  })
  const records = consumer(f.scan())
  expect(records).toHaveLength(1)
  expect(records[0].handlers).toContain('onclick')
})

test('async and generator serializers cannot prove a JSON-only script transport', () => {
  for (const prefix of ['async function', 'function*']) {
    const code =
      String.raw`function serialize(env){return JSON.stringify(env).replace(/</g,'\\u003c')} export const A=({env})=> <script dangerouslySetInnerHTML={{__html:\`window.STATE = \${serialize(env)}\`}}/>`
        .replace('function serialize', `${prefix} serialize`)
        .replaceAll('\\`', '`')
        .replaceAll('\\${', '${')
    const f = fixture({ [location]: code })
    const report = f.scan()
    expect(report.nonUi).toEqual([])
    expect(report.unchecked.some((n) => n.reason.includes('HTML sink'))).toBe(true)
  }
})
