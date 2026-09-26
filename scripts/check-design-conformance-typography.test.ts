import { expect, test } from 'vitest'
import type { ControlSource } from '#control-analysis/model'
import { classifyTypography, inspectTypography } from '#control-analysis/typography'

const globals = 'apps/sim/app/_styles/globals.css'
const editor =
  'apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css'
const loader = 'apps/sim/components/ui/thinking-loader.tsx'
const loaderCss = 'apps/sim/components/ui/thinking-loader.module.css'
const mdx = 'apps/sim/lib/content/mdx.tsx'
const source = (files: Record<string, string>): ControlSource => ({
  entries: Object.entries(files).map(([path, text]) => ({
    path,
    bytes: Buffer.byteLength(text),
    kind: 'blob',
    mode: '100644',
    blob: 'a'.repeat(40),
  })),
  read: (e) => files[e.path],
  readOwnership: (e) => files[e.path],
})
const definitions =
  '@theme inline { --text-sm: 0.875rem; --font-weight-normal: 400; --font-weight-medium: 500; --font-weight-semibold: 600; }'
const heading = '.rich-markdown-prose h1 {font-size:1.6em;margin-top:1.4em}'
const writer = `export function ThinkingLoader({size=20,labelRatio=0.7}) { return <output style={{"--tl-label-size": \`\${size * labelRatio}px\`, "--tl-label-gap": \`\${size * 0.4}px\`}} /> }`
const labels =
  '.label {font-size:var(--tl-label-size,var(--text-sm))}.labelStatic {font-size:var(--tl-label-size,var(--text-sm))}'
const review = (files: Record<string, string>) =>
  inspectTypography(source({ [globals]: definitions, ...files }))
const finding = (c: {
  file: string
  line: number
  column: number
  property: string
  value: string
}) => ({
  ...c,
  kind: 'usage-violation' as const,
  contract: 'central-typography',
  rule: 'central-typography',
  category: 'typography',
  context: 'test',
  reason: 'test',
})

test('recognizes explicitly adopted finite weight tokens, not arbitrary names or fallback expressions', () => {
  const result = review({
    'apps/sim/components/a.css': '.a {font-weight:var(--font-weight-semibold)}',
  })
  expect(result.classifications).toHaveLength(1)
  expect(classifyTypography(result.classifications.map(finding), result)).toEqual([])
  for (const text of ['var(--font-weight-semibold, 700)', 'var(--unknown)', '700']) {
    expect(
      review({ 'apps/sim/components/a.css': `.a {font-weight:${text}}` }).classifications
    ).toEqual([])
  }
  for (const change of [
    definitions.replace('600', '700'),
    `${definitions} .local {--font-weight-semibold:600}`,
    definitions.replace('600', 'var(--weight)'),
  ]) {
    expect(
      review({
        [globals]: change,
        'apps/sim/components/a.css': '.a {font-weight:var(--font-weight-semibold)}',
      }).classifications
    ).toEqual([])
  }
})

test('local CSS and opaque JavaScript assignments revoke weight-token proof', () => {
  const use = '.a {font-weight:var(--font-weight-semibold)}'
  for (const extra of [
    { 'apps/sim/components/other.css': '.b {--font-weight-semibold:900}' },
    { 'apps/sim/components/other.tsx': 'node.style.setProperty("--font-weight-semibold", value)' },
  ] as Record<string, string>[])
    expect(review({ 'apps/sim/components/a.css': use, ...extra }).classifications).toEqual([])
})

test('document Extra approves only its exact unique root recipe and only the font-size finding', () => {
  const result = review({ [editor]: heading })
  expect(result.classifications).toHaveLength(1)
  const raw = finding(result.classifications[0])
  expect(classifyTypography([raw], result)).toEqual([])
  expect(classifyTypography([{ ...raw, property: 'color', value: 'red' }], result)).toHaveLength(1)
  for (const text of [
    heading.replace('1.6em', '1.7em'),
    heading.replace('1.4em', '2em'),
    heading + heading,
    `@media(min-width:1px){${heading}}`,
    heading.replace(' h1', ' h1, .button'),
    heading.replace('1.6em', '1.6em!important'),
    heading.replace('font-size:1.6em', 'font-size:1.6em;font-size:1.6em'),
  ]) {
    expect(review({ [editor]: text }).classifications).toEqual([])
  }
  const copied = review({ 'apps/sim/components/copied.css': heading })
  expect(copied.classifications).toEqual([])
})

test('loader Extra requires the known parameter relationship and the central fallback', () => {
  const good = review({ [loader]: writer, [loaderCss]: labels })
  expect(good.classifications).toHaveLength(2)
  for (const changed of [
    writer.replace('size * labelRatio', 'size * 2'),
    writer.replace('size * labelRatio', 'unknown'),
    writer.replace('function ThinkingLoader', 'function Unrelated'),
    writer.replace('return <output', 'size = external; return <output'),
    writer.replace(`"--tl-label-gap": \`\${size * 0.4}px\``, '...external'),
    writer.replace('size=20', 'size=24'),
    writer.replace('labelRatio=0.7', 'labelRatio=0.9'),
  ]) {
    expect(review({ [loader]: changed, [loaderCss]: labels }).classifications).toEqual([])
  }
  for (const changed of [
    labels.replaceAll('var(--text-sm)', '14px'),
    labels + labels,
    labels.replaceAll('.labelStatic', '.other'),
  ]) {
    expect(review({ [loader]: writer, [loaderCss]: changed }).classifications).toEqual([])
  }
})

test('copied loader writers, runtime writes and CSS shadowing remain unapproved', () => {
  for (const extra of [
    { 'apps/sim/components/copy.tsx': writer },
    { 'apps/sim/components/runtime.ts': 'node.style.setProperty("--tl-label-size", value)' },
    { 'apps/sim/components/shadow.css': '.other {--tl-label-size:99px}' },
    { 'apps/sim/components/shadow.css': '.other {--text-sm:99px}' },
    { [globals]: `${definitions}@theme inline { --text-sm:0.875rem }` },
  ] as Record<string, string>[])
    expect(review({ [loader]: writer, [loaderCss]: labels, ...extra }).classifications).toEqual([])
})

test('marketing source stays outside typography inspection even with unrelated oversized modules', () => {
  const files = {
    [mdx]: 'export const mdxComponents = {}',
    'apps/sim/app/(landing)/blog/page.tsx': 'import {mdxComponents} from "@/lib/content/mdx"',
    'apps/docs/app/page.tsx': 'import {mdxComponents} from "../../sim/lib/content/mdx"',
    'apps/sim/tools/generated/tool-metadata.ts': `export const data = '${'x'.repeat(2 * 1024 * 1024)}'`,
    'scripts/generate-docs.ts':
      'const mdx = true; const registry = await import(path.join(root, "tools/registry.ts"))',
  }
  const result = review(files)
  expect(result.ownership).toEqual([])
  const radius = {
    ...finding({ file: mdx, line: 1, column: 1, property: 'border-radius', value: '4px' }),
    contract: 'central-radius',
    rule: 'central-radius',
    category: 'radii',
  }
  expect(classifyTypography([radius], result)).toHaveLength(1)

  const product = review({
    ...files,
    'apps/sim/app/workspace/product.tsx': `import {mdxComponents} from '@/lib/content/mdx'; export const data = '${'x'.repeat(2 * 1024 * 1024)}'`,
  })
  expect(product.ownership).toEqual([])
  expect(classifyTypography([radius], product)).toHaveLength(1)
})

test('unreferenced marketing helpers remain outside typography inspection', () => {
  expect(review({ [mdx]: 'export const x = 1' }).ownership).toEqual([])
  const result = review({
    [mdx]: 'export const x = 1',
    'apps/sim/lib/content/index.ts': 'export * from "./mdx";export * from "./loop"',
    'apps/sim/lib/content/loop.ts': 'export * from "./index"',
  })
  expect(result.ownership).toEqual([])
})

test('font-size tokens cannot approve a font-weight declaration', () => {
  expect(
    review({ 'apps/sim/components/a.css': '.a {font-weight:var(--text-sm)}' }).classifications
  ).toEqual([])
})

test('uninspected CSS cannot establish global weight token ownership', () => {
  const result = review({
    'apps/sim/components/gap.css': '.gap{',
    'apps/sim/components/a.css': '.a{font-weight:var(--font-weight-semibold)}',
  })
  expect(result.classifications).toEqual([])
  expect(result.unchecked.some((n) => n.file === 'apps/sim/components/gap.css')).toBe(true)
})
