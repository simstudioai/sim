import { expect, it } from 'vitest'
import { analyze } from '#design-diff/analyze'
import { serializeReport } from '#design-diff/report'
import { compareFiles, config, FixtureRepo } from '#design-diff/tests/helpers'

const file = 'apps/docs/content/guide.mdx'
const faq = "import { FAQ } from '@/components/ui/faq'\n\n"
const callout = "import { Callout } from 'fumadocs-ui/components/callout'\n\n"

it.each([
  ['prose', '# Guide\n\nOld **text**.', '# New guide\n\nNew *text*.'],
  [
    'table',
    '| Field | Meaning |\n| --- | --- |\n| a | First |',
    '| Field | Meaning |\n| --- | --- |\n| a | Second |\n| b | New |',
  ],
  ['code sample', '```tsx\n<Button/>\n```', '```tsx\n<Button className="bg-red-500"/>\n```'],
  [
    'frontmatter',
    '---\ntitle: Old\ndescription: Before\n---\n\nText',
    '---\ntitle: New\ndescription: After\n---\n\nMore text',
  ],
  [
    'FAQ',
    `${faq}<FAQ items={[{question: "Why?", answer: "Before"}]} />`,
    `${faq}<FAQ items={[{question: "Why?", answer: "After"}, {question: "When?", answer: "Now"}]} />`,
  ],
  [
    'article metadata and FAQ',
    '---\nupdated: 2026-07-31\nauthors: [andrew]\nfaq: [{q: Why, a: Before}]\n---',
    '---\nupdated: 2026-08-29\nauthors: [andrew, bill]\nfaq: [{q: Why, a: After}]\n---',
  ],
  [
    'callout',
    `${callout}<Callout type="info">Before</Callout>`,
    `${callout}<Callout type="info">After</Callout>`,
  ],
  ['literal expression', '{"Before"}', '{"After"}'],
  ['standard HTML prose', '<p><strong>Before</strong></p>', '<p><strong>After</strong></p>'],
])('exempts routine documentation %s', async (_, before, after) => {
  const report = await compareFiles({ [file]: before }, { [file]: after })
  expect(report.flagged).toBe(false)
  expect(report.findings).toEqual([])
})

it('exempts new and removed standard documentation pages', async () => {
  const document = `---\ntitle: New page\n---\n\n${callout}# New guide\n\n<Callout type="info">Instructions</Callout>`
  expect((await compareFiles({}, { [file]: document })).flagged).toBe(false)
  expect((await compareFiles({ [file]: document }, { [file]: null })).flagged).toBe(false)
})

it('resolves documented component import aliases without granting arbitrary names trust', async () => {
  const before = `${faq}<FAQ items={[]} />`
  const after =
    "import { FAQ as Questions } from '@/components/ui/faq'\n\n<Questions items={[{question:'Q',answer:'A'}]} />"
  expect((await compareFiles({ [file]: before }, { [file]: after })).flagged).toBe(false)
  expect(
    (
      await compareFiles(
        { [file]: before },
        { [file]: "import { FAQ } from './custom'\n\n<FAQ items={[]} />" }
      )
    ).flagged
  ).toBe(true)
})

it.each([
  ['custom control', '# Guide', '# Guide\n\n<CustomSearch />'],
  ['native control', '# Guide', '# Guide\n\n<input placeholder="Search" />'],
  [
    'class override',
    `${callout}<Callout className="p-2">Text</Callout>`,
    `${callout}<Callout className="p-4">Text</Callout>`,
  ],
  ['style override', '<p style={{color:"red"}}>Text</p>', '<p style={{color:"blue"}}>Text</p>'],
  [
    'nested styles',
    '- <span className="text-red-500">Text</span>',
    '- <span className="text-blue-500">Text</span>',
  ],
  ['image dimensions', '<img src="/a.png" width={100}/>', '<img src="/a.png" width={200}/>'],
  ['image source', '![Screenshot](/a.png)', '![Screenshot](/b.png)'],
  ['new embedded image', '# Guide', '# Guide\n\n![Screenshot](/a.png)'],
  ['article cover', '---\nogImage: /a.png\n---', '---\nogImage: /b.png\n---'],
  [
    'unknown frontmatter',
    '---\ntitle: Old\nlayout: narrow\n---',
    '---\ntitle: New\nlayout: wide\n---',
  ],
  ['spread', `${faq}<FAQ items={[]} />`, `${faq}<FAQ {...settings} />`],
  ['unknown expression', '# Guide', '{getCustomUI()}'],
  ['JSX in content prop', `${faq}<FAQ items={[]} />`, `${faq}<FAQ items={[{answer:<input/>}]} />`],
  ['side-effect import', '# Guide', "import './custom.css'\n\n# Guide"],
  ['broken MDX', '# Guide', '<div'],
  ['broken YAML', '# Guide', '---\ntitle: [broken\n---'],
  ['custom YAML tag', '# Guide', '---\ntitle: !!js/function "function(){}"\n---'],
])('retains flags for documentation %s', async (_, before, after) => {
  expect((await compareFiles({ [file]: before }, { [file]: after })).flagged).toBe(true)
})

it('does not let added prose shift the identity of unchanged presentation', async () => {
  const widget = '<img src="/a.png" width={100}/>'
  const report = await compareFiles(
    { [file]: widget },
    { [file]: `# Heading\n\nNew prose\n\n${widget}` }
  )
  expect(report.flagged).toBe(false)
})

it('repeats byte-identical reports under the documentation policy without executing MDX', async () => {
  const repo = new FixtureRepo()
  const sentinel = '__designDiffDocumentExecuted'
  try {
    const base = repo.commit({ [file]: '# Before' })
    const head = repo.commit({ [file]: `{globalThis.${sentinel} = true}` })
    const first = await analyze(repo.cwd, base, head, config)
    const second = await analyze(repo.cwd, base, head, config)
    expect(first.flagged).toBe(true)
    expect(serializeReport(first)).toBe(serializeReport(second))
    expect(Reflect.get(globalThis, sentinel)).toBeUndefined()
  } finally {
    repo.close()
  }
})

it('retains shared documentation component changes even when page content is exempt', async () => {
  const component = 'apps/docs/components/ui/faq.tsx'
  expect(
    (
      await compareFiles(
        {
          [file]: `${faq}<FAQ items={[]} />`,
          [component]: 'export const FAQ=()=> <div className="p-2"/>',
        },
        { [component]: 'export const FAQ=()=> <div className="p-4"/>' }
      )
    ).flagged
  ).toBe(true)
})

it('retains product copy and new shared or custom controls in mixed PRs', async () => {
  for (const next of [
    'export const A=()=> <p>New label</p>',
    'import { ChipInput } from "@sim/emcn"; export const A=()=> <ChipInput placeholder="Search"/>',
    'export const A=()=> <input className="rounded-none bg-red-500"/>',
  ]) {
    const report = await compareFiles(
      { [file]: '# Before', 'apps/sim/a.tsx': 'export const A=()=> <p>Old label</p>' },
      { [file]: '# After', 'apps/sim/a.tsx': next }
    )
    expect(report.flagged).toBe(true)
  }
})

it('can retain the broader Markdown policy outside the configured authoring roots', async () => {
  const broad = { ...config, documentationContent: undefined }
  expect((await compareFiles({ [file]: '# Before' }, { [file]: '# After' }, broad)).flagged).toBe(
    true
  )
})
