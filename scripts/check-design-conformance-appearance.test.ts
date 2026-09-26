/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Fixtures contain literal proposed JavaScript templates. */
import { existsSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'
import { inspectControls } from '#control-analysis/inventory'
import { extract } from '#design-conformance/extract'
import { loadCatalogue } from '#design-conformance/io'
import { Linter } from '#design-conformance/lint'
import { TOKEN_FILE } from '#design-conformance/model'

let linter: Linter
beforeAll(async () => {
  const c = loadCatalogue()
  linter = await Linter.create(c.catalogue, c.hash)
})
const ui = 'apps/sim/components/example.tsx'
const commits = { base: 'a'.repeat(40), head: 'b'.repeat(40), mergeBase: 'a'.repeat(40) }
function diff(before: string, after: string, file = ui, oldFile = file) {
  return linter.analyze(
    [
      {
        status: 'M',
        before: { path: oldFile, blob: 'a'.repeat(40), mode: '100644' },
        after: { path: file, blob: 'b'.repeat(40), mode: '100644' },
      },
    ],
    (e) => (e.blob.startsWith('a') ? before : after),
    commits
  )
}
const element = (classes: string) =>
  `const A=()=> <button className=${JSON.stringify(classes)}>Text</button>`
const shared = (props = '', body = '') =>
  `import {ChipInput, Chip, DropdownMenuItem, Button} from '@sim/emcn'; const A=()=> <><ChipInput ${props}/>${body}</>`

test('embedded HTML CSS annotations point to the authored declaration', () => {
  for (const source of [
    '<div style="color: #abc; background: #def"></div>',
    '<div\n style =\n "color: #abc;\n background: #def"></div>',
    '<style>.a { color: #abc; }</style>',
    '<style\n type="text/css">\n.a { color: #abc; }\n</style>',
    '.a { color: #abc; }',
  ]) {
    const facts = extract(source, source.startsWith('.') ? 'example.css' : 'example.html')
    for (const atom of facts.atoms.filter(
      (a) => a.property === 'color' || a.property === 'background'
    )) {
      const prefix = source.slice(0, source.indexOf(`${atom.property}:`)).split('\n')
      expect({ line: atom.line, column: atom.column }).toEqual({
        line: prefix.length,
        column: prefix.at(-1)!.length + 1,
      })
    }
    expect(facts.atoms.some((a) => a.property === 'color')).toBe(true)
  }
})

for (const [category, before, after] of [
  ['colours', 'text-[var(--text-body)]', 'text-[var(--text-muted)]'],
  ['spacing', 'p-2', 'p-4'],
  ['dimensions', 'w-4', 'w-6'],
  ['typography', 'font-normal text-small', 'font-medium text-caption'],
  ['radii', 'rounded-lg', 'rounded-none'],
  ['borders', 'border', 'border-2'],
  ['effects', 'opacity-50', 'opacity-100'],
  ['layout', 'flex-nowrap', 'flex-wrap'],
  ['visibility', 'overflow-visible', 'overflow-hidden'],
  ['layering', 'z-10', 'z-20'],
  ['motion', 'duration-150', 'duration-200'],
] as const) {
  test(`${category}: changes flag, identical styling and copy edits pass`, () => {
    const report = diff(element(before), element(after))
    expect(report.flagged).toBe(true)
    expect(report.findings.some((f) => f.category === category)).toBe(true)
    expect(
      diff(element(before), `// comment\n${element(before).replace('Text', 'Other wording')}`)
        .flagged
    ).toBe(false)
  })
}
test('numeric membership is irrelevant; approved new custom styling flags', () => {
  expect(diff('', element('p-2')).flagged).toBe(true)
  expect(diff(element('p-[773px]'), element('p-[773px]')).flagged).toBe(false)
})
test('shared reuse including supported props and outer width passes', () => {
  expect(diff('', shared('className="w-full min-w-0 flex-1"')).flagged).toBe(false)
  expect(diff('', shared('', '<Chip variant="primary">New action</Chip>')).flagged).toBe(false)
  expect(diff('', shared('', '<Chip variant="primary">Another action</Chip>')).flagged).toBe(false)
})
test('shared appearance overrides flag, including already approved values', () => {
  expect(diff(shared(), shared('className="h-[30px] rounded-lg"')).flagged).toBe(true)
  expect(diff('', shared('className="bg-[var(--surface-4)]"')).findings[0].rule).toBe(
    'shared-component-override'
  )
})
test('changing a control variant or size flags, disabled business logic does not', () => {
  const a = shared('', '<Chip variant="primary" disabled={busy}/>')
  expect(diff(a, a.replace('primary', 'destructive')).flagged).toBe(true)
  expect(diff(a, a.replace('busy', 'loading')).flagged).toBe(false)
  expect(diff(shared('minWidth={240}'), shared('minWidth={220}')).flagged).toBe(true)
})
test('adding repeated menu options and deleting controls passes', () => {
  const item = '<DropdownMenuItem className="p-2">One</DropdownMenuItem>'
  expect(diff(shared('', item), shared('', item + item.replace('One', 'Two'))).flagged).toBe(false)
  expect(diff(element('p-2'), '').flagged).toBe(false)
})
test('hover, theme and responsive context changes are detected', () => {
  for (const after of ['focus:p-2', 'dark:hover:p-2', 'md:hover:p-2'])
    expect(diff(element('hover:p-2'), element(after)).flagged).toBe(true)
})
test('conditional styling retains branches without interpreting business predicates', () => {
  const a = "const A=()=> <div className={busy ? 'p-2' : 'p-4'}/>"
  expect(diff(a, a.replace('busy', 'loading')).flagged).toBe(false)
  expect(diff(a, "const A=()=> <div className={busy ? 'p-4' : 'p-2'}/>").flagged).toBe(true)
})
test('CVA defaults, variant mapping and compound conditions are detected', () => {
  const a =
    "import {cva} from 'class-variance-authority'; export const control=cva('p-2',{variants:{size:{small:'p-1',large:'p-4'}},defaultVariants:{size:'small'},compoundVariants:[{size:'small',className:'rounded-lg'}]})"
  expect(
    diff(a, a.replace("size:'small'},", "size:'large'},")).findings.some(
      (f) => f.rule === 'variant-default-changed'
    )
  ).toBe(true)
  expect(diff(a, a.replace("small:'p-1'", "small:'p-2'")).flagged).toBe(true)
  expect(diff(a, a.replace("[{size:'small'", "[{size:'large'")).flagged).toBe(true)
})
test('composition precedence and important modifiers are preserved', () => {
  const a = "import {cn} from '@sim/emcn'; const A=()=> <div className={cn('p-2','p-4')}/>"
  expect(
    diff(a, a.replace("'p-2','p-4'", "'p-4','p-2'")).findings.some(
      (f) => f.rule === 'style-precedence-changed'
    )
  ).toBe(true)
  expect(diff(element('p-2'), element('!p-2')).flagged).toBe(true)
  expect(diff(element('p-2 text-white'), element('text-white p-2')).flagged).toBe(false)
})
test('local renames and constant extraction are equivalent', () => {
  const a = element('p-2')
  expect(
    diff(a, "const PAD='p-2'; const Renamed=()=> <button className={PAD}>Different</button>")
      .flagged
  ).toBe(false)
  expect(diff(a, "const PAD='p-4'; const Renamed=()=> <button className={PAD}/>").flagged).toBe(
    true
  )
  expect(diff(a, a, 'apps/sim/components/renamed ü file.tsx').flagged).toBe(false)
})
test('a component rename does not hide removal of an appearance override', () => {
  const before =
    "import {DropdownMenuContent} from '@sim/emcn'; const OldPicker=()=> <DropdownMenuContent className='max-h-[320px]'><p>Options</p></DropdownMenuContent>"
  const after =
    "import {DropdownMenuContent} from '@sim/emcn'; const Picker=()=> <DropdownMenuContent><p>New options</p></DropdownMenuContent>"
  const report = diff(before, after, 'apps/sim/components/new-picker.tsx')
  expect(report.findings.some((f) => f.property === 'max-height' && f.value === '[]')).toBe(true)
  expect(
    diff(before, before.replace('OldPicker', 'Picker'), 'apps/sim/components/new-picker.tsx')
      .flagged
  ).toBe(false)
})
test('uppercase exported object styling and property edits are inspected', () => {
  const a = "export const PANEL_CLASSES={layout:'p-2 [--control-reserve:64px]'} as const"
  expect(diff(a, a.replace('64px', '52px')).flagged).toBe(true)
  expect(diff(a, a.replace('PANEL_CLASSES', 'ROW_CLASSES')).flagged).toBe(false)
})
test('detached shared styles have specific evidence; import aliases pass', () => {
  const a =
    "import {chipGeometryClass as geometry} from '@sim/emcn'; const A=()=> <div className={geometry}/>"
  const b = "const A=()=> <div className='h-[30px] px-2'/>"
  expect(diff(a, b).findings.some((f) => f.rule === 'shared-style-detached')).toBe(true)
  expect(diff(a, a.replaceAll('geometry', 'alias')).flagged).toBe(false)
})
test('relative-to-project-alias import refactors do not detach shared styling', () => {
  const a =
    "import {ROW_CLASS} from './row'; const A=()=> <button className={cn(ROW_CLASS, 'p-2')}/>"
  expect(diff(a, a.replace('./row', '@/components/row')).flagged).toBe(false)
  expect(diff(a, a.replace('./row', './different-row')).flagged).toBe(false)
  expect(
    diff(a, "const A=()=> <button className='p-2 rounded-lg'/>").findings.some(
      (f) => f.rule === 'shared-style-detached'
    )
  ).toBe(true)
})
test('a shared control replaced with a native control is detected', () => {
  const a = "import {Button} from '@sim/emcn'; const A=()=> <Button/>"
  expect(diff(a, 'const A=()=> <button/>').flagged).toBe(true)
})
test('coordinates and translations are exempt; mixed changes still flag', () => {
  expect(diff(element('p-2 top-0'), element('p-2 top-[17px] translate-x-4')).flagged).toBe(false)
  expect(diff(element('p-2 top-0'), element('p-4 top-[17px]')).flagged).toBe(true)
  expect(diff('', "const A=()=> <div style={{transform:'translateX(12px)'}}/>").flagged).toBe(false)
})
test('CSS/HTML, selectors, animations and declarations are compared', () => {
  expect(diff('.a{padding:8px}', '.a{padding:16px}', 'apps/sim/components/a.css').flagged).toBe(
    true
  )
  expect(
    diff('.a:hover{opacity:.5}', '.a:focus{opacity:.5}', 'apps/sim/components/a.css').flagged
  ).toBe(true)
  expect(
    diff(
      '@keyframes reveal{to{opacity:1}}',
      '@keyframes reveal{to{opacity:.5}}',
      'apps/sim/components/a.css'
    ).flagged
  ).toBe(true)
  expect(
    diff(
      '<button class="p-2">A</button>',
      '<button class="p-4">B</button>',
      'apps/sim/components/a.html'
    ).flagged
  ).toBe(true)
})
test('central tokens and declarative theme infrastructure flag semantically', () => {
  expect(diff(':root{--x:8px}', ':root{--x:16px}', TOKEN_FILE).flagged).toBe(true)
  expect(diff(':root{--x:#abc}', ':root {/*comment*/ --x: #ABC;}', TOKEN_FILE).flagged).toBe(false)
  expect(
    diff(
      '@custom-variant dark (&:where(.dark *));',
      '@custom-variant dark (&:where(.night *));',
      TOKEN_FILE
    ).flagged
  ).toBe(true)
})
test('uncertainty, media and backend expressions do not notify', () => {
  const a = "import {style} from './helper'; const A=()=> <div className={style(data)}/>"
  const r = diff(a, a.replace('data', 'otherData'))
  expect(r.flagged).toBe(false)
  expect(r.unchecked.length).toBeGreaterThan(0)
  expect(
    diff(
      '',
      "const data={colour:'#123',padding:777}; sql`select 1`; telemetry.setAttribute('name','p-4')"
    ).flagged
  ).toBe(false)
  expect(diff('<img className="w-4"/>', '<img className="w-8"/>').flagged).toBe(false)
})
test('parser errors remain unchecked and cannot execute source', async () => {
  expect(diff('', 'const A=()=> <div className={').unchecked.length).toBeGreaterThan(0)
  const marker = `/tmp/appearance-nonexecution-${process.pid}`
  diff('', `import fs from 'node:fs'; fs.writeFileSync('${marker}','bad'); ${element('p-2')}`)
  expect(existsSync(marker)).toBe(false)
})
test('parser failures and unresolved replacements are not mistaken for style removals', () => {
  expect(diff('.x{padding:8px}', '.x{', 'apps/sim/components/a.css').flagged).toBe(false)
  const r = diff(element('p-2'), 'const A=()=> <button className={runtimeStyles()}/>')
  expect(r.flagged).toBe(false)
  expect(r.unchecked.length).toBeGreaterThan(0)
  expect(r.unchecked.some((n) => n.reason.includes('runtimeStyles()'))).toBe(true)
  expect(r.unchecked.some((n) => n.reason.includes('no removal is inferred'))).toBe(true)
  expect(
    diff(element('p-2'), "const A=()=> <button className={cn(runtimeStyles(), 'p-4')}/>").flagged
  ).toBe(true)
})
test('appearance reports are byte-identical across repeated analyses', () => {
  const a = JSON.stringify(diff(element('p-2'), element('hover:p-4')))
  expect(JSON.stringify(diff(element('p-2'), element('hover:p-4')))).toBe(a)
  expect(JSON.parse(a).policyVersion).toBe('appearance-diff/2.1.0')
})

test('artwork wrappers and local components pass; surrounding controls still flag', () => {
  const a = `import {Globe} from '@sim/emcn/icons'; function Art(){return <span className="flex h-4 w-4"><Globe/></span>} const A=()=> <button className="p-2"><Art/></button>`
  expect(
    diff(a, a.replace('span', 'div').replace('/span', '/div').replace('h-4 w-4', 'h-6 w-6')).flagged
  ).toBe(false)
  for (const classes of ['p-4', 'p-2 bg-red-500', 'p-2 h-8'])
    expect(diff(a, a.replace('className="p-2"', `className="${classes}"`)).flagged).toBe(true)
  expect(diff('', 'const A=()=> <span className="p-4">{false}</span>').flagged).toBe(true)
  expect(diff('', 'const A=()=> <span className="p-4">Label<svg/></span>').flagged).toBe(true)
  expect(diff('', 'const A=()=> <span role="button" className="p-4"><svg/></span>').flagged).toBe(
    true
  )
})
test('conditional icons, native favicon wrappers and established loaders pass', () => {
  const a = `import {Globe, Terminal} from '@sim/emcn/icons'; import {ThinkingLoader} from '@/components/ui'; const Choice=active?Globe:Terminal; const A=()=> <><span className="h-4">{url?<img src={url}/>:<Globe/>}</span><span className="flex">{busy?<ThinkingLoader size={14}/>:<Choice/>}</span></>`
  expect(diff('', a).flagged).toBe(false)
  expect(
    diff(
      '',
      `import {ThinkingLoader} from '@/components/ui'; const A=()=> <div className="py-2"><ThinkingLoader label={status}/></div>`
    ).flagged
  ).toBe(true)
  expect(
    diff(
      '',
      `function IconPanel(){return <div className="p-4">Settings</div>} const A=()=> <IconPanel/>`
    ).flagged
  ).toBe(true)
  expect(
    diff(
      '',
      `import {ThinkingLoader} from './custom'; const A=()=> <span className="p-4"><ThinkingLoader/></span>`
    ).flagged
  ).toBe(true)
})
test('established icon slots accept runtime selection without exempting text or controls', () => {
  const a = `import {SettingsResourceRow} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'; const Choice=choose(data); const A=()=> <SettingsResourceRow icon={<Choice className="text-red-500"/>} title="Server"/>`
  expect(diff('', a).flagged).toBe(false)
  expect(
    diff(
      '',
      a.replace('<Choice className="text-red-500"/>', '<button className="p-4">Open</button>')
    ).flagged
  ).toBe(true)
  expect(
    diff('', a.replace('<Choice className="text-red-500"/>', '<span className="p-4">Label</span>'))
      .flagged
  ).toBe(true)
  expect(
    diff(
      '',
      a.replace('settings/components/settings-resource-row', 'settings/components/custom-row')
    ).flagged
  ).toBe(true)
})
test('unchanged forwarded classes allow literal removals; changed computation stays unchecked', () => {
  const a = `const A=({className})=> <div className={cn('p-2 shadow-lg',className)} style={{left:position}}/>`
  const r = diff(a, a.replace(' shadow-lg', ''))
  expect(r.findings.some((f) => f.property === 'box-shadow' && f.value === '[]')).toBe(true)
  expect(r.findings[0].reason).toContain('Explicit styling input')
  expect(diff(a, a.replace("cn('p-2 shadow-lg',className)", 'computedClass(data)')).flagged).toBe(
    false
  )
  expect(
    diff(a, a.replace(' shadow-lg', '').replace(',className)', ',otherClasses)')).flagged
  ).toBe(false)
  expect(
    diff(a, a.replace(' shadow-lg', '').replace("'p-2',className", "className,'p-2'")).flagged
  ).toBe(false)
  const template = 'const A=()=> <div className={`p-2 shadow-lg ${forwarded}`}/>'
  expect(diff(template, template.replace(' shadow-lg', '')).flagged).toBe(true)
})
test('unknown inputs identify their channel and property, without suppressing unrelated removals', () => {
  const a = `const A=()=> <div style={{boxShadow:'0 1px 2px black',color:tint}}/>`
  expect(
    diff(a, a.replace("boxShadow:'0 1px 2px black',", '').replace('tint', 'newTint')).flagged
  ).toBe(true)
  expect(diff(a, a.replace("boxShadow:'0 1px 2px black'", 'boxShadow:shadow(data)')).flagged).toBe(
    false
  )
  const f = extract(a, ui)
  expect(f.surfaces?.[0].unresolved?.[0]).toMatchObject({ channel: 'style', property: 'color' })
  const spread = `const A=()=> <button {...props} className="p-2 shadow-lg"/>`
  expect(diff(spread, spread.replace(' shadow-lg', '')).flagged).toBe(true)
  expect(
    diff(spread, spread.replace(' shadow-lg', '').replace('...props', '...otherProps')).flagged
  ).toBe(false)
})
test('rendered HTML static attributes flag around dynamic wording with original JS locations', () => {
  const a =
    'const A=()=> <div dangerouslySetInnerHTML={{__html:`<p style="margin-bottom:8px">${wording}</p>`}}/>'
  expect(
    diff(a, a.replace('8px', '12px')).findings.some((f) => f.property === 'margin-bottom')
  ).toBe(true)
  expect(diff(a, a.replace('wording', 'otherWording')).flagged).toBe(false)
  const source =
    '\nconst markup = `\n<p class="mb-3">${wording}</p>`;\nconst A=()=> <div dangerouslySetInnerHTML={{__html:markup}}/>'
  const r = diff('', source)
  expect(r.findings[0]).toMatchObject({ line: 3, column: 1, property: 'margin-bottom' })
  const escaped =
    'const html="\\n<div style=\\"margin:8px\\">Text</div>"; const A=()=> <div dangerouslySetInnerHTML={{__html:html}}/>'
  expect(diff('', escaped).findings[0]).toMatchObject({
    line: 1,
    column: escaped.indexOf('<div') + 1,
  })
})
test('text subblocks follow local returns and map/join without executing callbacks', async () => {
  const marker = `/tmp/rendered-html-nonexecution-${process.pid}`
  const a = `function instructions(){return items.map((item)=>{Bun.write('${marker}','bad'); return \`<div class="mb-3">\${item}</div>\`}).join('')} const config={type:'text',defaultValue:instructions()}`
  const file = 'apps/sim/triggers/example.ts'
  expect(diff('', a, file).findings.some((f) => f.property === 'margin-bottom')).toBe(true)
  expect(diff(a, a.replace('${item}', '${otherItem}'), file).flagged).toBe(false)
  expect(diff(a, a.replace('mb-3', 'mb-4'), file).flagged).toBe(true)
  expect(diff('', a.replace("type:'text'", "type:'dropdown'"), file).flagged).toBe(false)
  expect(
    diff('', a.replace('defaultValue:instructions()', 'value:()=>instructions()'), file).flagged
  ).toBe(true)
  expect(existsSync(marker)).toBe(false)
})
test('unrelated HTML strings, prompts, dynamic attributes and excluded files stay unchecked or exempt', () => {
  const a = 'const prompt=`<p class="mb-3">${word}</p>`'
  expect(diff('', a).flagged).toBe(false)
  const sink =
    'const A=()=> <div dangerouslySetInnerHTML={{__html:`<p class="mb-${size}" style="margin:${margin}px">Text</p>`}}/>'
  expect(diff('', sink).flagged).toBe(false)
  expect(diff('', sink).unchecked.length).toBeGreaterThan(0)
  expect(diff('', sink.replace('class="mb-${size}"', 'class="mb-3"')).flagged).toBe(true)
  expect(
    diff('', sink.replace('mb-${size}', 'mb-3'), 'apps/sim/app/(landing)/page.tsx').flagged
  ).toBe(false)
  const staticStyle = sink.replace('mb-${size}', 'mb-3')
  expect(diff(staticStyle, staticStyle.replace('mb-3', '${classes}')).flagged).toBe(false)
})
test('HTML and icon recursion are bounded, cycles do not create inferred styling', () => {
  expect(
    diff(
      '',
      'const a=b,b=a; const A=()=> <div dangerouslySetInnerHTML={{__html:a}}/>'
    ).unchecked.some((n) => n.reason.includes('cycle'))
  ).toBe(true)
  expect(diff('', 'const Art=()=> <Art/>; const A=()=> <Art/>').flagged).toBe(false)
  const huge = ' '.repeat(2 * 1024 * 1024 + 1)
  expect(diff(element('p-2'), huge).flagged).toBe(false)
  expect(diff('', huge).unchecked[0].reason).toContain('2 MiB')
})
test('provider BlockConfig brand colours pass while rendered product colours still flag', () => {
  const a = `import type {BlockConfig} from '@/blocks/types'; const Service:BlockConfig={type:'service',category:'tools',bgColor:'#ff6700',name:'Service'}`
  const file = 'apps/sim/blocks/blocks/service.ts'
  expect(diff(a, a.replace('#ff6700', '#ffffff'), file).flagged).toBe(false)
  expect(diff('', a, file).flagged).toBe(false)
  expect(diff(a, '', file).flagged).toBe(false)
  expect(diff(a, a.replace("bgColor:'#ff6700'", 'bgColor:computed()'), file).flagged).toBe(false)
  expect(
    diff(
      a.replace("category:'tools'", "category:'triggers'"),
      a.replace("category:'tools'", "category:'triggers'").replace('#ff6700', '#ffffff'),
      file
    ).flagged
  ).toBe(false)
  expect(
    diff(
      a.replace(':BlockConfig', ''),
      a.replace(':BlockConfig', '').replace('#ff6700', '#ffffff'),
      file
    ).flagged
  ).toBe(false)
  expect(diff('', '<span style={{backgroundColor:"#fff"}}><svg/></span>').flagged).toBe(false)
  expect(
    diff(
      '<span style={{backgroundColor:"#fff"}}>Service</span>',
      '<span style={{backgroundColor:"#000"}}>Service</span>'
    ).flagged
  ).toBe(true)
})
test('tag differences are not blanket-equated for text-bearing elements', () => {
  expect(
    diff('<span className="p-2">Label</span>', '<div className="p-2">Label</div>').flagged
  ).toBe(true)
})

test('changing one of repeated styled surfaces retains its previous appearance', () => {
  const r = diff(
    'export const A=()=> <><button className="p-2"/><button className="p-2"/></>',
    'export const A=()=> <><button className="p-2"/><button className="p-4"/></>'
  )
  expect(r.findings.some((f) => f.rule === 'appearance-changed' && f.before !== null)).toBe(true)
})

test('appearance findings retain direct attribution to the cited consumer slot', () => {
  const source = 'export const A=()=> <button className="p-4">Save</button>'
  const report = diff(source.replace('p-4', 'p-2'), source)
  const findings = report.findings.map((f, index) => ({
    ...f,
    id: String(index),
    observedFrom: [ui],
  }))
  const result = inspectControls(
    {
      entries: [
        {
          path: ui,
          blob: 'a'.repeat(40),
          mode: '100644',
          kind: 'blob',
          bytes: Buffer.byteLength(source),
        },
      ],
      read: () => source,
    },
    findings
  )
  expect(result.records[0].findingIds).toEqual(findings.map((f) => f.id))
})
