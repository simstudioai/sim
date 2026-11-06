import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
    const modal = 'platform/design-system/components/modal'
    write(
      `${modal}/modal.tsx`,
      'export function Modal(){return null}; export function MultiStepModal(){return null}'
    )
    write(`${modal}/overlay-dialog.tsx`, 'export function OverlayDialog(){return null}')
    write(
      `${modal}/modal-parts.tsx`,
      'export function ModalHeader(){return null}; export function ModalFooter(){return null}'
    )
    write(
      `${modal}/index.ts`,
      "export * from './modal'; export * from './overlay-dialog'; export * from './modal-parts'"
    )
    const dialogImports = `import * as Dialogs from '@/${modal}';
      import { OverlayDialog as Surface, ModalFooter as Actions } from '@/${modal}';
      import { Button as Action } from '@/${component}/button';`
    write(
      'platform/app/settings/_components/inspector.tsx',
      `${dialogImports}
      function ModalFooter(){return <span>Document information</span>}
      export function Inspect({title}:{title:string}) {return <>
        <Surface title={title}><article><h2>{title}</h2><footer><button>View author</button></footer></article></Surface>
        <Dialogs.OverlayDialog label="Search" presentation="command"><form role="search"><input type="search"/></form></Dialogs.OverlayDialog>
        <Dialogs.Modal title="Rename" confirmLabel="Save"><input/></Dialogs.Modal>
        <dialog aria-label="Navigation drawer"><nav/></dialog>
        <form><button>Cancel</button></form><ModalFooter/></>}`
    )
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
    write(
      'platform/app/page.tsx',
      productPage.replace(
        'function Page(){return',
        'function Page(){function discarded(){return <Nested choice="ghost"/>} (discarded()); return'
      )
    )
    write(
      'platform/app/workbench/page.tsx',
      `import { Button } from '@/platform/design-system/components/button/button'
      export default function Workbench(){return <main><Button variant="ghost"/></main>}`
    )
    for (const file of ['workbench/loading', '_draft/error', 'orphan/error', '@unused/default']) {
      write(`platform/app/${file}.tsx`, productPage.replace('choice="primary"', 'choice="ghost"'))
    }
    expect(audit()).toEqual({
      status: 1,
      output: expect.stringContaining('[code-use] Button.variant=ghost'),
    })

    const boundaries = {
      'platform/app/template.tsx': 'template',
      'platform/app/account/error.tsx': 'error',
      'platform/app/account/loading.tsx': 'loading',
      'platform/app/account/not-found.tsx': 'not-found',
      'platform/app/global-error.tsx': 'global-error',
    }
    write('platform/app/account/details/page.tsx', 'export default function Page(){return null}')
    const choices = ['primary', 'ghost', 'shadow', 'defaulted', ...Object.values(boundaries)]
    writeCatalog('variants', {
      Button: { variant: Object.fromEntries(choices.map((choice) => [choice, []])) },
    })
    write(
      `${component}/button.tsx`,
      `export function Button({variant}:{variant:${choices.map((choice) => JSON.stringify(choice)).join('|')}}) {
        return <button data-variant={variant}/>;
      }`
    )
    for (const [file, variant] of Object.entries(boundaries)) {
      write(
        file,
        `import {Button} from '@/${component}/button';
         export default function State(){return <Button variant="${variant}"/>}`
      )
    }
    write(
      'platform/app/page.tsx',
      `import {Button} from '@/${component}/button';
       function Row({choice}:{choice:'primary'|'ghost'}) {
         const render = (kind = choice) => <Button variant={kind}/>;
         function shadow({choice = 'shadow'} = {}){return <Button variant={choice}/>}
         const withDefault = (choice = 'defaulted') => <Button variant={choice}/>;
         return <>{render()}{shadow({})}{withDefault(undefined)}</>;
       }
       function renderRow(choice:'primary'|'ghost'){return <Row choice={choice}/>}
       export default function Page(){return <>{renderRow('primary')}{renderRow('ghost')}</>}`
    )
    const reachable = audit()
    expect(reachable.output).toContain('Platform design passed')
    expect(reachable.status).toBe(0)
    for (const file of Object.keys(boundaries)) rmSync(path.join(APP, file))
    writeCatalog('variants', { Button: { variant: { primary: ['C0092'], ghost: ['C0111'] } } })
    write(
      `${component}/button.tsx`,
      `interface ButtonProps {variant:'primary' | 'ghost'}
       export function Button({variant}: ButtonProps) {return <button data-variant={variant}/>}`
    )

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

    write('platform/app/chats/ages.ts', "export const updated = '17hrs ago'")
    write('platform/app/chats/axis.ts', 'export const day = new Intl.DateTimeFormat("en-US")')
    write(
      'platform/app/chats/stamp.ts',
      'export const stamp = (date: Date) => date.toLocaleString()'
    )
    write('platform/app/chats/total.ts', 'export const total = (n: number) => n.toLocaleString()')
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
    const handBuiltDialogs = [
      ['header-part', '<Dialogs.ModalHeader title="Invite"/>'],
      ['footer-part', '<Actions confirmLabel="Invite"/>'],
      ['form-overlay', '<Surface title="Invite" onSubmit={save}><input/></Surface>'],
      [
        'cancel',
        '<Dialogs.Modal title="Invite"><div><Action>Cancel</Action></div></Dialogs.Modal>',
      ],
      ['native-form', '<dialog aria-label="Invite"><form><input/></form></dialog>'],
      [
        'step',
        '<Dialogs.MultiStepModal title="Invite" steps={[{content:<Action>Cancel</Action>}]}/>',
      ],
      [
        'footer',
        '<Surface title="Invite"><footer><button type="submit">Save</button></footer></Surface>',
      ],
      ['title', '<Dialogs.Modal title={title}><h2>{title}</h2></Dialogs.Modal>'],
      [
        'aria-form',
        '<section role="dialog" aria-label="Invite"><button type="submit">Save</button></section>',
      ],
    ]
    for (const [name, jsx] of handBuiltDialogs) {
      write(
        `${feature}/${name}.tsx`,
        `${dialogImports}\nexport const Broken = (title:string) => ${jsx}`
      )
    }
    write(
      `${feature}/unnamed.tsx`,
      `${dialogImports}\nexport const Unnamed = () => <Surface label=" " presentation="command"/>`
    )
    write(
      `${feature}/icon.tsx`,
      'export const Glyph = () => <svg aria-hidden="true"><path d="M0 0h8" /></svg>'
    )
    write(`${feature}/ink.module.css`, '.row svg path { stroke: currentColor; }')
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
      export const paperSpecimen = () => import('@/platform/design-system/catalog/component-recipe')
      export const localTimer = () => window.setTimeout(() => {}, 2000)
      export const legacy = () => import('@/components/old')
      export const data = () => import('@/platform/fixtures/data')`
    )
    write(
      'platform/lib/data/allowed.ts',
      `import type { Principal } from '@/lib/api/contracts/primitives'
      import { useOrganizations } from '@/hooks/queries/organization'
      import { client } from '@/lib/auth/client'
      import { createLogger } from '@sim/logger'
      import type { ShellData } from '@/platform/app/shell/_components/model'
      export const allowed: unknown[] = [useOrganizations, client, createLogger]
      export type { Principal, ShellData }`
    )
    write(
      'platform/lib/data/forbidden.ts',
      `import '@/app/o/layout'
      import '@/components/settings/navigation'
      import '@/lib/auth/server-only-module'
      import '@sim/emcn'
      import '@/platform/app/shell/_components/value'`
    )
    write(
      'platform/app/chats/bypasses-seam.ts',
      `import '@/hooks/queries/mothership-chats'
      import '@/lib/api/client/request'
      import '@sim/logger'`
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
      ".button[data-variant='unused-selector']{color:var(--unregistered);background:rebeccapurple; @apply bg-[#f00]; opacity:.37; padding:37px;transition:color .2s}"
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
    for (const [file] of handBuiltDialogs) {
      expect(result.output).toContain(`${feature}/${file}.tsx:4 [dialog-owner]`)
    }
    expect(result.output).toContain(`${feature}/unnamed.tsx:4 [dialog-name]`)
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
    expect(result.output).toContain('platform/app/chats/ages.ts:1 [time-format]')
    expect(result.output).toContain('platform/app/chats/axis.ts:1 [time-format]')
    expect(result.output).toContain('platform/app/chats/stamp.ts:1 [time-format]')
    expect(result.output).not.toContain('platform/app/chats/total.ts:1 [time-format]')
    expect(result.output).toContain(`${feature}/icon.tsx:1 [icon-owner]`)
    expect(result.output).toContain(`${feature}/ink.module.css:1 [icon-owner]`)
    expect(result.output).not.toContain('platform/lib/data/allowed.ts [')
    for (const specifier of [
      '@/app/o/layout',
      '@/components/settings/navigation',
      '@/lib/auth/server-only-module',
      '@sim/emcn',
    ])
      expect(result.output).toContain(`platform/lib/data/forbidden.ts [legacy-import] ${specifier}`)
    expect(result.output).toContain('platform/lib/data/forbidden.ts [private-composition]')
    for (const specifier of [
      '@/hooks/queries/mothership-chats',
      '@/lib/api/client/request',
      '@sim/logger',
    ])
      expect(result.output).toContain(
        `platform/app/chats/bypasses-seam.ts [legacy-import] ${specifier}`
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
      'motion-timing',
      'feedback-timing',
      'specimen-owner',
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

/** The smallest app the check passes on, with the embedded tree beside the zone. */
function embeddedFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-platform-embedded-'))
  const put = (file: string, content: string) => {
    const absolute = path.join(root, 'apps/sim', file)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
  symlinkSync(
    path.resolve(path.dirname(CHECK), '../node_modules'),
    path.join(root, 'node_modules'),
    'dir'
  )
  mkdirSync(path.join(root, 'scripts'))
  const catalog = 'platform/design-system/catalog'
  put(`${catalog}/recipes.json`, '{}')
  put(
    `${catalog}/evidence.json`,
    JSON.stringify([
      {
        key: 'C0092',
        family: 'Button',
        theme: 'L',
        scope: 'shared',
        owner: 'Button',
        base: [SHARED, 'p-5-0', '1A-0'],
        use: [PRODUCT, 'p-C-0', '2B-0'],
      },
    ])
  )
  put(`${catalog}/variants.json`, JSON.stringify({ Button: { variant: { primary: ['C0092'] } } }))
  put('platform/design-system/styles/tokens.css', '[data-platform-ui] { --color-ink: #141414; }')
  put(
    'platform/design-system/components/button/button.tsx',
    `export function Button({variant}: {variant: 'primary'}) { return <button data-variant={variant}/> }`
  )
  put(
    'platform/embedded/app/(shell)/home/_components/home/home.tsx',
    `import { useThing } from '@/hooks/queries/thing'
    import { logger } from '@sim/logger'
    import { Button } from '@/platform/design-system/components/button/button'
    export const used = [useThing, logger]
    export function Home() { return <Button variant='primary'/> }`
  )
  put(
    'app/o/[organizationId]/home/page.tsx',
    `import { Home } from '@/platform/embedded/app/(shell)/home/_components/home/home'
    export default function Page() { return <Home/> }`
  )
  const run = (...flags: string[]) => {
    const result = spawnSync('bun', [CHECK, root, ...flags], { encoding: 'utf8' })
    if (result.error) throw result.error
    return { status: result.status, output: result.stdout + result.stderr }
  }
  const baseline = path.join(root, 'scripts/check-platform-design.baseline.json')
  return { root, put, run, baseline }
}

it('walks the embedded views, with a shrink-only per-file baseline that holds only them', () => {
  const { root, put, run, baseline } = embeddedFixture()
  const view = 'platform/embedded/app/(shell)/home/_components/home/spread.tsx'
  try {
    expect(run()).toEqual({ status: 0, output: expect.stringContaining('passed') })

    put(view, 'export const Spread = (props: object) => <div {...props}/>')
    expect(run()).toEqual({ status: 1, output: expect.stringContaining(`${view}:1 [prop-spread]`) })

    expect(run('--update').status).toBe(1)
    expect(run('--update', '--init').status).toBe(0)
    expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual({ [view]: { 'prop-spread': 1 } })
    expect(run()).toEqual({ status: 0, output: expect.stringContaining('1 embedded findings') })

    put(
      view,
      `export const Spread = (props: object) => <div {...props}/>
      export const Again = (props: object) => <div {...props}/>`
    )
    expect(run()).toEqual({ status: 1, output: expect.stringContaining(`${view}:2 [prop-spread]`) })
    expect(run('--update').status).toBe(1)
    expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual({ [view]: { 'prop-spread': 1 } })

    put(view, 'export const Clean = 1')
    expect(run()).toEqual({ status: 1, output: expect.stringContaining('shrink it with --update') })
    expect(run('--update').status).toBe(0)
    expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual({})

    const zone = 'platform/app/spread.tsx'
    put(zone, 'export const Spread = (props: object) => <div {...props}/>')
    writeFileSync(baseline, JSON.stringify({ [zone]: { 'prop-spread': 1 } }))
    expect(run()).toEqual({ status: 1, output: expect.stringContaining(`${zone}:1 [prop-spread]`) })
    expect(run('--update').status).toBe(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it.each([
  [
    'zone-embedded',
    'platform/app/page.tsx',
    `import '@/platform/embedded/app/(shell)/home/_components/home/home'`,
  ],
  ['zone-embedded', 'platform/lib/data/home.ts', `import '@/platform/embedded/lib/time'`],
  [
    'zone-embedded',
    'platform/design-system/components/button/leak.ts',
    `import '@/platform/embedded/lib/time'`,
  ],
  ['zone-embedded', 'platform/embedded/lib/data/reach.ts', `import '@/platform/lib/data/home'`],
  ['zone-embedded', 'platform/embedded/lib/data/reach2.ts', `import '../../../app/page'`],
  ['zone-embedded', 'platform/shared/reach.ts', `import '@/platform/design-system/navigation'`],
  ['zone-embedded', 'platform/shared/reach2.ts', `import type {} from '@/platform/lib/data/home'`],
  ['legacy-import', 'app/o/[organizationId]/reach.ts', `import '@/platform/lib/data/home'`],
  ['legacy-import', 'app/workspace/reach.tsx', `import '@/platform/embedded/lib/time'`],
  [
    'private-composition',
    'platform/embedded/app/(shell)/search/_components/reach.ts',
    `import '@/platform/embedded/app/(shell)/home/_components/home/home'`,
  ],
  [
    'private-recipe',
    'app/o/[organizationId]/recipe.ts',
    `import '@/platform/design-system/components/button/button.module.css'`,
  ],
])(
  'fails [%s] for %s',
  (rule, file, source) => {
    const { root, put, run } = embeddedFixture()
    try {
      put(file, `${source}\n`)
      const result = run()
      expect(result.status).toBe(1)
      expect(result.output).toContain(`${file} [${rule}]`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  30_000
)

it('lets a shared model name a design-system type and an organization route import it', () => {
  const { root, put, run } = embeddedFixture()
  try {
    put(
      'platform/shared/model.ts',
      `import type { IconName } from '@/platform/design-system/catalog/icon-geometry'\nexport type Row = IconName\n`
    )
    put('app/o/[organizationId]/model-reader.ts', `import '@/platform/shared/model'\n`)
    expect(run()).toEqual({ status: 0, output: expect.stringContaining('passed') })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('counts a variant only an organization route mounts through a dynamic section table', () => {
  const { root, put, run } = embeddedFixture()
  const button = 'platform/design-system/components/button/button.tsx'
  const section = 'platform/embedded/app/(shell)/home/_components/home/section.tsx'
  try {
    put(
      'platform/design-system/catalog/variants.json',
      JSON.stringify({ Button: { variant: { primary: ['C0092'], quiet: [] } } })
    )
    put(
      button,
      `export function Button({variant}: {variant: 'primary' | 'quiet'}) { return <button data-variant={variant}/> }`
    )
    put(
      section,
      `import { Button } from '@/${button.replace('.tsx', '')}'
      export default function Section() { return <Button variant='quiet'/> }`
    )
    const unmounted = run()
    expect(unmounted.status).toBe(1)
    expect(unmounted.output).toContain('[code-use] Button.variant=quiet')

    put(
      'platform/embedded/app/(shell)/home/_components/home/host.tsx',
      `import dynamic from 'next/dynamic'
      const TABLE = { one: dynamic(() => import('@/${section.replace('.tsx', '')}')) }
      export function Host({ name }: { name: 'one' }) { const Section = TABLE[name]; return <Section/> }`
    )
    put(
      'app/o/[organizationId]/section/page.tsx',
      `import { Host } from '@/platform/embedded/app/(shell)/home/_components/home/host'
      export default function Page() { return <Host name='one'/> }`
    )
    expect(run()).toEqual({ status: 0, output: expect.stringContaining('passed') })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
