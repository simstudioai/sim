/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Proposed source fixtures. */

import { expect, test } from 'vitest'
import { ConformanceLinter } from '#design-conformance/conformance'
import { extract } from '#design-conformance/extract'
import { type Change, type Entry, hash, TOKEN_FILE } from '#design-conformance/model'
import { SourceIndex } from '#design-conformance/source-summary'
import { snapshotHash } from '#design-conformance/system-snapshot'
import { testComponents } from '#design-conformance/test-source'

const root = 'apps/sim/components/'
const base = 'a'.repeat(40)
const central = {
  ...testComponents,
  'packages/emcn/src/index.ts':
    testComponents['packages/emcn/src/index.ts'] +
    ";export {Wizard} from './components/wizard/wizard'",
  [TOKEN_FILE]:
    '@theme {--text-small:13px;--radius-lg:8px;--shadow-card:0 1px 2px #000;} :root {--ink:#123456}',
  'packages/emcn/src/components/wizard/wizard.tsx': `import {ChipModalBody} from "@sim/emcn";const Root=({children})=><ChipModalBody>{children}</ChipModalBody>;const Step=({children})=><>{children}</>;export const Wizard=Object.assign(Root,{Step})`,
}
async function compare(
  before: Record<string, string>,
  after: Record<string, string>,
  inventory: Record<string, string> = {}
) {
  const blobs = new Map<string, string>()
  const entry = (path: string, text: string | undefined) => {
    if (text === undefined) return null
    const blob = hash(text).slice(0, 40)
    blobs.set(blob, text)
    return { path, blob, mode: '100644' }
  }
  const changes: Change[] = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .map((path) => ({
      status: 'M',
      before: entry(path, before[path]),
      after: entry(path, after[path]),
    }))
  const sources = {
    ...central,
    ...inventory,
    'packages/emcn/src/index.ts': `${central['packages/emcn/src/index.ts']}\n${inventory['packages/emcn/src/index.ts'] ?? ''}`,
    ...Object.fromEntries(Object.entries(before).filter(([p]) => p.startsWith('packages/emcn/'))),
  }
  const entries = Object.entries(sources)
    .flatMap(([p, value]) => {
      const e = entry(p, value)
      return e ? [e] : []
    })
    .sort((a, b) => a.path.localeCompare(b.path))
  return new ConformanceLinter().analyze(
    changes,
    (e: Entry) => {
      const text = blobs.get(e.blob)
      if (text === undefined) throw new Error('Missing fixture blob')
      return text
    },
    { base, head: 'b'.repeat(40), mergeBase: base },
    {
      snapshot: { version: '1.0.0', commit: base, hash: snapshotHash(entries), entries },
      read: (e: Entry) => {
        const text = blobs.get(e.blob)
        if (text === undefined) throw new Error('Missing fixture blob')
        return text
      },
    }
  )
}
const debt = '<span className="font-bold text-small">{label}</span>'
test('component extraction surfaces authored debt; central component reuse does not multiply findings', async () => {
  const before = { [`${root}old.tsx`]: `export function Old({label}) {return ${debt}}` }
  const after = {
    [`${root}old.tsx`]: `import {New} from './new'; export function Old(props) {return <New {...props}/>}`,
    [`${root}new.tsx`]: `export function New({label}) {return ${debt}}`,
  }
  expect((await compare(before, after)).flagged).toBe(true)
  expect(
    (
      await compare(before, {
        ...after,
        [`${root}new.tsx`]: `export function New({label}) {return <>${debt}${debt}</>}`,
      })
    ).findings
  ).toHaveLength(2)
  expect(
    (
      await compare(before, {
        ...after,
        [`${root}new.tsx`]: `export function New({label}) {return <span className="text-[17px]">{label}</span>}`,
      })
    ).flagged
  ).toBe(true)
  expect(
    (
      await compare(before, {
        ...after,
        [`${root}another.tsx`]: `import {New} from './new'; export const Another=()=> <New label="new"/>`,
      })
    ).flagged
  ).toBe(true)
})
test('unrelated deletion never authorizes equal debt in another source owner', async () => {
  expect(
    (
      await compare(
        { [`${root}a.tsx`]: `const A=()=>${debt}` },
        { [`${root}b.tsx`]: `const B=()=>${debt}` }
      )
    ).flagged
  ).toBe(true)
})
test('import identified transparent primitive replacements preserve central definitions', async () => {
  const p = 'packages/emcn/src/components/choice/choice.tsx'
  const before = `export const Choice=()=> <div className="flex rounded-lg"><button className="text-small">Pick</button></div>`
  const after = `import * as R from '@radix-ui/react-radio-group';export const Choice=()=> <R.Root className="flex rounded-lg"><R.Item className="text-small">Pick</R.Item></R.Root>`
  expect((await compare({ [p]: before }, { [p]: after })).flagged).toBe(false)
  expect(
    (await compare({ [p]: before }, { [p]: after.replace('rounded-lg', 'rounded-full') })).flagged
  ).toBe(true)
  expect(
    (
      await compare(
        { [p]: before },
        { [p]: after.replace('@radix-ui/react-radio-group', 'unknown-library') }
      )
    ).flagged
  ).toBe(true)
})
test('central wrapper ancestry reaches nested local labelled fields without guessing names', async () => {
  const p = `${root}form.tsx`
  const body = `function Entry(){return <div><div><Label>Thing</Label></div><section><ChipInput/></section></div>}`
  const shared = `import {Wizard,ChipInput,ChipModalBody,ChipModalField,Label} from '@sim/emcn';`
  const code = `${shared}${body}export const Screen=()=> <Wizard><Wizard.Step><Entry/></Wizard.Step></Wizard>`
  const r = await compare({}, { [p]: code })
  expect(r.findings.some((f) => f.contract === 'modal-field')).toBe(true)
  expect(
    (await compare({ [p]: code }, { [p]: code.replace('Thing', 'Other words') })).flagged
  ).toBe(false)
  expect(
    (
      await compare(
        {},
        {
          [p]: code.replace(
            '<Entry/>',
            '<ChipModalField type="custom" title="Thing"><Entry/></ChipModalField>'
          ),
        }
      )
    ).flagged
  ).toBe(false)
  const local = `${shared}${body}function Unusual({children}){return <ChipModalBody>{children}</ChipModalBody>} export const Screen=()=> <Unusual><Entry/></Unusual>`
  expect(
    (await compare({}, { [p]: local })).findings.some((f) => f.contract === 'modal-field')
  ).toBe(true)
  expect(
    (
      await compare(
        {},
        {
          [p]: local.replace(
            '<ChipModalBody>{children}</ChipModalBody>',
            '<main>{children}</main>'
          ),
        }
      )
    ).flagged
  ).toBe(false)
})
test('named child slots preserve field ancestry and approved inputs', async () => {
  const p = `${root}slot.tsx`
  const code = `import {ChipModalBody,ChipInput,Label} from '@sim/emcn';function Frame({content}){return <ChipModalBody>{content}</ChipModalBody>} export const Screen=()=> <Frame content={<div><Label>One</Label><ChipInput/></div>}/>`
  expect(
    (await compare({}, { [p]: code })).findings.some((f) => f.contract === 'modal-field')
  ).toBe(true)
})
test('SVG UI typography checks changed-module constants while artwork remains exempt', async () => {
  const p = `${root}plot.tsx`
  const constants = `${root}numbers.ts`
  const ui = `import {tick} from './numbers';export const Plot=()=> <svg><path fill="#abcdef" d="M0 0"/><text fontSize={tick}><tspan fontWeight="500">Axis</tspan></text></svg>`
  const r = await compare({}, { [p]: ui, [constants]: `export const tick=9` })
  expect(r.findings.some((f) => f.property === 'font-size' && f.value === '9px')).toBe(true)
  expect(r.findings.some((f) => f.property === 'font-weight')).toBe(true)
  expect(r.findings.some((f) => f.category === 'colours')).toBe(false)
  expect(
    (
      await compare(
        {},
        {
          [p]: ui
            .replace('fontSize={tick}', 'className="text-small"')
            .replace('fontWeight="500"', 'className="font-medium"'),
          [constants]: `export const tick=9`,
        }
      )
    ).flagged
  ).toBe(false)
})
test('conditional style spreads retain explicit recipe structure and unknown parameters', async () => {
  const p = 'packages/emcn/src/components/token/token.tsx'
  const old = `export const Tag=({style,color,active})=> <span style={{...style}}/>`
  const next =
    'export const Tag=({style,color,active})=> <span style={{...style,...(active ? {boxShadow:`inset 0 0 0 1px ${color}`} : {})}}/>'
  expect(
    (await compare({ [p]: old }, { [p]: next })).findings.some(
      (f) => f.kind === 'system-change' && f.property === 'box-shadow'
    )
  ).toBe(true)
  expect((await compare({ [p]: next }, { [p]: next.replace('1px', '2px') })).flagged).toBe(true)
  expect(
    (
      await compare(
        { [p]: next },
        {
          [p]: 'export const Tag=({style,color,active})=> <span style={unknownHelper(style,color,active)}/>',
        }
      )
    ).flagged
  ).toBe(false)
  expect(
    (await compare({}, { [`${root}tag.tsx`]: next })).findings.some(
      (f) => f.contract === 'central-shadow'
    )
  ).toBe(true)
})
test('object spread and template refactors preserve the same styling and precedence', async () => {
  const p = `${root}sample.tsx`
  const before = 'const A=()=> <p style={{color:"#123456"}}/>'
  expect(
    (
      await compare(
        { [p]: before },
        { [p]: 'const same={color:"#123456"};const A=()=> <p style={{...same}}/>' }
      )
    ).flagged
  ).toBe(false)
  expect(
    (await compare({}, { [p]: 'const A=()=> <p style={{...(false && {color:"#123456"})}}/>' }))
      .flagged
  ).toBe(false)
  const s = 'export const Tag=({color})=> <span style={{boxShadow:`inset 0 0 0 1px ${color}`}}/>'
  expect(
    (
      await compare(
        { [p]: s },
        { [p]: s.replace('`inset 0 0 0 1px ${color}`', '"inset 0 0 0 1px " + color') }
      )
    ).flagged
  ).toBe(false)
})
test('map callback syntax retains modal body spacing ownership', async () => {
  const p = `${root}rows.tsx`
  const code =
    'import {ChipModalBody,ChipModalField} from "@sim/emcn";const Screen=()=> <ChipModalBody>{rows.map(row=>{return <div className="space-y-3"><ChipModalField title={row.label}/></div>})}</ChipModalBody>'
  expect(
    (await compare({}, { [p]: code })).findings.some((f) => f.contract === 'component-chrome')
  ).toBe(true)
  expect(
    (
      await compare(
        {},
        {
          [p]: code.replace(
            '<div className="space-y-3"><ChipModalField title={row.label}/></div>',
            '<section><div className="space-y-3"><ChipModalField title={row.label}/></div></section>'
          ),
        }
      )
    ).flagged
  ).toBe(false)
})
test('a protected conditional branch cannot exempt a separate unprotected field branch', async () => {
  const p = `${root}branches.tsx`
  const code =
    'import {ChipModalBody,ChipModalField,ChipInput,Label} from "@sim/emcn";function Frame({children,flag}){const content=children;return flag ? <ChipModalBody>{content}</ChipModalBody> : <ChipModalBody><ChipModalField type="custom" title="T">{content}</ChipModalField></ChipModalBody>}const Screen=()=> <Frame><div><Label>Title</Label><ChipInput/></div></Frame>'
  expect(
    (await compare({}, { [p]: code })).findings.some((f) => f.contract === 'modal-field')
  ).toBe(true)
})
test('local artwork needs central ownership but UI-text ancestor typography is governed', async () => {
  const p = `${root}picture.tsx`
  expect(
    (
      await compare(
        {},
        { [p]: 'const A=()=> <svg fill="#123456"><g fill="#654321"><path d="M0 0"/></g></svg>' }
      )
    ).flagged
  ).toBe(true)
  expect(
    (
      await compare({}, { [p]: 'const A=()=> <svg><g fontSize="9"><text>Axis</text></g></svg>' })
    ).findings.some((f) => f.property === 'font-size')
  ).toBe(true)
})
test('cross-module arithmetic, cyclic exports and unknown helpers remain unchecked and do not execute', async () => {
  const p = `${root}safe.tsx`
  const c = `${root}constants.ts`
  const ui =
    'import {size} from "./constants";globalThis.SOURCE_RAN=true;const A=()=> <svg><text fontSize={size}>Axis</text></svg>'
  const r = await compare({}, { [p]: ui, [c]: 'const x=1;const y=2;export const size=x+y' })
  expect(r.flagged).toBe(false)
  expect(r.unchecked.some((n) => n.reason.includes('Imported styling input'))).toBe(true)
  const cycle = await compare(
    {},
    {
      [p]: ui,
      [c]: 'export {size} from "./loop"',
      [`${root}loop.ts`]: 'export {size} from "./constants"',
    }
  )
  expect(cycle.status).toBe('completed')
  expect(cycle.flagged).toBe(false)
  expect('SOURCE_RAN' in globalThis).toBe(false)
})
test('source summary budgets and cycles report unchecked coverage', () => {
  const file = `${root}limit.tsx`
  const facts = extract('export const A=({children})=><A>{children}</A>', file, true, {
    conformance: true,
    resolve: () => undefined,
  })
  const small = new SourceIndex([{ file, facts }], 1)
  expect(small.notes.some((n) => n.reason.includes('summary limit'))).toBe(true)
  expect(small.value(`${root}limit#A`)).toBeUndefined()
  const normal = new SourceIndex([{ file, facts }])
  normal.contexts(
    {
      kind: 'element',
      owner: 'Screen',
      target: 'div',
      shared: false,
      line: 1,
      column: 1,
      atoms: [],
      references: [],
      routes: [{ target: `${root}limit#A`, slot: 'children' }],
    },
    file
  )
  expect(normal.notes.some((n) => n.reason.includes('cycle'))).toBe(true)
})
test('barrel aliases retain literal provenance and original use locations', async () => {
  const p = `${root}text.tsx`
  const r = await compare(
    {},
    {
      [p]: 'import {font} from "./barrel";\nconst A=()=> <p style={{fontSize:font}}/>',
      [`${root}barrel.ts`]: 'export {size as font} from "./value"',
      [`${root}value.ts`]: 'export const size=17',
    }
  )
  expect(r.findings).toHaveLength(1)
  expect(r.findings[0].line).toBe(2)
  expect(r.findings[0].value).toBe('17px')
})

test('fixed central exports carry children contracts without an application import crawl', async () => {
  const p = `${root}screen.tsx`
  const inventory = {
    'packages/emcn/src/index.ts': 'export {Frame} from "./components/frame/frame"',
    'packages/emcn/src/components/frame/frame.tsx':
      'import {ChipModalBody} from "@sim/emcn";export const Frame=({children})=><ChipModalBody>{children}</ChipModalBody>',
  }
  const code =
    'import {Frame,ChipInput,Label} from "@sim/emcn";const A=()=> <Frame><div><Label>Name</Label><ChipInput/></div></Frame>'
  expect(
    (await compare({}, { [p]: code }, inventory)).findings.some((f) => f.contract === 'modal-field')
  ).toBe(true)
  expect(
    (
      await compare(
        {},
        {
          [p]: code
            .replace('Frame,ChipInput', 'Unknown,ChipInput')
            .replaceAll('<Frame>', '<Unknown>')
            .replaceAll('</Frame>', '</Unknown>'),
        },
        inventory
      )
    ).flagged
  ).toBe(false)
})
test('explicit styling forwards preserve protected and permitted destination slots', async () => {
  const p = `${root}wrapped.tsx`
  const code =
    'import {ChipInput} from "@sim/emcn";const Wrap=({bodyClassName})=><ChipInput className={bodyClassName}/>;const A=()=> <Wrap bodyClassName="px-4"/>'
  const r = await compare({}, { [p]: code })
  expect(
    r.findings.some((f) => f.contract === 'component-chrome' && f.reason.includes('forwarded'))
  ).toBe(true)
  expect(
    (
      await compare(
        {},
        { [p]: code.replace('<ChipInput className=', '<ChipInput inputClassName=') }
      )
    ).flagged
  ).toBe(false)
})
test('central extraction preserves packaging but changes and boundary crossings notify', async () => {
  const p = 'packages/emcn/src/components/example/example.tsx'
  const q = 'packages/emcn/src/components/example/part.tsx'
  const before = { [p]: 'export const Example=()=> <span className="font-bold text-small"/>' }
  const after = {
    [p]: 'import {Part} from "./part";export const Example=()=> <Part/>',
    [q]: 'export const Part=()=> <span className="font-bold text-small"/>',
  }
  expect((await compare(before, after)).flagged).toBe(false)
  expect(
    (await compare(before, { ...after, [q]: after[q].replace('text-small', 'text-[19px]') }))
      .flagged
  ).toBe(true)
  const consumer = `${root}part.tsx`
  expect(
    (
      await compare(before, {
        [p]: `import {Part} from "../../../../../${consumer}";export const Example=()=> <Part/>`,
        [consumer]: after[q],
      })
    ).flagged
  ).toBe(true)
})
test('HTML and rendered HTML presentation inputs share typography rules and source mapping', async () => {
  const html =
    '<svg><title font-size="8">Accessible name</title><path fill="#abcdef"/><g font-size="9"><text>Axis</text></g></svg>'
  expect(
    (await compare({}, { [`${root}chart.html`]: html })).findings.map((f) => f.property)
  ).toEqual(['font-size'])
  const r = await compare(
    {},
    { [`${root}chart.tsx`]: `const A=()=> <div dangerouslySetInnerHTML={{__html:\n'${html}'}}/>` }
  )
  expect(r.findings).toHaveLength(1)
  expect(r.findings[0].line).toBe(2)
  expect(
    (
      await compare(
        {},
        { [`${root}chart.html`]: html.replace('font-size="9"', 'font-size="var(--text-small)"') }
      )
    ).flagged
  ).toBe(false)
})
test('central spread precedence and separate dynamic recipes retain locations and parameters', async () => {
  const p = 'packages/emcn/src/components/example/example.tsx'
  const old =
    'const common={color:"red"};export const A=()=> <span style={{...common,color:"blue"}}/>'
  expect(
    (
      await compare(
        { [p]: old },
        { [p]: old.replace('...common,color:"blue"', 'color:"blue",...common') }
      )
    ).flagged
  ).toBe(true)
  const code =
    'export const A=({ink})=><span style={{boxShadow:`inset 0 0 0 1px ${ink}`}}/>;\nexport const B=({color})=><span style={{boxShadow:`inset 0 0 0 2px ${color}`}}/>'
  const r = await compare({ [p]: code }, { [p]: code.replace('2px', '3px') })
  expect(r.findings).toHaveLength(1)
  expect(r.findings[0].line).toBe(2)
  expect(r.findings[0].value).toContain('${color}')
})

test('an absent forwarded prop cannot activate a conditional modal styling branch', async () => {
  const p = `${root}guard.tsx`
  const code =
    'import {ChipModalBody,ChipModalField} from "@sim/emcn";function Extra({footer}){return footer ? <div className="px-2"><ChipModalField title={footer}/></div> : null}const A=()=> <ChipModalBody><Extra/></ChipModalBody>'
  expect((await compare({}, { [p]: code })).flagged).toBe(false)
  expect(
    (await compare({}, { [p]: code.replace('<Extra/>', '<Extra footer={content}/>') })).flagged
  ).toBe(true)
  expect((await compare({}, { [p]: code.replace('footer})', 'footer="Default"})') })).flagged).toBe(
    true
  )
})

test('conditional return syntax and shadowed imports never invent wrapper authority', async () => {
  const p = `${root}conditions.tsx`
  const code =
    'import {ChipModalBody,ChipInput,Label} from "@sim/emcn";function Frame({children,active}){if(active)return <ChipModalBody>{children}</ChipModalBody>;return <section>{children}</section>}const A=()=> <Frame><div><Label>T</Label><ChipInput/></div></Frame>'
  expect(
    (await compare({}, { [p]: code })).findings.some((f) => f.contract === 'modal-field')
  ).toBe(true)
  expect(
    (
      await compare(
        {},
        { [p]: code.replace('{children,active}', '{children,active,ChipModalBody}') }
      )
    ).flagged
  ).toBe(false)
})
test('a changed-module re-export retains a fixed central literal reference', async () => {
  const p = `${root}text.tsx`
  const q = `${root}bridge.ts`
  const inventory = {
    'packages/emcn/src/index.ts': 'export {size} from "./lib/size"',
    'packages/emcn/src/lib/size.ts': 'export const size="13px"',
  }
  const after = {
    [p]: 'import {size} from "./bridge";const A=()=> <p style={{fontSize:size}}/>',
    [q]: 'export {size} from "@sim/emcn"',
  }
  expect((await compare({}, after, inventory)).flagged).toBe(false)
  expect(
    (await compare({}, { ...after, [q]: 'export const size="13px"' }, inventory)).flagged
  ).toBe(true)
})

test('a preserved early-return branch does not exempt debt in an extracted implementation', async () => {
  const p = `${root}old.tsx`
  const q = `${root}new.tsx`
  const before = {
    [p]: `import {Loader} from '@sim/emcn';export function Old({loading,label}){if(loading)return <Loader/>;return ${debt}}`,
  }
  const after = {
    [p]: `import {Loader} from '@sim/emcn';import {New} from './new';export function Old({loading,label}){if(loading)return <Loader/>;return <New label={label}/>} `,
    [q]: `export const New=({label})=>${debt}`,
  }
  expect((await compare(before, after)).flagged).toBe(true)
  expect(
    (await compare(before, { ...after, [q]: after[q].replace('font-bold', 'text-[17px]') })).flagged
  ).toBe(true)
})

test('a central relative import retains its target when styling becomes wholly computed', async () => {
  const p = 'packages/emcn/src/components/frame/frame.tsx'
  const inventory = {
    'packages/emcn/src/index.ts': 'export {ChipInput} from "./components/input/input"',
    'packages/emcn/src/components/input/input.tsx': 'export const ChipInput=()=> <input/>',
  }
  const before =
    'import {ChipInput} from "../input/input";const Frame=({className})=> <ChipInput className={cn("w-fit",className)}/>'
  expect(
    (
      await compare(
        { [p]: before },
        { [p]: before.replace('cn("w-fit",className)', 'className') },
        inventory
      )
    ).flagged
  ).toBe(false)
  expect(
    (await compare({ [p]: before }, { [p]: before.replace('w-fit', 'w-full') }, inventory)).flagged
  ).toBe(true)
})

test('source-proven modal composition distinguishes prose from actual field groups', async () => {
  const wrapper = `${root}dialog-layout.tsx`
  const screen = `${root}dialog-content.tsx`
  const layout =
    'import {ChipModalBody} from "@sim/emcn"; export const Layout=({children})=><ChipModalBody>{children}</ChipModalBody>'
  const prose =
    'import {Layout} from "./dialog-layout";import {ChipModalField} from "@sim/emcn"; const Screen=()=> <Layout><div className="flex flex-col gap-2 px-2"><p>Fields</p><ul><li>Description</li></ul></div></Layout>'
  expect((await compare({}, { [wrapper]: layout, [screen]: prose })).flagged).toBe(false)
  expect(
    (
      await compare(
        {},
        {
          [wrapper]: layout,
          [screen]: prose.replace(
            '<p>Fields</p><ul><li>Description</li></ul>',
            '<ChipModalField title="Name"/>'
          ),
        }
      )
    ).findings.some((f) => f.contract === 'component-chrome')
  ).toBe(true)
})
