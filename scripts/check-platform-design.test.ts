import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    const component = 'platform/design-system/components'
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
      `import styles from '@/platform/design-system/components/button.module.css'
      interface ButtonProps { variant: 'primary' }
      export function Button({variant}: ButtonProps) {
        return <button data-variant={variant} className={styles.button}>Accept</button>
      }`
    )
    write(
      'platform/app/page.tsx',
      `import { Button as Action } from '@/platform/design-system/components/button'
      export default function Page() { return <Action variant="primary"/> }`
    )
    write(
      'platform/design-system/features/settings/panel.tsx',
      `import classes from '@/platform/design-system/features/settings/panel.module.css'
      export function Panel(){return <section className={classes.panel}/>}`
    )
    write('platform/design-system/features/settings/panel.module.css', '.panel{padding:0}')
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
      `import { Button } from '@/platform/design-system/components/button'
      export const Specimen = () => <Button variant="ghost"/>`
    )
    const productPage = `import { Button as Action } from '@/platform/design-system/components/button'
      function Unused(){return <Action variant="ghost"/>}
      function Nested({choice}:{choice:'primary'|'ghost'}) {return <Action variant={choice}/>}
      export default function Page(){return <Nested choice="primary"/>}`
    write('platform/app/page.tsx', productPage)
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

    write('platform/design-system/features/settings/index.ts', `export { Panel } from './panel'`)
    write(
      'platform/app/settings/_components/section.tsx',
      'export function Section() { return null }'
    )
    write(
      'platform/app/chats/other.ts',
      `export { Panel } from '@/platform/design-system/features/settings'`
    )
    write(
      'platform/app/chats/private.ts',
      `export { Section } from '@/platform/app/settings/_components/section'`
    )
    write(`${component}/private.ts`, `import '@/platform/preview/chrome'`)
    write('app/legacy.ts', `export { Button } from '../platform/design-system/components/button'`)
    write(
      'platform/app/escape.tsx',
      `import { Button } from '@/platform/design-system/components/button'
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
    write('platform/preview/chrome.css', '.catalog-row button{color:var(--color-ink)}')
    write(
      'platform/preview/gallery.tsx',
      `import { Button } from '@/platform/design-system/components/button'
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
    for (const issue of [
      'legacy-import',
      'consumer-style',
      'prop-spread',
      'style-api',
      'fixture-boundary',
      'css-owner',
      'preview-selector',
      'unknown-token',
      'raw-color',
      'utility-token',
      'untokenized-style',
      'raw-geometry',
      'variant-use',
      'variant-declaration',
      'variant-selector',
      'recipe-owner',
      'feature-owner',
      'private-composition',
      'paper-base',
      'design-dependency',
    ])
      expect(result.output, issue).toContain(`[${issue}]`)
  } finally {
    rmSync(ROOT, { recursive: true, force: true })
  }
})
