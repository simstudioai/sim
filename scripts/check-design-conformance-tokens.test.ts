import { existsSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { loadCatalogue } from '#design-conformance/io'
import { Linter } from '#design-conformance/lint'
import { type Change, TOKEN_FILE } from '#design-conformance/model'

let linter: Linter
beforeAll(async () => {
  const c = loadCatalogue()
  linter = await Linter.create(c.catalogue, c.hash, 'tokens')
})
const commits = { base: 'a'.repeat(40), head: 'b'.repeat(40), mergeBase: 'a'.repeat(40) }
const ui = 'apps/sim/components/example.tsx'
function diff(before: string, after: string, file = ui, oldFile = file) {
  const change: Change = {
    status: 'M',
    before: { path: oldFile, blob: 'a'.repeat(40), mode: '100644' },
    after: { path: file, blob: 'b'.repeat(40), mode: '100644' },
  }
  return linter.analyze([change], (e) => (e.blob[0] === 'a' ? before : after), commits)
}
const element = (classes: string) =>
  `export const Widget=()=> <button className=${JSON.stringify(classes)}>Label</button>`
const cases = [
  ['colours', 'text-[var(--text-primary)]', 'text-[#1a1a1a]'],
  ['spacing', 'p-2', 'p-[777px]'],
  ['dimensions', 'w-[20px]', 'w-[777px]'],
  ['typography', 'text-small', 'text-[17.25px]'],
  ['radii', 'rounded-[5px]', 'rounded-[777px]'],
  ['borders', 'border', 'border-[7px]'],
  ['effects', 'opacity-50', 'opacity-37'],
  ['layout', 'flex-col', 'grid-cols-[13fr_17fr]'],
  ['visibility', 'overflow-hidden', 'line-clamp-37'],
  ['layering', 'z-10', 'z-[1337]'],
  ['motion', 'duration-150', 'duration-[137ms]'],
]
describe('finite property catalogue', () => {
  for (const [category, approved, bad] of cases)
    test(`${category}: approved and nearby violation`, () => {
      expect(diff('', element(approved)).findings).toEqual([])
      const report = diff('', element(bad))
      expect(report.flagged).toBe(true)
      expect(report.findings.some((f) => f.category === category)).toBe(true)
    })
  test('approved-to-approved changes pass', () =>
    expect(diff(element('p-2 w-[20px]'), element('p-4 w-[24px]')).flagged).toBe(false))
  test('colour literals fail even when they match the palette', () => {
    for (const source of [
      element('text-[#1a1a1a]'),
      `const A=()=> <div style={{color:'rgb(26, 26, 26)'}}/>`,
    ])
      expect(diff('', source).findings[0].rule).toBe('colour-token-required')
  })
  test('named colours pass and unknown colour tokens fail', () => {
    expect(diff('', element('text-white')).flagged).toBe(false)
    expect(diff('', element('text-[var(--not-a-sim-colour)]')).findings[0].rule).toBe(
      'unknown-colour-token'
    )
  })
  test('inlined named palette utilities retain token identity', () => {
    expect(
      diff('', element('bg-orange-400 text-blue-500 border-gray-500 bg-current/20')).flagged
    ).toBe(false)
    expect(diff('', element('bg-[#fb923c]')).flagged).toBe(true)
    expect(diff('', element('bg-pink-500')).flagged).toBe(true)
  })
  test('semantic colour aliases follow only frozen token definitions', () => {
    expect(
      diff('', element('bg-primary text-secondary border-ring bg-[hsl(var(--primary))]')).flagged
    ).toBe(false)
    expect(diff('', element('bg-[var(--brand-new-unknown)]')).flagged).toBe(true)
  })
  test('colour literals in gradients and custom shadows fail', () => {
    expect(diff('', element('bg-[linear-gradient(#fff,#000)]')).flagged).toBe(true)
    expect(
      diff('', element('shadow-[0_0_2px_#fff]')).findings.some(
        (x) => x.rule === 'colour-token-required'
      )
    ).toBe(true)
  })
  test('nominal rem and percentage opacity normalize', () => {
    expect(diff('', `const A=()=> <div style={{padding:8,opacity:0.5}}/>`).flagged).toBe(false)
    expect(diff('', `const A=()=> <div style={{padding:'0.5rem'}}/>`).flagged).toBe(false)
  })
  test('CSS shorthands check each value in its property family', () => {
    expect(
      diff('', '.a{padding:4px 8px;border:1px solid var(--border)}', 'apps/sim/components/a.css')
        .flagged
    ).toBe(false)
    expect(diff('', '.a{padding:4px 777px}', 'apps/sim/components/a.css').flagged).toBe(true)
  })
  test('documented font weights override observed definitions', () => {
    expect(diff('', element('font-medium')).flagged).toBe(false)
    expect(diff('', element('font-bold')).findings.some((x) => x.property === 'font-weight')).toBe(
      true
    )
  })
  test('named typography tokens from global CSS are permitted', () =>
    expect(diff('', element('text-md text-micro')).flagged).toBe(false))
})
describe('only introduced violations', () => {
  test('wording, formatting and comments do not report existing violations', () => {
    expect(
      diff(
        element('p-[777px]'),
        `/** comment */\n${element('p-[777px]').replace('Label', 'Different words')}`
      ).flagged
    ).toBe(false)
  })
  test('a duplicate new usage adds one violation', () => {
    const before = `const A=()=> <button className="p-[777px]"/>`
    const after = `const A=()=> <><button className="p-[777px]"/><button className="p-[777px]"/></>`
    expect(diff(before, after).findings).toHaveLength(1)
  })
  test('renames retain existing violations', () =>
    expect(
      diff(element('p-[777px]'), element('p-[777px]'), 'apps/sim/components/renamed file.tsx')
        .flagged
    ).toBe(false))
  test('deletions remove violations', () =>
    expect(diff(element('p-[777px]'), '').flagged).toBe(false))
  test('conditions and variants retain concrete evidence', () => {
    const r = diff(
      '',
      `import {cn} from '@sim/emcn'; const A=()=> <button className={cn('p-2', ok && 'dark:hover:p-[777px]')}/>`
    )
    expect(r.findings[0].context).toBe('dark:hover:')
  })
  test('CVA variants and compound variants are checked', () => {
    const r = diff(
      '',
      `import {cva as recipe} from 'class-variance-authority'; const x=recipe('p-2',{variants:{size:{normal:'p-2',odd:'p-[777px]'}},defaultVariants:{size:'odd'},compoundVariants:[{size:'odd',className:'rounded-[777px]'}]})`
    )
    expect(r.findings.map((x) => x.category).sort()).toEqual(['radii', 'spacing'])
  })
  test('local constants, properties and template strings resolve', () => {
    const r = diff(
      '',
      `const padding='p-[777px]'; const vals={radius:'rounded-[777px]'}; const A=()=> <button className={\`\${padding} \${vals.radius}\`}/>`
    )
    expect(r.findings).toHaveLength(2)
  })
  test('default helper aliases resolve without importing code', () => {
    expect(
      diff('', `import cx from 'clsx'; const A=()=> <button className={cx('p-[777px]')}/>`).flagged
    ).toBe(true)
  })
  test('mutated object properties remain explicitly unchecked', () => {
    const r = diff(
      '',
      `const style={pad:'p-2'}; style.pad='p-[777px]'; const A=()=> <button className={style.pad}/>`
    )
    expect(r.flagged).toBe(false)
    expect(r.unchecked.length).toBeGreaterThan(0)
  })
  test('numeric arithmetic is not mistaken for string concatenation', () => {
    const r = diff('', `const a=8; const b=16; const A=()=> <div style={{width:a+b}}/>`)
    expect(r.flagged).toBe(false)
    expect(r.unchecked.length).toBeGreaterThan(0)
  })
  test('numeric local style constant receives CSS length semantics', () =>
    expect(diff('', `const n=8; const A=()=> <div style={{padding:n}}/>`).flagged).toBe(false))
  test('imported helpers and dynamic values remain unchecked', () => {
    const r = diff(
      '',
      `import {classes} from './elsewhere'; const A=()=> <div className={classes()} style={{width:layout.width}}/>`
    )
    expect(r.flagged).toBe(false)
    expect(r.unchecked.length).toBeGreaterThan(0)
  })
  test('dynamic templates keep complete static utilities only', () => {
    const r = diff('', `const A=()=> <div className={\`p-\${size} rounded-[777px]\`}/>`)
    expect(r.findings).toHaveLength(1)
    expect(r.unchecked.length).toBeGreaterThan(0)
  })
  test('cycles are bounded', () => {
    const r = diff('', `const a=b; const b=a; const A=()=> <div className={a}/>`)
    expect(r.flagged).toBe(false)
    expect(r.unchecked.length).toBeGreaterThan(0)
  })
  test('movement only passes, mixed appearance still flags', () => {
    expect(diff('', element('translate-x-[777px] left-[999px]')).flagged).toBe(false)
    expect(diff('', element('translate-x-[777px] p-[777px]')).flagged).toBe(true)
  })
  test('CSS and HTML direct styling are checked', () => {
    expect(diff('', '.a{padding:777px}', 'apps/sim/components/a.css').flagged).toBe(true)
    expect(
      diff('', '<button style="padding:777px">Go</button>', 'apps/sim/components/a.html').flagged
    ).toBe(true)
  })
  test('malformed inputs are explicitly unchecked', () => {
    const r = diff('', `const A=()=> <div className={`)
    expect(r.flagged).toBe(false)
    expect(r.unchecked.some((x) => x.reason.startsWith('Parser failure'))).toBe(true)
  })
  test('excluded surfaces, assets and media do not flag', () => {
    for (const file of [
      'apps/docs/a.tsx',
      'apps/sim/app/(landing)/a.tsx',
      'apps/sim/components/emails/a.tsx',
      'apps/desktop/a.tsx',
      'packages/emcn/src/icons/a.tsx',
      'apps/sim/components/a.test.tsx',
    ])
      expect(diff('', element('p-[777px]'), file).flagged).toBe(false)
    expect(
      diff('', `import Media from 'next/image'; const A=()=> <Media className="w-[777px]"/>`)
        .flagged
    ).toBe(false)
  })
  test('business strings are not styling contexts', () =>
    expect(
      diff('', `const colours={color:'#abc',padding:777}; const A=()=> <p>p-[777px]</p>`).flagged
    ).toBe(false))
  test('central definitions flag additions, changes and removals', () => {
    for (const [before, after] of [
      ['', ':root{--new-colour:#f00}'],
      [':root{--text-primary:#fff}', ':root{--text-primary:#000}'],
      [':root{--text-primary:#fff}', ''],
    ])
      expect(
        diff(before, after, TOKEN_FILE).findings.some((x) => x.rule === 'token-definition-changed')
      ).toBe(true)
  })
  test('central definition formatting and comments pass', () =>
    expect(
      diff(':root{--text-primary:#ABC}', ':root { /* hi */ --text-primary: #abc; }', TOKEN_FILE)
        .flagged
    ).toBe(false))
  test('adding a definition never approves its usage', () => {
    const defs = diff('', ':root{--new-colour:#f00}', TOKEN_FILE)
    const usage = diff('', element('text-[var(--new-colour)]'))
    expect(defs.flagged && usage.flagged).toBe(true)
  })
  test('repeated reports match and contain no metrics', () => {
    const a = diff('', element('p-[777px]'))
    const b = diff('', element('p-[777px]'))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a).not.toHaveProperty('milliseconds')
  })
  test('source errors remain operational failures', () => {
    const r = linter.analyze(
      [{ status: 'A', before: null, after: { path: ui, blob: 'b'.repeat(40), mode: '100644' } }],
      () => {
        throw new Error('Missing source')
      },
      commits
    )
    expect(r.status).toBe('failed')
    expect(r.flagged).toBeNull()
  })
  test('application and proposed plugins cannot execute', async () => {
    const marker = `/tmp/design-token-lint-sentinel-${process.pid}`
    const r = diff(
      '',
      `import fs from 'node:fs'; fs.writeFileSync('${marker}','executed'); const A=()=> <button className="p-[777px]"/>`
    )
    expect(r.flagged).toBe(true)
    expect(existsSync(marker)).toBe(false)
    const cat = loadCatalogue().catalogue
    await expect(
      Linter.create({ ...cat, theme: `${cat.theme}\n@plugin "${marker}";` })
    ).rejects.toThrow()
    expect(existsSync(marker)).toBe(false)
  })
})

test('checked-to-unsupported renames preserve coverage diagnostics', () => {
  const report = diff(
    element('text-[#123456]'),
    element('text-[#123456]'),
    'apps/sim/components/view.md',
    ui
  )
  expect(report.coverage.unsupportedFiles).toBe(1)
  expect(
    report.unchecked.some(
      (n) =>
        n.file === 'apps/sim/components/view.md' &&
        n.side === 'after' &&
        n.reason.includes('Unsupported file format')
    )
  ).toBe(true)
})
test.each(['currentcolor', 'CURRENTCOLOR', 'currentColor'])(
  'CSS current color is case insensitive: %s',
  (value) => {
    expect(diff('', `.label{color:${value}}`, 'apps/sim/components/a.css').findings).toEqual([])
  }
)
test('literal ring offset colours are inspected', () => {
  expect(
    diff('', element('ring-offset-[#123456]')).findings.some((f) => f.category === 'colours')
  ).toBe(true)
})
