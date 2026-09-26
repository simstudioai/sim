import { expect, test } from 'vitest'
import { withoutVerifiedColourUsages } from '#control-analysis/colour-assignments'
import type { ControlSource } from '#control-analysis/model'
import { inspectSimplifications } from '#control-analysis/simplifications'

const css = 'apps/sim/components/sample.css'
const ui = 'apps/sim/components/sample.tsx'
const tokens = 'apps/sim/app/_styles/globals.css'
const globals =
  ':root { --text-body: #434343; --text-muted: #999999; --radius: 8px; --shadow: 0 0 3px #000; } .dark { --text-body: #eeeeee; }'
function source(files: Record<string, string>): ControlSource {
  return {
    entries: Object.entries(files).map(([path, text]) => ({
      path,
      bytes: Buffer.byteLength(text),
      kind: 'blob',
      mode: '100644',
      blob: 'a'.repeat(40),
    })),
    read: (entry) => files[entry.path],
  }
}
const inspect = (files: Record<string, string>) =>
  inspectSimplifications(source({ [tokens]: globals, ...files })).colourAssignments
const flagged = (files: Record<string, string>) => inspect(files).findings
const issues = (files: Record<string, string>) => {
  const report = inspect(files)
  return [...report.findings, ...report.unchecked]
}

const usage = (value = 'var(--rest, var(--text-body))') => ({
  kind: 'usage-violation' as const,
  rule: 'central-colour',
  category: 'colours',
  property: 'color',
  file: css,
  line: 1,
  column: 10,
  context: 'css / .label',
  value,
  reason: 'Local colour variable',
})

test('verified cross-file aliases clear usage warnings and retain global reference evidence', () => {
  const report = inspect({
    [css]: '.label { color: var(--rest, var(--text-body)); }',
    [ui]: `export const View=()=> <><span className='[--rest:var(--text-muted)]'/><span style={{'--rest':'var(--text-body)'}}/></>`,
  })
  expect(withoutVerifiedColourUsages([usage()], report)).toEqual([])
  expect(report.verifiedUsages).toHaveLength(1)
  expect(report.verifiedUsages[0].references).toEqual(['--text-body', '--text-muted'])
  expect(withoutVerifiedColourUsages([usage()], report)).toEqual([])
  expect(report.verifiedUsages).toHaveLength(1)
})

test('usage approval is generic, follows alias chains, and checks every writer', () => {
  const files = {
    [css]: '.label { color: var(--unusual); --unusual: var(--alias); }',
    [ui]: `export const View=()=> <span style={{'--alias':'var(--text-muted)'}}/>`,
  }
  expect(withoutVerifiedColourUsages([usage('var(--unusual)')], inspect(files))).toEqual([])
  const report = inspect({
    ...files,
    'apps/sim/components/override.css': '.other { --alias: hotpink; }',
  })
  expect(withoutVerifiedColourUsages([usage('var(--unusual)')], report)).toHaveLength(1)
  expect(report.findings.length).toBeGreaterThan(0)
})

test('a valid fallback cannot approve a missing, literal, runtime, inherited or cyclic primary alias', () => {
  for (const writer of [
    '',
    '--rest: red;',
    '--rest: var(--missing);',
    '--rest: var(--radius);',
    '--rest: currentColor;',
    '--rest: var(--alias); --alias: var(--rest);',
  ]) {
    const report = inspect({ [css]: `.label { color: var(--rest, var(--text-body)); ${writer} }` })
    expect(withoutVerifiedColourUsages([usage()], report)).toHaveLength(1)
  }
  const runtime = inspect({
    [css]: '.label {color: var(--rest, var(--text-body));}',
    [ui]: `export function set(node, ink){node.style.setProperty('--rest', ink)}`,
  })
  expect(withoutVerifiedColourUsages([usage()], runtime)).toHaveLength(1)
  expect(runtime.findings).toEqual([])
  expect(
    runtime.unchecked.some((note) => note.reason.includes('Unresolved colour assignment'))
  ).toBe(true)
})

test('safe assignments cannot conceal a literal or invalid fallback at the use', () => {
  const report = inspect({ [css]: '.label {--rest: var(--text-body); color: var(--rest);}' })
  for (const value of [
    'var(--rest, hotpink)',
    'var(--rest, var(--missing))',
    'var(--rest, var(--text-muted, red))',
    'color-mix(in srgb, var(--rest) 50%, red)',
    'var(--rest,)',
    'var(--rest',
  ])
    expect(withoutVerifiedColourUsages([usage(value)], report)).toHaveLength(1)
  expect(
    withoutVerifiedColourUsages([usage('color-mix(in srgb, var(--rest) 50%, transparent)')], report)
  ).toEqual([])
})

test('local overrides of referenced global tokens revoke usage approval', () => {
  const report = inspect({
    [css]: '.label {--rest: var(--text-body); color: var(--rest); } .bad {--text-body: red;}',
  })
  expect(withoutVerifiedColourUsages([usage()], report)).toHaveLength(1)
  const indirect = inspect({
    [tokens]: ':root {--palette: #777; --text-body: var(--palette);}',
    [css]: '.label {--rest: var(--text-body); color: var(--rest);} .bad {--palette: hotpink;}',
  })
  expect(withoutVerifiedColourUsages([usage()], indirect)).toHaveLength(1)
  expect(indirect.findings.length).toBeGreaterThan(0)
})

test('unknown style writes remain unchecked even when a separately verified alias use is cleared', () => {
  const report = inspect({
    [css]: '.label {color: var(--rest);}',
    [ui]: `export const View=({style})=><span style={{'--rest':'var(--text-body)', ...style}}/>`,
  })
  const remaining = withoutVerifiedColourUsages([...report.findings, usage()], report)
  expect(remaining.some((f) => f.rule === 'central-colour-assignment')).toBe(false)
  expect(report.coverage.unresolved).toBeGreaterThan(0)
  expect(
    report.unchecked.some((note) => note.reason.includes('Unresolved colour assignment'))
  ).toBe(true)
})

test('colour provenance approval never suppresses component chrome, shadows, system changes or unrelated literals', () => {
  const report = inspect({ [css]: '.label {--rest: var(--text-body); color: var(--rest);}' })
  const findings = [
    { ...usage(), rule: 'component-chrome' },
    { ...usage(), rule: 'central-shadow' },
    { ...usage(), kind: 'system-change' as const },
    usage('hotpink'),
  ]
  expect(withoutVerifiedColourUsages(findings, report)).toEqual(findings)
})

test('registered custom-property defaults and escaped writer names cannot hide behind a safe ordinary assignment', () => {
  const files = { [css]: '.label {--rest: var(--text-body); color: var(--rest);}' }
  const extras: Record<string, string>[] = [
    {
      [css]: `${files[css]}@property --rest {syntax: "<color>"; inherits: false; initial-value: hotpink;}`,
    },
    {
      [ui]: `CSS.registerProperty({name:'--rest', syntax:'<color>', inherits:false, initialValue:'hotpink'})`,
    },
    { [css]: files[css] + String.raw`.bad {--r\65 st: hotpink;}` },
  ]
  for (const extra of extras) {
    const report = inspect({ ...files, ...extra })
    expect(report.findings.length + report.unchecked.length).toBeGreaterThan(0)
  }
})

test('CSS, JSX style objects and Tailwind assignments resolve actual global colours', () => {
  const result = inspect({
    [css]: '.label { --rest: var(--text-body); color: var(--rest); }',
    [ui]: `export const View=()=> <><span style={{'--rest':'var(--text-muted)'}}/><span className='[--rest:var(--text-body)]'/></>`,
  })
  expect(result.findings).toEqual([])
  expect(result.coverage.verified).toBeGreaterThanOrEqual(3)
})

test('hardcoded, missing and wrong-family tokens are flagged at the assignment', () => {
  for (const value of ['#ff00ff', 'red', 'var(--missing)', 'var(--radius)', 'var(--shadow)']) {
    const result = inspect({ [css]: `.label { --rest: ${value}; color: var(--rest); }` })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].property).toBe('--rest')
    expect(result.assignments[0].status).toBe('invalid')
  }
})

test('an approved primary value cannot hide an invalid fallback, nested fallback or mix operand', () => {
  for (const value of [
    'var(--text-body, #ff00ff)',
    'var(--text-body, var(--missing))',
    'var(--text-body, var(--text-muted, blue))',
    'color-mix(in srgb, var(--text-body) 50%, red)',
    'rgb(255 0 0)',
    'rgb(255 0 0 / var(--text-body))',
    'var(--text-body,)',
  ])
    expect(flagged({ [css]: `.label { --rest: ${value}; color: var(--rest); }` })).toHaveLength(1)
  expect(
    flagged({
      [css]:
        '.label { --rest: color-mix(in srgb, var(--text-body) 50%, transparent); color: var(--rest); }',
    })
  ).toEqual([])
})

test('every CSS selector/theme override is checked; a safe declaration cannot mask a bad one', () => {
  const result = inspect({
    [css]:
      '.good { --rest: var(--text-body); color: var(--rest); } .bad:hover { --rest: #ff00ff; }',
  })
  expect(result.findings).toHaveLength(1)
  expect(result.findings[0].context).toContain('.bad:hover')
})

test('aliases follow assignments across files and reject cycles, missing links and non-global leaves', () => {
  const extra = 'apps/sim/components/writer.css'
  const files = {
    [css]: '.label { --rest: var(--alias); color: var(--rest); }',
    [extra]: '.label { --alias: var(--text-body); }',
  }
  expect(flagged(files)).toEqual([])
  expect(
    flagged({ ...files, [extra]: '.label { --alias: #ff00ff; }' }).length
  ).toBeGreaterThanOrEqual(2)
  expect(
    flagged({ ...files, [extra]: '.label { --alias: var(--rest); }' }).every((finding) =>
      finding.reason.includes('Cyclic')
    )
  ).toBe(true)
})

test('import aliases, namespace access and barrels resolve immutable conditional values', () => {
  const extra = {
    'apps/sim/components/palette.ts': `export const ink = dark ? 'var(--text-body)' : 'var(--text-muted)'`,
    'apps/sim/components/barrel.ts': `export {ink as tone} from './palette'`,
    [css]: '.label { color: var(--rest); }',
    [ui]: `import * as P from './barrel'; export const View=()=> <span style={{'--rest':P.tone}}/>`,
  }
  expect(flagged(extra)).toEqual([])
  const bad = inspect({
    ...extra,
    'apps/sim/components/palette.ts': `export const ink = dark ? 'var(--text-body)' : '#ff00ff'`,
  })
  expect(bad.findings).toHaveLength(1)
  expect(bad.findings[0].value).toContain('#ff00ff')
})

test('runtime peer colours remain unchecked despite a valid global fallback', () => {
  const result = inspect({
    [css]: '.cursor { background-color: var(--caret-color); }',
    [ui]: `const DEFAULT='var(--text-body)'; export function renderCaret(user){ const caret=document.createElement('span'); const colour=typeof user.color==='string'?user.color:DEFAULT; caret.style.setProperty('--caret-color',colour); return caret }`,
  })
  expect(result.findings).toEqual([])
  expect(result.unchecked.some((note) => note.reason.includes('--caret-color'))).toBe(true)
  expect(result.assignments[0].status).toBe('unresolved')
})

test('a direct shadow sink accepts a complete global shadow recipe, not a colour lookalike', () => {
  const globalShadow = `${globals} :root { --shadow-presentation-slide: 0 2px 8px rgba(0, 0, 0, 0.15); }`
  const direct = (value: string) => ({
    [ui]: `export const View=()=> <div style={{boxShadow:'${value}'}}/>`,
    [tokens]: globalShadow,
  })
  const approved = inspect(direct('var(--shadow-presentation-slide)'))
  expect(approved.findings).toEqual([])
  expect(approved.assignments.some((a) => a.name === 'box-shadow' && a.status === 'verified')).toBe(
    true
  )
  for (const value of [
    'var(--shadow-missing)',
    'var(--shadow-presentation-slide, 0 0 3px red)',
    'var(--text-body)',
  ])
    expect(
      flagged(direct(value)).some((f) => f.property === 'box-shadow'),
      value
    ).toBe(true)
  expect(
    flagged({
      [tokens]: globalShadow,
      [ui]: `export const View=()=> <span style={{color:'var(--shadow-presentation-slide)'}}/>`,
    }).some((f) => f.property === 'color')
  ).toBe(true)
  const overridden = inspect({
    ...direct('var(--shadow-presentation-slide)'),
    [css]: '.local { --shadow-presentation-slide: 0 0 8px red; }',
  })
  expect(
    overridden.assignments.some((a) => a.name === 'box-shadow' && a.status === 'unresolved')
  ).toBe(true)
  expect(overridden.unchecked.some((note) => note.reason.includes('checked local override'))).toBe(
    true
  )
})

test('a safe conditional branch cannot mask a non-string or unknown branch', () => {
  for (const alternative of ['123', 'null', 'undefined', 'runtime', "'var(--missing)'"]) {
    const result = inspect({
      [css]: '.label { color: var(--rest); }',
      [ui]: `export const View=({ok,runtime})=> <span style={{'--rest':ok?'var(--text-body)':${alternative}}}/>`,
    })
    expect(result.findings.length + result.unchecked.length).toBeGreaterThan(0)
  }
})

test('imperative style writers, aliases, cssText and Object.assign cannot bypass assignment checks', () => {
  for (const statement of [
    `node.style.setProperty('--rest', '#ff00ff')`,
    `const style=node.style; style.setProperty('--rest', '#ff00ff')`,
    `node.style['--rest']='#ff00ff'`,
    `node.style.cssText='--rest:#ff00ff'`,
    `node.setAttribute('style','--rest:#ff00ff')`,
    `Object.assign(node.style, {'--rest':'#ff00ff'})`,
  ])
    expect(
      flagged({
        [css]: '.label { color: var(--rest); }',
        [ui]: `export function update(node){ ${statement} }`,
      }).length
    ).toBeGreaterThanOrEqual(1)
})

test('unknown spreads, mutated styles, dynamic keys and dynamic Tailwind values stay visible', () => {
  for (const jsx of [
    `<span style={{'--rest':'var(--text-body)', ...runtime}}/>`,
    `<span style={{...runtime, '--rest':'var(--text-body)'}}/>`,
    `<span style={{[key]:'var(--text-body)'}}/>`,
    `<span className={\`[--rest:\${colour}]\`}/>`,
  ])
    expect(
      issues({
        [css]: '.label { color: var(--rest); }',
        [ui]: `export const View=({runtime,key,colour})=>${jsx}`,
      }).length
    ).toBeGreaterThanOrEqual(1)
  expect(
    issues({
      [ui]: `const style={'--rest':'var(--text-body)'}; style['--rest']=runtime; export const View=()=> <span style={style}/>`,
    }).length
  ).toBeGreaterThanOrEqual(1)
})

test('local overrides of global tokens are checked too', () => {
  const result = inspect({ [css]: '.label { --text-body: #ff00ff; color: var(--text-body); }' })
  expect(result.findings).toHaveLength(1)
})

test('a missing token remains unchecked when its consumer is outside the source snapshot', () => {
  for (const body of [
    `<span className='[--rest:var(--missing)]'/>`,
    `<span style={{'--rest':'var(--missing)'}}/>`,
  ])
    expect(
      inspect({ [ui]: `export const View=()=>${body}` }).unchecked.some((note) =>
        note.reason.includes('--rest')
      )
    ).toBe(true)
  expect(
    issues({ [css]: '.label { --a: var(--b); --b: var(--a); }' }).length
  ).toBeGreaterThanOrEqual(2)
})

test('static prop spreads and React.createElement styles are checked at their use', () => {
  for (const body of [
    `const props={style:{'--rest':'#ff00ff'}}; export const View=()=> <span {...props}/>`,
    `import {createElement as h} from 'react'; export const View=()=>h('span',{style:{'--rest':'#ff00ff'}})`,
  ])
    expect(flagged({ [ui]: body })).toHaveLength(1)
  expect(
    flagged({
      [ui]: `const props={style:{['--rest']:'var(--text-body)'}}; export const View=()=> <span {...props}/>`,
    })
  ).toEqual([])
})

test('no colour-variable spelling whitelist; unrelated numeric variables stay outside this rule', () => {
  expect(
    flagged({
      [css]:
        '.label { --anything: #ff00ff; color: var(--anything); --width: 20px; width: var(--width); }',
    })
  ).toHaveLength(1)
  expect(
    flagged({ [ui]: `export const View=({width})=><span style={{'--width':width}}/>` })
  ).toEqual([])
})

test('layout aliases with dimensional fallbacks do not become colour assignments', () => {
  const files = {
    [css]:
      '.fade { --start: var(--inset, 0px); --end: calc(var(--inset, 0px) + var(--band)); mask-image: linear-gradient(transparent var(--start), black var(--end)); }',
    [ui]: `export const View=({className})=><span className={cn('[--inset:3rem]', className)}/>`,
  }
  expect(flagged(files)).toEqual([])
  // A dimension in a known colour sink is still invalid, even with a dimensional fallback.
  expect(
    flagged({ [css]: '.label { --ink: var(--missing, 3rem); color: var(--ink); }' })
  ).toHaveLength(1)
})

test('an unknown style property is unresolved, not a confirmed literal colour violation', () => {
  const result = inspect({ [ui]: `export function clear(node, key){ node.style[key]='none' }` })
  expect(result.findings).toEqual([])
  expect(result.assignments[0].status).toBe('unresolved')
  expect(result.unchecked.some((note) => note.reason.includes('Unknown style key'))).toBe(true)
})

test('landing remains excluded, source is never executed and discovery order is deterministic', () => {
  const files = source({
    [tokens]: globals,
    [ui]: `throw Error('never execute'); export const View=()=> <span className='[--rest:#ff00ff]'/>`,
    'apps/sim/app/(landing)/page.tsx': `export const Page=()=> <span className='[--rest:#00ff00]'/>`,
  })
  const forward = inspectSimplifications(files).colourAssignments
  const reverse = inspectSimplifications(
    { ...files, entries: [...files.entries].reverse() },
    [],
    'reverse'
  ).colourAssignments
  expect(reverse).toEqual(forward)
  expect(forward.findings.every((finding) => finding.file === ui)).toBe(true)
})

test('fresh style helpers prove property keys independently of runtime geometry values', () => {
  const helpers = [
    `function dimensions(width){return {width,height:runtime}}`,
    `const dimensions=(width)=>width?{width,height:runtime}:{top:runtime,left:runtime}`,
    `function dimensions(width){if(!width)return undefined;const span=Math.max(width,10);return {width:span,height:runtime}}`,
    `function dimensions(width){if(width){return {top:runtime}}else{return {left:runtime}}}`,
  ]
  for (const helper of helpers)
    expect(
      flagged({
        [ui]: `${helper}; export const View=()=> <span style={{position:'absolute',...dimensions(runtime)}}/>`,
      })
    ).toEqual([])
})

test('import aliases, namespace access and barrels resolve fresh style helpers', () => {
  expect(
    flagged({
      'apps/sim/components/shape.ts': `export const size=(width)=>({width,height:runtime})`,
      'apps/sim/components/barrel.ts': `export {size as dimensions} from './shape'`,
      [ui]: `import * as S from './barrel'; import {dimensions as D} from './barrel'; export const View=()=> <><span style={S.dimensions(runtime)}/><span style={D(runtime)}/></>`,
    })
  ).toEqual([])
})

test('helper colour properties are validated, including literals and unknown values', () => {
  for (const [value, status] of [
    ["'var(--text-body)'", 'verified'],
    ["'#ff00ff'", 'invalid'],
    ['runtime', 'unresolved'],
    ["'var(--missing)'", 'invalid'],
  ] as const) {
    const report = inspect({
      [ui]: `const style=()=>({width:runtime,color:${value}}); export const View=()=> <span style={style()}/>`,
    })
    expect(report.assignments.find((a) => a.name === 'color')?.status).toBe(status)
    expect(report.findings.length).toBe(status === 'invalid' ? 1 : 0)
    if (status === 'unresolved') expect(report.unchecked.length).toBeGreaterThan(0)
  }
})

test('a safe helper branch cannot hide colours, unknown spreads, mutation or unsupported flow', () => {
  for (const helper of [
    `const shape=(ok)=>ok?{width:runtime}:{'--ink':'hotpink'}`,
    `const shape=()=>({width:runtime,...opaque})`,
    `const shape=()=>({[runtime]:10})`,
    `const shape=()=>({get width(){return 10}})`,
    `const shape=()=>{const result={width:10};result.color='hotpink';return result}`,
    `const result={width:10};const shape=()=>result;unknown(result)`,
    `const shape=()=>{try{return {width:10}}finally{return opaque}}`,
    `const shape=()=>{for(const x of items){if(x)return opaque}return {width:10}}`,
    `const shape=()=>({...shape()})`,
    `let shape=()=>({width:10});shape=opaque`,
    `const shape=async()=>({width:10})`,
  ]) {
    const report = inspect({
      [css]: '.x {color:var(--ink)}',
      [ui]: `${helper}; export const View=()=> <span style={shape(runtime)}/>`,
    })
    expect(report.findings.length + report.unchecked.length, helper).toBeGreaterThan(0)
  }
  expect(
    issues({
      [ui]: `const shape=()=>({width:10});const result=shape();const alias=result;alias.color='hotpink';export const View=()=> <span style={result}/>`,
    }).length
  ).toBeGreaterThan(0)
})

test('literal joins and unshadowed String.raw resolve class assignments without trusting method names', () => {
  const classes = "const classes=[String.raw`[--ink:var(--text-body)]`,'opacity-100'].join(' ')"
  expect(
    flagged({ [ui]: `${classes};export const View=()=> <span className={classes}/>` })
  ).toEqual([])
  expect(
    flagged({
      'apps/sim/components/classes.ts':
        "const parts=[String.raw`[--ink:var(--text-body)]`,'opacity-100'];export const classes=parts.join(' ')",
      [ui]: `import {classes} from './classes';export const View=()=> <span className={classes}/>`,
    })
  ).toEqual([])
  for (const code of [
    "const parts=['[--ink:var(--text-body)]'];parts.push(runtime);const classes=parts.join(' ')",
    "const parts=['[--ink:var(--text-body)]'];unknown(parts);const classes=parts.join(' ')",
    "const parts={join:()=> '[--ink:hotpink]'};const classes=parts.join(' ')",
    'const String=external;const classes=String.raw`[--ink:var(--text-body)]`',
    "const classes=['[--ink:var(--text-body)]',runtime].join(' ')",
  ]) {
    const result = inspect({
      [css]: '.label {color:var(--ink)}',
      [ui]: `${code};export const View=()=> <span className={'[--ink:var(--text-body)] '+classes}/>`,
    })
    expect(result.findings.length + result.unchecked.length, code).toBeGreaterThan(0)
  }
  expect(
    flagged({
      [ui]: "const classes=['[--ink:var(--text-body)]','[--ink:hotpink]'].join(' ');export const View=()=> <span className={classes}/>",
    }).length
  ).toBeGreaterThan(0)
})

test('a global shadow must contain a complete shadow recipe, not just a named variable', () => {
  for (const definition of ['8px', 'red', 'var(--text-body)', '0 0 2px var(--missing)']) {
    const report = inspect({
      [tokens]: `${globals}:root{--shadow-card:${definition}}`,
      [ui]: 'export const A=()=> <span style={{boxShadow:"var(--shadow-card)"}}/>',
    })
    expect(report.verifiedUsages).toEqual([])
    expect([...report.findings, ...report.unchecked].length).toBeGreaterThan(0)
  }
  expect(
    inspect({
      [tokens]: `${globals}:root{--shadow-card:0 1px 2px #000}`,
      [ui]: 'export const A=()=> <span style={{boxShadow:"var(--shadow-card)"}}/>',
    }).assignments.some((a) => a.name === 'box-shadow' && a.status === 'verified')
  ).toBe(true)
})

test('unresolved layout-only aliases are not colour findings', () => {
  const report = inspect({ [css]: '.label{--layout:var(--missing);width:var(--layout)}' })
  expect(report.findings).toEqual([])
  expect(report.unchecked.some((n) => n.file === css && n.reason.includes('--layout'))).toBe(true)
  expect(flagged({ [css]: '.label{--ink:var(--missing);color:var(--ink)}' })).toHaveLength(1)
})
