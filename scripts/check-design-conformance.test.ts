/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Fixtures contain proposed source text. */
import { expect, test } from 'vitest'
import { ConformanceLinter } from '#design-conformance/conformance'
import { designSystem } from '#design-conformance/design-system'
import { type Entry, hash, TOKEN_FILE } from '#design-conformance/model'
import { type SystemInput, snapshotHash } from '#design-conformance/system-snapshot'

const ui = 'apps/sim/components/example.tsx'
const base = 'a'.repeat(40)
const head = 'b'.repeat(40)
const commits = { base, head, mergeBase: base }
const globals = `@theme {--text-small:13px;--font-mono:monospace;--font-body:system-ui;--color-brand:var(--brand);--radius-lg:8px;--shadow-card:0 1px 2px #000;}:root{--text-body:#434343;--text-muted:#777;--text-error:#f00;--brand:#abc;--border:#ddd}`
const centralSources: Record<string, string> = {
  [TOKEN_FILE]: globals,
  'packages/emcn/src/index.ts': `export * from './components'`,
  'packages/emcn/src/components/index.ts': `export * from './button/button'`,
  'packages/emcn/src/components/button/button.tsx': `import {cva} from 'class-variance-authority'; export const buttonVariants=cva('rounded-lg',{variants:{variant:{normal:'text-[var(--text-body)]',error:'text-[var(--text-error)]'}}});export const centralTextClass='text-small text-[var(--text-body)]'; export const centralColour='#434343';export const Button=()=> <button className={buttonVariants()}/>`,
}
function input(sources = centralSources): SystemInput {
  const entries = Object.entries(sources)
    .map(([path, text]) => ({ path, blob: hash(text).slice(0, 40), mode: '100644' }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return {
    snapshot: { version: '1.0.0', commit: base, hash: snapshotHash(entries), entries },
    read: (e) => sources[e.path],
  }
}
const linter = new ConformanceLinter()
async function diff(
  before: string,
  after: string,
  file = ui,
  sources = centralSources,
  oldFile = file
) {
  const b: Entry = { path: oldFile, blob: hash(before).slice(0, 40), mode: '100644' }
  const a: Entry = { path: file, blob: hash(after).slice(0, 40), mode: '100644' }
  return linter.analyze(
    [{ status: 'M', before: b, after: a }],
    (e) => (e === b ? before : after),
    commits,
    input(sources)
  )
}
const text = (classes: string) => `const A=()=> <p className=${JSON.stringify(classes)}>Text</p>`
const shared = (body: string) =>
  `import {Button,Chip,ChipInput,ChipTextarea,ChipModalBody,ChipModalField,ChipTag,cn} from '@sim/emcn';const A=()=> <>${body}</>`
for (const classes of [
  'text-small text-[var(--text-body)]',
  'font-mono',
  'text-brand',
  'font-medium',
  'rounded-lg shadow-card',
  'text-sm',
  'text-white',
])
  test(`approved ${classes} passes`, async () =>
    expect((await diff('', text(classes))).flagged).toBe(false))
for (const classes of [
  'text-[#434343]',
  'text-[13px]',
  'font-[450]',
  'font-bold',
  'font-[ComicSans]',
  'rounded-[8px]',
  'shadow-[0_1px_2px_#000]',
  'text-pink-500',
])
  test(`unapproved ${classes} flags`, async () =>
    expect((await diff('', text(classes))).findings.length).toBeGreaterThan(0))
test('semantic choice of approved colour/font is unrestricted', async () => {
  expect(
    (await diff(text('text-[var(--text-body)]'), text('text-[var(--text-error)] font-mono')))
      .flagged
  ).toBe(false)
  expect(
    (
      await diff(
        shared('<Button variant="normal">Save</Button>'),
        shared('<Button variant="error">Save</Button>')
      )
    ).flagged
  ).toBe(false)
})
test('new composition and ungoverned dimensions/spacing pass', async () => {
  expect(
    (
      await diff(
        '',
        shared(
          '<div className="flex gap-2 p-[773px] w-[321px]"><Button>A</Button><Button>B</Button></div>'
        )
      )
    ).flagged
  ).toBe(false)
})
test('component ownership flags central-token chrome overrides', async () => {
  const r = await diff('', shared('<ChipInput className="bg-[var(--text-body)] px-2"/>'))
  expect(r.findings.every((f) => f.contract === 'component-chrome')).toBe(true)
  expect(r.findings.length).toBe(2)
  expect(
    (
      await diff(
        '',
        shared('<ChipInput className="min-w-0 flex-1 w-[321px]" inputClassName="font-mono"/>')
      )
    ).flagged
  ).toBe(false)
})
test('basic EMCN components report caller changes to their owned appearance', async () => {
  const examples = [
    [
      'Label',
      '<Label className="text-[var(--text-muted)]">Name</Label>',
      'text-[var(--text-muted)]',
    ],
    ['Textarea', '<Textarea className="rounded-lg" />', 'rounded-lg'],
    ['Combobox', '<Combobox options={[]} className="rounded-lg" />', 'rounded-lg'],
    ['Checkbox', '<Checkbox className="size-5" />', 'size-5'],
    ['Switch', '<Switch className="bg-[var(--brand)]" />', 'bg-[var(--brand)]'],
    [
      'ChipTag',
      '<ChipTag className="text-[var(--text-body)]">Tag</ChipTag>',
      'text-[var(--text-body)]',
    ],
    ['Avatar', '<Avatar className="rounded-md" />', 'rounded-md'],
    ['AvatarFallback', '<AvatarFallback className="border-0">A</AvatarFallback>', 'border-0'],
    ['Banner', '<Banner className="bg-[var(--brand)]" />', 'bg-[var(--brand)]'],
    ['Skeleton', '<Skeleton className="bg-[var(--brand)]" />', 'bg-[var(--brand)]'],
    [
      'OverflowText',
      '<OverflowText label="Name" className="overflow-visible" />',
      'overflow-visible',
    ],
    ['Code.Container', '<Code.Container className="border-0">Code</Code.Container>', 'border-0'],
    [
      'Code.Gutter',
      '<Code.Gutter width={20} className="rounded-none">1</Code.Gutter>',
      'rounded-none',
    ],
    [
      'Code.Viewer',
      '<Code.Viewer code="x" className="rounded-md border-0 bg-[var(--brand)]!" />',
      'rounded-md',
    ],
    ['DropdownMenuContent', '<DropdownMenuContent className="rounded-md" />', 'rounded-md'],
    ['DropdownMenuItem', '<DropdownMenuItem className="gap-2">Open</DropdownMenuItem>', 'gap-2'],
    ['PopoverItem', '<PopoverItem className="px-4">Open</PopoverItem>', 'px-4'],
    ['PopoverSection', '<PopoverSection className="px-4">Group</PopoverSection>', 'px-4'],
    ['InputOTPSlot', '<InputOTPSlot index={0} className="rounded-lg" />', 'rounded-lg'],
    [
      'SecretInput',
      '<SecretInput value="x" onChange={()=>{}} className="rounded-lg" />',
      'rounded-lg',
    ],
    ['CopyCodeButton', '<CopyCodeButton code="x" className="rounded-lg" />', 'rounded-lg'],
  ] as const
  for (const [name, jsx, value] of examples) {
    const result = await diff(
      '',
      `import {${name.split('.')[0]}} from '@sim/emcn';const A=()=>${jsx}`
    )
    expect(
      result.findings.some(
        (finding) => finding.rule === 'component-chrome' && finding.value === value
      ),
      name
    ).toBe(true)
    if (name === 'Code.Viewer')
      expect(
        new Set(
          result.findings
            .filter((finding) => finding.rule === 'component-chrome')
            .map((finding) => finding.value)
        )
      ).toEqual(new Set(['rounded-md', 'border-0', 'bg-[var(--brand)]!']))
  }
})
test('contextual appearance and unrelated lookalikes remain available', async () => {
  const examples = [
    '<Skeleton className="h-4 w-8 rounded-full" />',
    '<OverflowText label="Long name" className="text-[var(--text-body)] w-full" />',
    '<Banner className="text-[var(--text-body)]" />',
    '<Code.Viewer code="x" className="max-w-full [word-break:break-all]" />',
  ]
  for (const jsx of examples) {
    const result = await diff(
      '',
      `import {Skeleton,OverflowText,Banner,Code} from '@sim/emcn';const A=()=>${jsx}`
    )
    expect(
      result.findings.filter((finding) => finding.rule === 'component-chrome'),
      jsx
    ).toEqual([])
  }
  const local = await diff(
    '',
    `const Code={Viewer:({className}:any)=><div className={className}/>};const A=()=> <Code.Viewer className="rounded-md" />`
  )
  expect(local.findings.filter((finding) => finding.rule === 'component-chrome')).toEqual([])
})
test('Code.Viewer ownership works through namespace imports and inline styles', async () => {
  const report = await diff(
    '',
    `import * as E from '@sim/emcn'; const A=()=> <E.Code.Viewer code="x" className="rounded-md" style={{backgroundColor:'var(--brand)'}} />`
  )
  expect(
    report.findings
      .filter((finding) => finding.rule === 'component-chrome')
      .map((finding) => finding.property)
  ).toEqual(expect.arrayContaining(['border-radius', 'background-color']))
})
test('another Code.Viewer override is new debt inside the same owner', async () => {
  const viewer = '<Code.Viewer code="x" className="border-0" />'
  const source = (body: string) => `import {Code} from '@sim/emcn';const A=()=> <div>${body}</div>`
  const report = await diff(source(viewer), source(`${viewer}${viewer}`))
  expect(
    report.findings
      .filter((finding) => finding.rule === 'component-chrome' && finding.value === 'border-0')
      .map((finding) => finding.property)
  ).toEqual(['border-style', 'border-width'])
})
test('copied mistakes add occurrences; untouched debt and wording pass', async () => {
  const item = '<p className="text-[#434343]">Text</p>'
  expect((await diff(shared(item), shared(item + item))).findings.length).toBe(1)
  expect((await diff(shared(item), shared(item.replace('Text', 'Other words')))).flagged).toBe(
    false
  )
  expect((await diff(shared(item), shared(''))).flagged).toBe(false)
})
test('moving debt to a new file surfaces it for review', async () => {
  const item = text('text-[#434343]')
  expect(
    (
      await diff(
        item,
        `\n/** moved */\n${item}`,
        'apps/sim/components/renamed.tsx',
        centralSources,
        ui
      )
    ).flagged
  ).toBe(true)
})
test('file-local aliases cannot launder literal colours', async () => {
  expect(
    (await diff('', `const colour='#434343';const A=()=> <p style={{color:colour}}/>`)).flagged
  ).toBe(true)
  expect((await diff('', `const c='text-[#434343]';const A=()=> <p className={c}/>`)).flagged).toBe(
    true
  )
  expect(
    (await diff(text('text-small'), `const c='text-small';const A=()=> <p className={c}/>`)).flagged
  ).toBe(false)
})
test('central exported recipes and aliases preserve provenance', async () => {
  const source = `import {centralTextClass as cls} from '@sim/emcn';const alias=cls;const A=()=> <p className={alias}/>`
  const r = await diff('', source)
  expect(r.flagged).toBe(false)
  expect(r.unchecked).toEqual([])
  const b = `import {buttonVariants} from '@sim/emcn';const A=()=> <p className={buttonVariants({variant:'error'})}/>`
  expect((await diff('', b)).flagged).toBe(false)
  expect(
    (await diff('', b.replace("variant:'error'", "variant:'error',className:'text-[#123456]'")))
      .flagged
  ).toBe(true)
})
test('documented brand slots pass and ordinary literal colours flag', async () => {
  expect((await diff('', shared('<ChipTag brandColor="#123456">Provider</ChipTag>'))).flagged).toBe(
    false
  )
  expect(
    (await diff('', shared('<ChipTag style={{color:"#123456"}}>Provider</ChipTag>'))).flagged
  ).toBe(true)
  const block = `import type {BlockConfig} from '@/blocks/types';const Provider:BlockConfig={type:'provider',category:'tools',bgColor:'#123456'}`
  expect((await diff('', block, 'apps/sim/blocks/blocks/provider.ts')).flagged).toBe(false)
})
test('icon styling is separate from artwork and global size stays ungoverned', async () => {
  const source = `import {Search} from 'lucide-react';const A=()=> <Search className="size-[24px] text-[var(--text-body)]"/>`
  expect((await diff('', source)).flagged).toBe(false)
  expect(
    (await diff('', source.replace('text-[var(--text-body)]', 'text-[#434343]'))).flagged
  ).toBe(true)
  expect((await diff('', `const A=()=> <svg><path fill="#123456" d="M0 0"/></svg>`)).flagged).toBe(
    true
  )
})
test('registered icon slot forbids overriding its geometry', async () => {
  const r = await diff('', shared('<ChipInput icon={<svg className="size-[24px]"/>}/>'))
  expect(r.findings.some((f) => f.contract === 'icon-slot')).toBe(true)
})
test('directly labelled modal fields use their central wrapper', async () => {
  expect(
    (
      await diff(
        '',
        shared('<ChipModalBody><div><label>Name</label><ChipInput/></div></ChipModalBody>')
      )
    ).findings.some((f) => f.contract === 'modal-field')
  ).toBe(true)
  expect(
    (await diff('', shared('<ChipModalBody><ChipModalField title="Name"/></ChipModalBody>')))
      .flagged
  ).toBe(false)
  expect((await diff('', shared('<div><label>Name</label><ChipInput/></div>'))).flagged).toBe(false)
})
test('central definitions notify but formatting does not', async () => {
  const r = await diff(globals, globals.replace('13px', '14px'), TOKEN_FILE)
  expect(r.status).toBe('completed')
  expect(r.findings.length).toBe(1)
  expect(r.findings[0].kind).toBe('system-change')
  expect((await diff(globals, `/** note */\n${globals}`, TOKEN_FILE)).flagged).toBe(false)
})
test('new central token and its usage produce only the system notification', async () => {
  const after = `${globals}\n:root{--new-colour:#123456}`
  const b: Entry = { path: TOKEN_FILE, blob: 'old', mode: '100644' }
  const a: Entry = { path: TOKEN_FILE, blob: 'new', mode: '100644' }
  const c: Entry = { path: ui, blob: 'consumer', mode: '100644' }
  const r = await linter.analyze(
    [
      { status: 'M', before: b, after: a },
      { status: 'A', before: null, after: c },
    ],
    (e) => (e === b ? globals : e === a ? after : text('text-[var(--new-colour)]')),
    commits,
    input()
  )
  expect(r.status).toBe('completed')
  expect(r.findings.length).toBe(1)
  expect(r.findings[0].kind).toBe('system-change')
})
test('CSS and rendered HTML retain central checks', async () => {
  expect((await diff('', '.a{color:#434343}', 'apps/sim/components/a.css')).flagged).toBe(true)
  expect(
    (
      await diff(
        '',
        `const A=()=> <div dangerouslySetInnerHTML={{__html:'<p style="color:#434343">Help</p>'}}/>`
      )
    ).flagged
  ).toBe(true)
  expect(
    (
      await diff(
        '',
        `const A=()=> <div dangerouslySetInnerHTML={{__html:'<p class="mb-3">Help</p>'}}/>`
      )
    ).flagged
  ).toBe(false)
})
test('unresolved expressions remain unchecked while failed product inspection fails the check', async () => {
  for (const source of [
    `import helper from './helper';const A=()=> <p className={helper()}/>`,
    `const a=b;const b=a;const A=()=> <p className={a}/>`,
  ]) {
    const r = await diff('', source)
    expect(r.flagged).toBe(false)
    expect(r.unchecked.length).toBeGreaterThan(0)
  }
  for (const source of [`const A=()=> <`, ' '.repeat(2 * 1024 * 1024 + 1)]) {
    const r = await diff('', source)
    expect(r.status).toBe('failed')
    expect(r.flagged).toBeNull()
    expect(r.coverageFailures?.length).toBeGreaterThan(0)
  }
})
test('missing required central input is an operational failure', async () => {
  const r = await diff('', text('text-small'), ui, {})
  expect(r.flagged).toBeNull()
  expect(r.status).toBe('failed')
})
test('historical theme syntax is parsed without source/plugin execution', async () => {
  const sources = {
    ...centralSources,
    'apps/sim/tailwind.config.ts': `throw new Error('MUST NOT EXECUTE');export default {theme:{extend:{colors:{special:'#123456'},fontSize:{huge:'33px'}}},plugins:[(()=>{throw Error('plugin')})()]}`,
  }
  const s = await designSystem(input(sources))
  expect(s.adopted.get('colours')?.has('special')).toBe(true)
  expect((await diff('', text('text-special text-huge'), ui, sources)).flagged).toBe(false)
})

test('central aliases inherit permissions without granting local literal aliases permission', async () => {
  const sources = {
    ...centralSources,
    [TOKEN_FILE]: `${globals};:root{--border-1:var(--border);--border-muted:var(--border-1)}`,
  }
  expect((await diff('', text('border-[var(--border-muted)]'), ui, sources)).flagged).toBe(false)
  expect(
    (await diff('', `.a{--own:#123456;color:var(--own)}`, 'apps/sim/components/a.css')).flagged
  ).toBe(true)
})
test('named utility adoption requires a central styling definition', async () => {
  const source = centralSources['packages/emcn/src/components/button/button.tsx']
  const sources = {
    ...centralSources,
    'packages/emcn/src/components/button/button.tsx': `${source};export const Caption=()=> <p className="text-lg text-blue-500 rounded-2xl"/>`,
  }
  expect((await diff('', text('text-lg text-blue-500 rounded-2xl'), ui, sources)).flagged).toBe(
    false
  )
  expect((await diff('', text('text-red-500'), ui, sources)).flagged).toBe(true)
})
test('gradient direction and ring geometry do not invent a new colour or shadow', async () => {
  expect(
    (await diff('', text('bg-linear-to-t from-[var(--text-body)] to-transparent ring-0'))).flagged
  ).toBe(false)
})
test('equivalent important syntax and local function renames surface edited or renamed debt', async () => {
  expect(
    (await diff(shared('<Button className="!p-2"/>'), shared('<Button className="p-2!"/>'))).flagged
  ).toBe(true)
  expect(
    (await diff(text('text-[#434343]'), text('text-[#434343]').replace('const A', 'const Renamed')))
      .flagged
  ).toBe(true)
})

test('centrally derived template composition is checked without an unknown helper', async () => {
  const r = await diff(
    '',
    `import {centralTextClass} from '@sim/emcn';const A=()=> <p className={\`\${centralTextClass} font-mono\`}/>`
  )
  expect(r.flagged).toBe(false)
  expect(r.unchecked).toEqual([])
})
test('central configuration edits notify separately and preserve original JS locations', async () => {
  const file = 'apps/sim/tailwind.config.ts'
  const before = "export default {\n theme:{extend:{colors:{special:'#123456'}}}\n}"
  const sources = { ...centralSources, [file]: before }
  const r = await diff(before, before.replace('#123456', '#654321'), file, sources)
  expect(r.flagged).toBe(true)
  expect(r.findings.every((f) => f.kind === 'system-change')).toBe(true)
  expect(r.findings.some((f) => f.property === '--color-special' && f.line === 2)).toBe(true)
  expect((await diff(before, `/** comment */\n${before}`, file, sources)).flagged).toBe(false)
})
test('central registry edits are review notifications, not consumer violations', async () => {
  const r = await diff('{"version":1}', '{"version":2}', 'design-review/token-lint/contracts.json')
  expect(r.findings[0].kind).toBe('system-change')
})

test('root component contracts do not accidentally constrain pseudo-elements or arbitrary icon descendants', async () => {
  expect(
    (await diff('', shared('<Button className="after:size-[40px] [&_svg]:size-[24px]"/>'))).flagged
  ).toBe(false)
  expect(
    (await diff('', shared('<Button className="hover:h-[40px]"/>'))).findings[0].contract
  ).toBe('component-chrome')
  expect(
    (await diff('', shared('<Button className="after:bg-[#123456]"/>'))).findings[0].contract
  ).toBe('central-colour')
})
test('central configuration constant extraction is equivalent', async () => {
  const file = 'apps/sim/tailwind.config.ts'
  const before = "export default {theme:{extend:{colors:{special:'#123456'}}}}"
  const after = "const palette={special:'#123456'};export default {theme:{extend:{colors:palette}}}"
  expect((await diff(before, after, file, { ...centralSources, [file]: before })).flagged).toBe(
    false
  )
})

test('untouched debt survives a compiler migration while additional copies still flag', async () => {
  const config = 'apps/sim/tailwind.config.ts'
  const sources = { ...centralSources, [config]: 'export default {}' }
  const b: Entry = { path: ui, blob: 'c'.repeat(40), mode: '100644' }
  const a: Entry = { ...b, blob: 'd'.repeat(40) }
  const c = input(sources).snapshot.entries.find((e) => e.path === config) as Entry
  for (const copies of [1, 2]) {
    const r = await linter.analyze(
      [
        { status: 'M', before: b, after: a },
        { status: 'D', before: c, after: null },
      ],
      (e) =>
        e === b
          ? text('hover:shadow')
          : e === a
            ? `const A=()=> <>${'<p className="hover:shadow"/>'.repeat(copies)}</>`
            : sources[e.path as keyof typeof sources],
      commits,
      input(sources)
    )
    expect(r.findings.filter((f) => f.kind === 'usage-violation').length).toBe(copies - 1)
  }
})

test('equivalent conditional composition does not turn untouched chrome debt into new debt', async () => {
  const before = shared(
    '<Button className={active ? "bg-[var(--text-error)]" : "hover:bg-[var(--text-body)]"}/>'
  )
  const after = shared(
    '<Button variant={active ? "error" : "normal"} className={!active && "hover:bg-[var(--text-body)]"}/>'
  )
  expect((await diff(before, after)).flagged).toBe(false)
  expect((await diff(before, after.replace('var(--text-body)', 'var(--text-muted)'))).flagged).toBe(
    true
  )
})
test('modal spacing ownership distinguishes body field rhythm from nested content layout', async () => {
  expect(
    (
      await diff(
        '',
        shared(
          '<ChipModalBody><div className="flex gap-2"><Button>A</Button><Button>B</Button></div></ChipModalBody>'
        )
      )
    ).flagged
  ).toBe(false)
  expect(
    (
      await diff(
        '',
        shared(
          '<ChipModalBody><section><div className="flex flex-col gap-2 p-2">Content</div></section></ChipModalBody>'
        )
      )
    ).flagged
  ).toBe(false)
  expect(
    (
      await diff(
        '',
        shared(
          '<ChipModalBody><div className="flex flex-col gap-2"><ChipModalField title="Name" /></div></ChipModalBody>'
        )
      )
    ).flagged
  ).toBe(true)
})

test('supported central v3/v4 utility aliases compare as the same styling definition', async () => {
  const file = 'packages/emcn/src/components/button/button.tsx'
  const config = 'apps/sim/tailwind.config.ts'
  const before = 'export const Button=()=> <button className="shadow-sm outline-none"/>'
  const after = before.replace('shadow-sm outline-none', 'shadow-xs outline-hidden')
  const sources = { ...centralSources, [file]: before, [config]: 'export default {}' }
  const b: Entry = { path: file, blob: 'e'.repeat(40), mode: '100644' }
  const a: Entry = { ...b, blob: 'f'.repeat(40) }
  const c = input(sources).snapshot.entries.find((e) => e.path === config) as Entry
  const r = await linter.analyze(
    [
      { status: 'M', before: b, after: a },
      { status: 'D', before: c, after: null },
    ],
    (e) => (e === b ? before : e === a ? after : sources[e.path as keyof typeof sources]),
    commits,
    input(sources)
  )
  expect(r.findings.filter((f) => f.file === file)).toEqual([])
})

test('CSS and inline token provenance survives numeric normalization', async () => {
  expect(
    (
      await diff(
        '',
        'const A=()=> <p style={{fontSize:"var(--text-small)",borderRadius:"var(--radius-lg)"}}/>'
      )
    ).flagged
  ).toBe(false)
  expect(
    (await diff('', text('text-[length:var(--text-small)] rounded-[var(--radius-lg)]'))).flagged
  ).toBe(false)
  expect(
    (
      await diff(
        '',
        '.a{font-size:var(--text-small);border-radius:var(--radius-lg)}',
        'apps/sim/components/a.css'
      )
    ).flagged
  ).toBe(false)
  expect(
    (await diff('', '.a{font-size:13px;border-radius:8px}', 'apps/sim/components/a.css')).findings
      .length
  ).toBe(2)
})
test('ordinary border and font shorthands expose governed literal inputs', async () => {
  expect(
    (
      await diff(
        '',
        '.a{border:1px solid #434343;font:600 13px/1.5 Arial}',
        'apps/sim/components/a.css'
      )
    ).findings.length
  ).toBe(4)
  expect(
    (
      await diff(
        '',
        '.a{border:1px solid var(--border);font:var(--text-small)/1.5 var(--font-body)}',
        'apps/sim/components/a.css'
      )
    ).flagged
  ).toBe(false)
})

test('direct modal body spacing also covers space-y utilities without governing nested layout', async () => {
  expect(
    (
      await diff(
        '',
        shared(
          '<ChipModalBody><div className="space-y-3"><ChipModalField title="Name" /></div></ChipModalBody>'
        )
      )
    ).flagged
  ).toBe(true)
  expect(
    (
      await diff(
        '',
        shared(
          '<ChipModalBody><section><div className="space-y-3">Content</div></section></ChipModalBody>'
        )
      )
    ).flagged
  ).toBe(false)
})

test('control replacement and equivalent conditional inputs surface new authored debt', async () => {
  const before = 'const A=()=> <span className="text-[17px]"/>'
  const after =
    'import {OverflowText} from "@sim/emcn";const A=()=> <OverflowText className={disabled ? "text-[17px] text-[var(--text-muted)]" : "text-[17px]"}/>'
  expect((await diff(before, after)).flagged).toBe(true)
  expect(
    (
      await diff(
        before,
        'const A=()=> <><div className="text-[17px]"/><div className="text-[17px]"/></>'
      )
    ).findings.length
  ).toBe(2)
  expect(
    (
      await diff(
        'const A=()=> <button className="text-[var(--text-body)]"/>',
        shared('<Button className="text-[var(--text-body)]"/>')
      )
    ).findings[0].contract
  ).toBe('component-chrome')
})

for (const classes of ['flex flex-col gap-2', 'space-y-3', 'px-2']) {
  test(`modal field spacing requires structural fields: ${classes}`, async () => {
    const prose = `<ChipModalBody><div className="${classes}"><p>Fields</p><ul><li>Contents</li></ul></div></ChipModalBody>`
    expect((await diff('', shared(prose))).flagged).toBe(false)
    const fields = prose.replace(
      '<p>Fields</p><ul><li>Contents</li></ul>',
      '<ChipModalField title="Name" />'
    )
    expect(
      (await diff('', shared(fields))).findings.some((f) => f.contract === 'component-chrome')
    ).toBe(true)
    expect(
      (
        await diff(
          '',
          shared(prose.replace('<p>Fields</p><ul><li>Contents</li></ul>', '<UnknownControl />'))
        )
      ).flagged
    ).toBe(false)
  })
}

test('modal field-group proof comes from rendered controls and preserves nested allowances', async () => {
  expect(
    (
      await diff('', shared('<ChipModalBody><div className="px-2"><input /></div></ChipModalBody>'))
    ).findings.some((f) => f.contract === 'component-chrome')
  ).toBe(true)
  expect(
    (
      await diff(
        '',
        shared(
          '<ChipModalBody><div className="px-2" data-extra={<ChipModalField title="Name"/>}><p>Fields</p></div></ChipModalBody>'
        )
      )
    ).flagged
  ).toBe(false)
  expect(
    (
      await diff(
        '',
        shared(
          '<ChipModalBody><section><div className="px-2"><ChipModalField title="Name"/></div></section></ChipModalBody>'
        )
      )
    ).flagged
  ).toBe(false)
  expect(
    (
      await diff('', shared('<ChipModalBody className="px-2"><p>Prose</p></ChipModalBody>'))
    ).findings.some((f) => f.contract === 'component-chrome')
  ).toBe(true)
})

test('central artwork changes notify; formatting and ordinary reuse pass', async () => {
  const file = 'packages/emcn/src/icons/example.tsx'
  const code = 'export const Mark=()=> <svg><path d="M0 0L1 1"/></svg>'
  const result = await diff(code, code.replace('L1 1', 'L2 2'), file)
  expect(result.findings).toHaveLength(1)
  expect(result.findings[0]).toMatchObject({ kind: 'system-change', contract: 'central-artwork' })
  expect((await diff(code, `/** documentation */\n ${code}`, file)).flagged).toBe(false)
  expect((await diff(code, '', file)).flagged).toBe(true)
  expect(
    (await diff('', "import {Mark} from '@sim/emcn/icons';const A=()=> <Mark/>")).flagged
  ).toBe(false)
  expect(
    (
      await diff(
        '',
        "import {Mark} from '@sim/emcn/icons';const A=()=> <Mark style={{color:'#aabbcc'}}/>"
      )
    ).flagged
  ).toBe(true)
})

test('local SVG ownership is checked without governing arbitrary icon size', async () => {
  const code = 'const A=()=> <svg width="73"><path d="M0 0L1 1"/></svg>'
  expect((await diff('', code)).findings.map((f) => f.contract)).toEqual(['central-artwork'])
  expect((await diff(code, `/** wording */\n${code}`)).flagged).toBe(false)
  expect((await diff(code, code.replace('L1 1', 'L2 2'))).flagged).toBe(true)
  expect((await diff('', '<svg><title>Accessible title</title></svg>')).flagged).toBe(false)
  expect((await diff('', 'const A=()=> <img src={user.avatar}/>')).flagged).toBe(false)
  const landing = 'apps/sim/app/(landing)/components/illustration.tsx'
  expect((await diff('', code, landing)).flagged).toBe(false)
  expect((await diff('', code, 'apps/sim/components/feature/icons.tsx')).flagged).toBe(true)
  const mixed = await diff('', code, 'apps/sim/components/icons.tsx')
  expect(mixed.flagged).toBe(false)
  expect(mixed.unchecked[0].reason).toContain('mixed branding/icon library')
})

test('wording and context edits leave debt quiet; moving its owner or adding copies flags', async () => {
  const code = 'const A=()=> <p className="text-[#123456]">old wording</p>'
  expect((await diff(code, code.replace('old wording', 'new wording'))).flagged).toBe(false)
  expect((await diff(code, `// unrelated header\n${code}`)).flagged).toBe(false)
  expect((await diff(code, code.replace('const A', 'const B'))).flagged).toBe(true)
  expect(
    (await diff(code, `${code};const B=()=> <p className="text-[#123456]"/>`)).findings
  ).toHaveLength(1)
  expect(
    (await diff(code, code.replace('text-[#123456]', 'text-[var(--text-body)]'))).flagged
  ).toBe(false)
})

test('Tailwind scanning repairs warn as style generation changes', async () => {
  const file = 'apps/sim/tailwind.config.ts'
  const before = 'export default {content:["./app/**/*.tsx"]}'
  const after = 'export default {content:["./app/**/*.tsx","./blocks/**/*.tsx"]}'
  const r = await diff(before, after, file, { ...centralSources, [file]: before })
  expect(
    r.findings.some((f) => f.reason.startsWith('Style generation configuration changed:'))
  ).toBe(true)
  expect(r.findings.every((f) => f.kind === 'system-change')).toBe(true)
})

test('central selector repairs notify even when the authored colour stays the same', async () => {
  const p = 'packages/emcn/src/components/code/code.css'
  expect(
    (await diff('.old { color:#123456 }', '.new { color:#123456 }', p)).findings.some(
      (f) => f.kind === 'system-change'
    )
  ).toBe(true)
  expect(
    (await diff('.old { color:#123456 }', '/* comment */ .old {color:#123456}', p)).flagged
  ).toBe(false)
})

test('new central artwork slots accept custom drawing values but notify their definition', async () => {
  const file = 'packages/emcn/src/illustrations/empty.tsx'
  const source = 'export const Empty=()=> <svg><path fill="#deadbe" d="M0 0L7 9"/></svg>'
  const r = await diff('', source, file)
  expect(r.findings).toHaveLength(1)
  expect(r.findings[0].kind).toBe('system-change')
  const local = await diff('', source, 'apps/sim/components/icons/empty.tsx')
  expect(
    local.findings.some((f) => f.kind === 'usage-violation' && f.contract === 'central-artwork')
  ).toBe(true)
})

test('artwork parsing and raster comparisons never execute source or decode media', async () => {
  const { artworkDiff } = await import('#design-conformance/artwork')
  const file = 'packages/emcn/src/illustrations/empty.png'
  const result = artworkDiff(
    {
      status: 'M',
      before: { path: file, blob: 'a'.repeat(40), mode: '100644' },
      after: { path: file, blob: 'b'.repeat(40), mode: '100644' },
    },
    () => {
      throw new Error('media must not be decoded')
    }
  )
  expect(result.findings[0].kind).toBe('system-change')
  const r = await diff(
    '',
    'globalThis.DESIGN_ARTWORK_RAN=true;export const Mark=()=> <svg/>',
    'packages/emcn/src/icons/empty.tsx'
  )
  expect(r.status).toBe('completed')
  expect('DESIGN_ARTWORK_RAN' in globalThis).toBe(false)
  const over = await diff('', ' '.repeat(2 * 1024 * 1024 + 1), 'packages/emcn/src/icons/large.tsx')
  expect(over.unchecked.some((n) => n.reason.includes('parsing limit'))).toBe(true)
  expect(over.flagged).toBe(true)
})

test('reviewed landing ownership declarations apply generically and stay out of product scope', async () => {
  const { registry } = await import('#design-conformance/contracts')
  const file = 'apps/sim/components/marketing-only.tsx'
  registry.ownership ??= {}
  registry.ownership[file] = {
    scope: 'landing',
    source: 'apps/sim/app/(landing)/page.tsx',
    reason: 'Explicit landing presentation ownership',
  }
  try {
    expect((await diff('', text('text-[#123456]'), file)).flagged).toBe(false)
    expect(
      (await diff('', text('text-[#123456]'), 'apps/sim/components/product.tsx')).flagged
    ).toBe(true)
  } finally {
    delete registry.ownership[file]
  }
})

test('Tailwind CSS source declarations notify as style generation changes', async () => {
  const r = await diff(
    `${globals}\n@source "../components";`,
    `${globals}\n@source "../components";\n@source "../blocks";`,
    TOKEN_FILE
  )
  expect(r.findings.length).toBeGreaterThan(0)
  expect(r.findings.some((f) => f.reason.startsWith('Style generation changed:'))).toBe(true)
})

test('central component inline artwork changes and removals notify', async () => {
  const p = 'packages/emcn/src/components/decor/decor.tsx'
  const source = 'export const Decor=()=> <svg><path d="M0 0L1 1"/></svg>'
  expect(
    (await diff(source, source.replace('L1 1', 'L2 2'), p)).findings.some(
      (f) => f.contract === 'central-artwork' && f.kind === 'system-change'
    )
  ).toBe(true)
  expect(
    (await diff(source, 'export const Decor=()=> <div/>', p)).findings.some(
      (f) => f.contract === 'central-artwork' && f.value === '(removed)'
    )
  ).toBe(true)
})

test('declared third-party artwork and its direct export pass; product assets still notify', async () => {
  const { registry } = await import('#design-conformance/contracts')
  const { artworkDiff } = await import('#design-conformance/artwork')
  const file = 'packages/emcn/src/icons/provider-glyph.tsx'
  registry.artwork!.brandAssets ??= {}
  registry.artwork!.brandAssets[file] = {
    source: `${file}#Provider`,
    reason: 'Registered third-party provider artwork',
  }
  try {
    const code = 'export const Provider=()=> <svg><path d="M0 0L1 1"/></svg>'
    expect((await diff('', code, file)).flagged).toBe(false)
    expect((await diff('', code, 'packages/emcn/src/icons/product-glyph.tsx')).flagged).toBe(true)
    const barrel = 'packages/emcn/src/icons/index.ts'
    const old = "export {Product} from './product-glyph'"
    const next = `${old};export {Provider} from './provider-glyph'`
    expect((await diff(old, next, barrel)).flagged).toBe(false)
    expect((await diff(next, `${next};export {New} from './new-product'`, barrel)).flagged).toBe(
      true
    )
    const only = "export {Provider} from './provider-glyph'"
    expect(
      artworkDiff(
        {
          status: 'A',
          before: null,
          after: { path: barrel, blob: 'a'.repeat(40), mode: '100644' },
        },
        () => only
      ).findings
    ).toHaveLength(0)
    expect((await diff('', 'const A=()=> <svg><path d="M0 0L1 1"/></svg>')).flagged).toBe(true)
  } finally {
    delete registry.artwork!.brandAssets[file]
  }
})

test('moving unchanged artwork across the authoring boundary never grants central provenance', async () => {
  const central = 'packages/emcn/src/icons/owned.tsx'
  const local = 'apps/sim/components/local-drawing.tsx'
  const source = 'export const Mark=()=> <svg><path d="M0 0L1 1"/></svg>'
  const out = await diff(source, source, local, centralSources, central)
  expect(out.findings.some((f) => f.file === central && f.kind === 'system-change')).toBe(true)
  expect(out.findings.some((f) => f.file === local && f.kind === 'usage-violation')).toBe(true)
  const into = await diff(source, source, central, centralSources, local)
  expect(into.findings).toHaveLength(1)
  expect(into.findings[0].kind).toBe('system-change')
  const within = await diff(
    source,
    source,
    'packages/emcn/src/icons/renamed.tsx',
    centralSources,
    central
  )
  expect(within.flagged).toBe(false)
})
