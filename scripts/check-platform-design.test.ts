import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const CHECK = fileURLToPath(new URL('./check-platform-design.ts', import.meta.url))
const ROOT = mkdtempSync(path.join(tmpdir(), 'sim-platform-design-'))
const APP = path.join(ROOT, 'apps/sim')
const PRODUCT = '01M6A91A32GBA6GTN4HASVG0ER'
const SHARED = '01M6ASMJ22TS7WG8Q3P5YTHWWD'

function write(file: string, content: string) {
  const absolute = path.join(APP, file)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

function audit() {
  const result = spawnSync('bun', [CHECK, ROOT], { encoding: 'utf8' })
  if (result.error) throw result.error
  return { status: result.status, output: result.stdout + result.stderr }
}

it('rejects design drift across real JSX, CSS and Paper ownership boundaries', () => {
  try {
    symlinkSync(
      path.resolve(path.dirname(CHECK), '../node_modules'),
      path.join(ROOT, 'node_modules'),
      'dir'
    )
    const base = [SHARED, 'p-5-0', '1A-0']
    const use = [PRODUCT, 'p-C-0', '2B-0']
    const evidence = {
      key: 'C0092',
      family: 'Button',
      theme: 'L',
      scope: 'shared',
      owner: 'Button',
      base,
      use,
    }
    const style = 'platform/design-system/styles'
    const catalog = 'platform/design-system/catalog'
    const component = 'platform/design-system/components/button'
    const writeCatalog = (name: string, value: unknown) =>
      write(`${catalog}/${name}.json`, JSON.stringify(value))
    writeCatalog('recipes', {})
    writeCatalog('evidence', [evidence])
    writeCatalog('variants', { Button: { variant: { primary: ['C0092'] } } })
    write(`${style}/tokens.css`, '[data-platform-ui] { --color-ink: #141414; }')
    write(
      `${component}/button.module.css`,
      '.button { @apply inline-flex; color: var(--color-ink); }'
    )
    write(
      `${component}/button.tsx`,
      `import styles from '@/platform/design-system/components/button/button.module.css'
      interface ButtonProps { variant: 'primary' }
      export function Button({variant}: ButtonProps) {
        return <button data-variant={variant} className={styles.button}>Accept</button>
      }`
    )
    write(
      'platform/app/page.tsx',
      `import { Button as Action } from '@/platform/design-system/components/button/button'
      export default function Page() { return <Action variant="primary"/> }`
    )
    write(
      'platform/app/settings/_components/panel.tsx',
      `import classes from '@/platform/app/settings/_components/panel.module.css'
      export function Panel(){return <section className={classes.panel}/>}`
    )
    write('platform/app/settings/_components/panel.module.css', '.panel{padding:0}')
    expect(audit()).toEqual({ status: 0, output: expect.stringContaining('passed') })

    writeCatalog('evidence', [
      evidence,
      {
        ...evidence,
        key: 'C0111',
        base: [SHARED, 'p-5-0', '1B-0'],
        use: [PRODUCT, 'p-C-0', '2C-0'],
      },
    ])
    writeCatalog('variants', { Button: { variant: { primary: ['C0092'], ghost: ['C0111'] } } })
    write(
      `${component}/button.tsx`,
      `interface ButtonProps {variant:'primary' | 'ghost'}
      export function Button({variant}: ButtonProps) {return <button data-variant={variant}/>}`
    )
    write(
      'platform/preview/gallery.tsx',
      `import { Button } from '@/platform/design-system/components/button/button'
      export const Specimen = () => <Button variant="ghost"/>`
    )
    const productPage = `import { Button as Action } from '@/platform/design-system/components/button/button'
      function Unused(){return <Action variant="ghost"/>}
      function Nested({choice}:{choice:'primary'|'ghost'}) {return <Action variant={choice}/>}
      export default function Page(){return <Nested choice="primary"/>}`
    write('platform/app/page.tsx', productPage)
    write(
      'platform/app/workbench/page.tsx',
      `import { Button } from '@/platform/design-system/components/button/button'
      export default function Workbench(){return <main><Button variant="ghost"/></main>}`
    )
    expect(audit()).toEqual({
      status: 1,
      output: expect.stringContaining('[code-use] Button.variant=ghost'),
    })
    write(
      'platform/app/page.tsx',
      productPage.replace(
        '<Nested choice="primary"/>',
        '<><Nested choice="primary"/><Nested choice="ghost"/></>'
      )
    )
    expect(audit()).toEqual({ status: 0, output: expect.stringContaining('passed') })

    const inactive = [
      'false && <Nested choice="ghost"/>',
      'true || <Nested choice="ghost"/>',
      'DISABLED ? <Nested choice="ghost"/> : null',
      '<Nested choice={DISABLED ? "ghost" : "primary"}/>',
    ]
      .map((expression) => `{${expression}}`)
      .join('')
    const deadPage = productPage
      .replace('function Page(){', 'function Page(){if (DISABLED) return <Nested choice="ghost"/>;')
      .replace('<Nested choice="primary"/>', `<><Nested choice="primary"/>${inactive}</>`)
    write('platform/app/page.tsx', `const DISABLED = false; ${deadPage}`)
    expect(audit()).toEqual({
      status: 1,
      output: expect.stringContaining('[code-use] Button.variant=ghost'),
    })

    write(
      'platform/app/page.tsx',
      productPage.replace(
        '<Nested choice="primary"/>',
        '<><Nested choice={Date.now() % 2 ? "primary" : "ghost"}/><link rel="icon" href="/favicon.ico"/></>'
      )
    )
    const source = `type Palette = { variant: 'primary'|'ghost' }
      export type ButtonProps = Palette & { theme?: 'light'|'dark' }
      export const Button = ({variant}: ButtonProps) => <button data-variant={variant}/>`
    write(`${component}/button.tsx`, source)
    expect(audit()).toEqual({ status: 0, output: expect.stringContaining('passed') })
    write(
      `${component}/native.tsx`,
      `import type {ComponentProps} from 'react'
      export const Native = (props: ComponentProps<'button'>) => <button disabled={props.disabled}/>`
    )
    const domProps = audit()
    expect(domProps.status).toBe(1)
    expect(domProps.output).toContain('[style-api] className')
    write(
      `${component}/native.tsx`,
      `import type {ComponentProps} from 'react'
      export const Native = (props: Pick<ComponentProps<'button'>, 'disabled'>) => <button disabled={props.disabled}/>`
    )
    expect(audit()).toEqual({ status: 0, output: expect.stringContaining('passed') })

    write(
      `${component}/button.tsx`,
      source
        .replace("'primary'|'ghost'", "'primary'|'ghost'|'invented'")
        .replace('theme?:', 'className?:string; theme?:')
    )
    const aliased = audit()
    expect(aliased.status).toBe(1)
    expect(aliased.output).toContain('[variant-declaration] Button.variant')
    expect(aliased.output).toContain('[style-api] className')
    write(`${component}/button.tsx`, source)

    for (const [file, tag] of [
      ['inline', '<style>{".button{color:red}"}</style>'],
      ['stylesheet', '<link rel={"stylesheet"} href="/bypass.css"/>'],
      ['dynamic', '<link rel={kind} href="/bypass.css"/>'],
    ]) {
      write(
        `platform/app/${file}.tsx`,
        `const kind: string = "stylesheet"; export const Escape = () => ${tag}`
      )
    }
    const injected = audit()
    expect(injected.status).toBe(1)
    for (const file of ['inline', 'stylesheet', 'dynamic']) {
      expect(injected.output).toContain(`platform/app/${file}.tsx:1 [consumer-style]`)
    }

    write('platform/app/settings/_components/index.ts', `export { Panel } from './panel'`)
    write(
      'platform/app/settings/_components/section.tsx',
      'export function Section() { return null }'
    )
    write(
      'platform/app/chats/other.ts',
      `export { Panel } from '@/platform/app/settings/_components'`
    )
    write(
      'platform/app/settings/_components/profile/profile.ts',
      `import '@/platform/app/settings/_components/panel.module.css'`
    )
    write('platform/app/chats/gallery.ts', `export { Specimen } from '@/platform/preview/gallery'`)
    write(
      'platform/design-system/components/menu/chrome.ts',
      `import '../button/button.module.css'`
    )
    write(
      'platform/app/chats/private.ts',
      `export { Section } from '@/platform/app/settings/_components/section'`
    )
    write('platform/design-system/features/leak/example.ts', 'export const example = true')
    write('platform/design-system/components/flat.ts', 'export const flat = true')
    write(
      'platform/app/settings/_components/banner.tsx',
      'export const Banner = () => <p>Email delivery is disabled in this preview.</p>'
    )
    const feature = 'platform/app/settings/_components'
    write(
      `${feature}/trigger.tsx`,
      `import styles from '@/platform/design-system/components/button/button.module.css'; export const Trigger = () => <button className={styles.button}/>`
    )
    write(
      `${feature}/actions.module.css`,
      '.action { composes: button from "@/platform/design-system/components/button/button.module.css"; }'
    )
    write(`${component}/private.ts`, `import '@/platform/preview/chrome'`)
    write(
      'app/legacy.ts',
      `export { Button } from '../platform/design-system/components/button/button'`
    )
    write(
      'platform/app/escape.tsx',
      `import { Button } from '@/platform/design-system/components/button/button'
      import '@/platform/app/bypass.css'
      export const escape = (props: object) => <Button className="red" style={{opacity: 0.2}} {...props}/>
      export const legacy = () => import('@/components/old')
      export const data = () => import('@/platform/fixtures/data')`
    )
    write(
      `${component}/unregistered.tsx`,
      `
      interface ActionProps { variant: 'default' | 'not-in-paper' }
      export function Action({ variant }: ActionProps) { return <button data-variant={variant}/> }`
    )
    write('platform/app/bypass.css', '.button { color: blue }')
    write(
      `${component}/button.module.css`,
      ".button[data-variant='unused-selector']{color:var(--unregistered);background:rebeccapurple; @apply bg-[#f00]; opacity:.37; padding:37px}"
    )
    write(
      `${component}/passthrough.tsx`,
      `interface Props { className?: string }
      export function Forward(props: Props) { return <button {...props}/> }`
    )
    write(
      'platform/preview/chrome.tsx',
      'export const Preview = () => <div className="catalog-row"/>'
    )
    write(
      'platform/preview/raw-picker.tsx',
      `import {Select} from '@base-ui/react/select'
      export function RawPicker(){return <><select/><Select.Root/></>}`
    )
    write(`${component}/focus.module.css`, '.field:focus-within{border-color:var(--color-ink)}')
    write('platform/preview/chrome.css', '.catalog-row button{color:var(--color-ink)}')
    write(
      'platform/preview/gallery.tsx',
      `import { Button } from '@/platform/design-system/components/button/button'
      export const Specimen = () => <Button variant="ghost"/>`
    )
    writeCatalog('recipes', { C9999: { slots: {}, root: {} } })
    writeCatalog('evidence', [
      { ...evidence, key: 'C0000', base: ['bogus', 'p-1-0', '0-A'] },
      evidence,
      { ...evidence, key: 'C0093', use: [SHARED, 'p-5-0', '30-0'], parentKey: 'C0094' },
      { ...evidence, key: 'C0094', use: [SHARED, 'p-5-0', '31-0'], parentKey: 'C0093' },
    ])
    writeCatalog('variants', { Button: { variant: { primary: ['C0092'], ghost: ['C0093'] } } })
    const result = audit()
    expect(result.status).toBe(1)
    expect(result.output).toContain(`${feature}/trigger.tsx [private-recipe]`)
    expect(result.output).toContain(`${feature}/actions.module.css [private-recipe]`)
    expect(result.output).toContain('platform/app/chats/other.ts [private-composition]')
    expect(result.output).toContain(
      'platform/app/settings/_components/profile/profile.ts [private-recipe]'
    )
    expect(result.output).toContain('platform/app/chats/gallery.ts [workbench-dependency]')
    expect(result.output).toContain(
      'platform/design-system/components/menu/chrome.ts [private-recipe]'
    )
    for (const issue of [
      'legacy-import',
      'consumer-style',
      'prop-spread',
      'style-api',
      'fixture-boundary',
      'css-owner',
      'preview-selector',
      'unknown-token',
      'focus-style',
      'native-picker',
      'primitive-owner',
      'raw-color',
      'utility-token',
      'untokenized-style',
      'raw-geometry',
      'variant-use',
      'variant-declaration',
      'variant-selector',
      'recipe-owner',
      'feature-owner',
      'component-folder',
      'product-copy',
      'private-composition',
      'paper-base',
      'design-dependency',
    ])
      expect(result.output, issue).toContain(`[${issue}]`)
  } finally {
    rmSync(ROOT, { recursive: true, force: true })
  }
}, 30_000)
