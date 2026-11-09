import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { allowlistReasonFindings, staleAllowlistFindings } from './platform-allowlists'

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

/** Grants `lists` the way `scripts/platform-allowlists.ts` does in the audited tree. */
function writeAllowlists(root: string, lists: Record<string, Record<string, string>>) {
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  writeFileSync(
    path.join(root, 'scripts/platform-allowlists.ts'),
    `export const PLATFORM_ALLOWLISTS = ${JSON.stringify(lists)}\n`
  )
}

function audit() {
  const result = spawnSync('bun', [CHECK, ROOT], { encoding: 'utf8' })
  if (result.error) throw result.error
  return { status: result.status, output: result.stdout + result.stderr }
}

it('rejects design drift across real JSX, CSS and Paper ownership boundaries', () => {
  try {
    spawnSync('git', ['init', '-q'], { cwd: ROOT })
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
    write(
      '../../packages/emcn/package.json',
      JSON.stringify({
        name: '@sim/emcn',
        exports: {
          './button': './src/components/button/button.tsx',
          './button/button.module.css': './src/components/button/button.module.css',
          './modal': './src/components/modal/index.ts',
        },
      })
    )
    write(
      '../../packages/emcn-platform/package.json',
      JSON.stringify({
        name: '@sim/emcn-platform',
        exports: { './catalog/component-recipe': './src/catalog/component-recipe.tsx' },
      })
    )
    const style = '../../packages/emcn/src/styles'
    const catalog = '../../packages/emcn-platform/src/catalog'
    const component = '../../packages/emcn/src/components/button'
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
      `import styles from '@sim/emcn/button/button.module.css'
      interface ButtonProps { variant: 'primary' }
      export function Button({variant}: ButtonProps) {
        return <button data-variant={variant} className={styles.button}>Accept</button>
      }`
    )
    write(
      'app/(product)/page.tsx',
      `import { Button as Action } from '@sim/emcn/button'
      export default function Page() { return <Action variant="primary"/> }`
    )
    write(
      'app/(product)/settings/_components/panel/panel.tsx',
      `import classes from '@/app/(product)/settings/_components/panel/panel.module.css'
      export function Panel(){return <section className={classes.panel}/>}`
    )
    write('app/(product)/settings/_components/panel/panel.module.css', '.panel{padding:0}')
    const brand = '../../packages/emcn/src/components/brand'
    const brandProps = `import type { SVGProps } from 'react'
      interface WordmarkProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'style' | 'css' | 'sx'> {}`
    const wordmark = `${brandProps}
      export function Wordmark(props: WordmarkProps) { return <svg aria-hidden="true" {...props}><path d="M0 0h8" /></svg> }`
    write(`${brand}/wordmark.tsx`, wordmark)
    write(
      `${brand}/provider-icon.tsx`,
      `import type { SVGProps } from 'react'
      interface ProviderIconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'style' | 'css' | 'sx'> {}
      export function GoogleIcon(props: ProviderIconProps) { return <svg aria-hidden="true" {...props}><path fill="#4285F4" d="M0 0h8" /></svg> }`
    )
    const modal = '../../packages/emcn/src/components/modal'
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
    const dialogImports = `import * as Dialogs from '@sim/emcn/modal';
      import { OverlayDialog as Surface, ModalFooter as Actions } from '@sim/emcn/modal';
      import { Button as Action } from '@sim/emcn/button';`
    write(
      'app/(product)/settings/_components/inspector.tsx',
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

    const authProbe = '../../packages/emcn-auth/src/components/probe/probe.ts'
    write(authProbe, `import '@sim/emcn-legacy/icons'`)
    expect(audit()).toEqual({
      status: 1,
      output: expect.stringContaining(`${authProbe} [legacy-import]`),
    })
    write(authProbe, `import '@sim/emcn-platform/catalog/component-recipe'`)
    expect(audit()).toEqual({
      status: 1,
      output: expect.stringContaining(`${authProbe} [design-dependency]`),
    })
    rmSync(path.join(APP, authProbe))

    const looseRecipe = 'app/(product)/settings/_components/loose.module.css'
    write(looseRecipe, '.loose{padding:0}')
    expect(audit()).toEqual({
      status: 1,
      output: expect.stringContaining(`${looseRecipe} [component-folder]`),
    })
    rmSync(path.join(APP, looseRecipe))

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
      `import { Button } from '@sim/emcn/button'
      export const Specimen = () => <Button variant="ghost"/>`
    )
    const productPage = `import { Button as Action } from '@sim/emcn/button'
      function Unused(){return <Action variant="ghost"/>}
      function Nested({choice}:{choice:'primary'|'ghost'}) {return <Action variant={choice}/>}
      export default function Page(){return <Nested choice="primary"/>}`
    write(
      'app/(product)/page.tsx',
      productPage.replace(
        'function Page(){return',
        'function Page(){function discarded(){return <Nested choice="ghost"/>} (discarded()); return'
      )
    )
    for (const file of ['_draft/error', 'orphan/error', '@unused/default']) {
      write(`app/(product)/${file}.tsx`, productPage.replace('choice="primary"', 'choice="ghost"'))
    }
    expect(audit()).toEqual({
      status: 1,
      output: expect.stringContaining('[code-use] Button.variant=ghost'),
    })

    const boundaries = {
      'app/(product)/template.tsx': 'template',
      'app/(product)/account/error.tsx': 'error',
      'app/(product)/account/loading.tsx': 'loading',
      'app/(product)/account/not-found.tsx': 'not-found',
      'app/(product)/global-error.tsx': 'global-error',
    }
    write('app/(product)/account/details/page.tsx', 'export default function Page(){return null}')
    const choices = ['primary', 'ghost', 'shadow', 'defaulted', ...Object.values(boundaries)]
    writeCatalog('variants', {
      Button: { variant: Object.fromEntries(choices.map((choice) => [choice, ['C0092']])) },
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
        `import {Button} from '@sim/emcn/button';
         export default function State(){return <Button variant="${variant}"/>}`
      )
    }
    write(
      'app/(product)/page.tsx',
      `import {Button} from '@sim/emcn/button';
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
    write('app/(product)/page.tsx', `const DISABLED = false; ${deadPage}`)
    expect(audit()).toEqual({
      status: 1,
      output: expect.stringContaining('[code-use] Button.variant=ghost'),
    })

    write(
      'app/(product)/page.tsx',
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
        `app/(product)/${file}.tsx`,
        `const kind: string = "stylesheet"; export const Escape = () => ${tag}`
      )
    }
    const injected = audit()
    expect(injected.status).toBe(1)
    for (const file of ['inline', 'stylesheet', 'dynamic']) {
      expect(injected.output).toContain(`app/(product)/${file}.tsx:1 [consumer-style]`)
    }

    write('app/(product)/chats/ages.ts', "export const updated = '17hrs ago'")
    write('app/(product)/chats/axis.ts', 'export const day = new Intl.DateTimeFormat("en-US")')
    write(
      'app/(product)/chats/stamp.ts',
      'export const stamp = (date: Date) => date.toLocaleString()'
    )
    write('app/(product)/chats/total.ts', 'export const total = (n: number) => n.toLocaleString()')
    write('app/(product)/settings/_components/index.ts', `export { Panel } from './panel'`)
    write(
      'app/(product)/settings/_components/section.tsx',
      'export function Section() { return null }'
    )
    write(
      'app/(product)/chats/other.ts',
      `export { Panel } from '@/app/(product)/settings/_components'`
    )
    write(
      'app/(product)/settings/_components/profile/profile.ts',
      `import '@/app/(product)/settings/_components/panel.module.css'`
    )
    write(
      '../../packages/emcn/src/components/menu/chrome.ts',
      `import '../button/button.module.css'`
    )
    write(
      'app/(product)/chats/private.ts',
      `export { Section } from '@/app/(product)/settings/_components/section'`
    )
    write('../../packages/emcn/src/features/leak/example.ts', 'export const example = true')
    write('../../packages/emcn/src/components/flat.ts', 'export const flat = true')
    write(
      'app/(product)/settings/_components/banner.tsx',
      'export const Banner = () => <p>Email delivery is disabled in this preview.</p>'
    )
    const feature = 'app/(product)/settings/_components'
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
      `import styles from '@sim/emcn/button/button.module.css'; export const Trigger = () => <button className={styles.button}/>`
    )
    write(
      `${feature}/actions.module.css`,
      '.action { composes: button from "@sim/emcn/button/button.module.css"; }'
    )
    write(`${component}/private.ts`, `import '@/platform/preview/chrome'`)
    write(`${component}/legacy.ts`, `import '@sim/emcn-legacy/icons'`)
    write(`${component}/surface.ts`, `import '@sim/emcn-platform/catalog/component-recipe'`)

    write('app/legacy.ts', `export { Section } from '@/app/(product)/settings/_components/section'`)
    write(
      'app/(product)/escape.tsx',
      `import { Button } from '@sim/emcn/button'
      import '@/app/(product)/bypass.css'
      export const escape = (props: object) => <Button className="red" style={{opacity: 0.2}} {...props}/>
      export const paperSpecimen = () => import('@sim/emcn-platform/catalog/component-recipe')
      export const localTimer = () => window.setTimeout(() => {}, 2000)
      export const legacy = () => import('@/components/old')
      export const data = () => import('@/platform/fixtures/data')`
    )
    writeAllowlists(ROOT, { seamHelpers: { 'lib/auth/client': 'The browser auth client' } })
    write(
      'platform/lib/data/allowed.ts',
      `import type { Principal } from '@/lib/api/contracts/primitives'
      import { useOrganizations } from '@/hooks/queries/organization'
      import { client } from '@/lib/auth/client'
      import { createLogger } from '@sim/logger'
      import type { ShellData } from '@/app/(product)/shell/_components/model'
      export const allowed: unknown[] = [useOrganizations, client, createLogger]
      export type { Principal, ShellData }`
    )
    write(
      'platform/lib/data/forbidden.ts',
      `import '@/app/o/layout'
      import '@/components/settings/navigation'
      import '@/lib/auth/server-only-module'
      import '@sim/emcn-legacy'
      import '@/app/(product)/shell/_components/value'`
    )
    write(
      'app/(product)/chats/bypasses-seam.ts',
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
    write('app/(product)/bypass.css', '.button { color: blue }')
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
      `import { Button } from '@sim/emcn/button'
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
    write(
      `${brand}/wordmark.tsx`,
      `${wordmark}
      export function UnregisteredGlyph(props: WordmarkProps) { return <svg {...props}/> }
      export function Wrapper(props: WordmarkProps) { return <div {...props}/> }
      interface UnsafeProps { style?: { color: string } }`
    )
    const result = audit()
    expect(result.status).toBe(1)
    for (const [file] of handBuiltDialogs) {
      expect(result.output).toContain(`${feature}/${file}.tsx:4 [dialog-owner]`)
    }
    expect(result.output).toContain(`${feature}/unnamed.tsx:4 [dialog-name]`)
    expect(result.output).toContain(`${feature}/trigger.tsx [private-recipe]`)
    expect(result.output).toContain(`${feature}/actions.module.css [private-recipe]`)
    expect(result.output).toContain(`${component}/legacy.ts [legacy-import]`)
    expect(result.output).toContain(`${component}/surface.ts [design-dependency]`)
    expect(result.output).toContain('app/(product)/chats/other.ts [private-composition]')
    expect(result.output).toContain(
      'app/(product)/settings/_components/profile/profile.ts [private-recipe]'
    )
    expect(result.output).toContain(
      '../../packages/emcn/src/components/menu/chrome.ts [private-recipe]'
    )
    expect(result.output).toContain('app/(product)/chats/ages.ts:1 [time-format]')
    expect(result.output).toContain('app/(product)/chats/axis.ts:1 [time-format]')
    expect(result.output).toContain('app/(product)/chats/stamp.ts:1 [time-format]')
    expect(result.output).not.toContain('app/(product)/chats/total.ts:1 [time-format]')
    expect(result.output).toContain(`${feature}/icon.tsx:1 [icon-owner]`)
    expect(result.output).toContain(`${feature}/ink.module.css:1 [icon-owner]`)
    expect(result.output).toContain(`${brand}/wordmark.tsx:4 [icon-owner]`)
    expect(result.output).toContain(`${brand}/wordmark.tsx:4 [prop-spread]`)
    expect(result.output).toContain(`${brand}/wordmark.tsx:5 [prop-spread]`)
    expect(result.output).toContain(`${brand}/wordmark.tsx [style-api] style`)
    expect(result.output).not.toContain('platform/lib/data/allowed.ts [')
    for (const specifier of [
      '@/app/o/layout',
      '@/components/settings/navigation',
      '@/lib/auth/server-only-module',
      '@sim/emcn-legacy',
    ])
      expect(result.output).toContain(`platform/lib/data/forbidden.ts [legacy-import] ${specifier}`)
    expect(result.output).toContain('platform/lib/data/forbidden.ts [private-composition]')
    for (const specifier of [
      '@/hooks/queries/mothership-chats',
      '@/lib/api/client/request',
      '@sim/logger',
    ])
      expect(result.output).toContain(
        `app/(product)/chats/bypasses-seam.ts [legacy-import] ${specifier}`
      )
    for (const issue of [
      'legacy-import',
      'consumer-style',
      'prop-spread',
      'style-api',
      'fixture-boundary',
      'css-owner',
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

/** The smallest app the check passes on: one product page and its design system. */
function productFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-platform-product-'))
  spawnSync('git', ['init', '-q'], { cwd: root })
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
  put(
    '../../packages/emcn/package.json',
    JSON.stringify({
      name: '@sim/emcn',
      exports: {
        './button': './src/components/button/button.tsx',
        './button/button.module.css': './src/components/button/button.module.css',
        './catalog/icon-geometry': './src/catalog/icon-geometry.ts',
      },
    })
  )
  put('../../packages/emcn-platform/package.json', JSON.stringify({ name: '@sim/emcn-platform' }))
  const catalog = '../../packages/emcn-platform/src/catalog'
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
  put('../../packages/emcn/src/styles/tokens.css', '[data-platform-ui] { --color-ink: #141414; }')
  put(
    '../../packages/emcn/src/components/button/button.module.css',
    '.button { color: var(--color-ink); }'
  )
  put(
    '../../packages/emcn/src/components/button/button.tsx',
    `export function Button({variant}: {variant: 'primary'}) { return <button data-variant={variant}/> }`
  )
  put(
    'app/(product)/o/[organizationId]/home/page.tsx',
    `import { Button } from '@sim/emcn/button'
    export default function Page() { return <Button variant='primary'/> }`
  )
  const run = () => {
    const result = spawnSync('bun', [CHECK, root], { encoding: 'utf8' })
    if (result.error) throw result.error
    return { status: result.status, output: result.stdout + result.stderr }
  }
  return { root, put, run }
}

it.each([
  ['shared-import', 'platform/shared/reach.ts', `import '@/platform/lib/navigation'`],
  ['shared-import', 'platform/shared/reach2.ts', `import type {} from '@/platform/lib/data/home'`],
  ['legacy-import', 'app/(product)/workspace/reach.tsx', `import '@/lib/core/utils/cn'`],
  ['legacy-import', 'app/(product)/_components/reach.ts', `import '@sim/logger'`],
  ['legacy-import', 'app/(site)/reach.tsx', `import '@/platform/lib/data/home'`],
  [
    'private-composition',
    'app/(product)/o/[organizationId]/search/_components/reach.ts',
    `import '@/app/(product)/o/[organizationId]/home/_components/panel/panel'`,
  ],
  [
    'private-recipe',
    'app/(product)/o/[organizationId]/home/recipe.ts',
    `import '@sim/emcn/button/button.module.css'`,
  ],
  ['family-import', 'app/(product)/o/[organizationId]/home/family.ts', `import '@sim/emcn'`],
  [
    'legacy-import',
    'app/(site)/reach.module.css',
    `.reach { composes: frame from '@/platform/styles/frame.module.css'; }`,
  ],
  ['legacy-import', 'platform/checks/seed.ts', `import '@sim/testing/mocks/auth.mock'`],
  ['legacy-import', 'platform/checks/live/seed.ts', `import '@sim/db/testing/fixtures'`],
  ['legacy-import', 'scripts/e2e.ts', `import '@/platform/checks/fields'`],
])(
  'fails [%s] for %s',
  (rule, file, source) => {
    const { root, put, run } = productFixture()
    try {
      put('app/(product)/o/[organizationId]/home/_components/panel/panel.tsx', 'export {}\n')
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

it('lets the product root layout load the site bootstrap, and a shared model name an EMCN type', () => {
  const { root, put, run } = productFixture()
  try {
    put('app/(product)/layout.tsx', `import '@/app/_shell/providers/telemetry'\nexport {}\n`)
    put('../../packages/emcn/src/catalog/icon-geometry.ts', `export type IconName = 'I001'\n`)
    put(
      'platform/shared/model.ts',
      `import type { IconName } from '@sim/emcn/catalog/icon-geometry'\nexport type Row = IconName\n`
    )
    expect(run()).toEqual({ status: 0, output: expect.stringContaining('passed') })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('counts a variant a product page mounts through a dynamic section table', () => {
  const { root, put, run } = productFixture()
  const button = '../../packages/emcn/src/components/button/button.tsx'
  const home = 'app/(product)/o/[organizationId]/home'
  const section = `${home}/_components/home/section.tsx`
  try {
    put(
      '../../packages/emcn-platform/src/catalog/variants.json',
      JSON.stringify({ Button: { variant: { primary: ['C0092'], quiet: ['C0092'] } } })
    )
    put(
      button,
      `export function Button({variant}: {variant: 'primary' | 'quiet'}) { return <button data-variant={variant}/> }`
    )
    put(
      section,
      `import { Button } from '@sim/emcn/button'
      export default function Section() { return <Button variant='quiet'/> }`
    )
    const unmounted = run()
    expect(unmounted.status).toBe(1)
    expect(unmounted.output).toContain('[code-use] Button.variant=quiet')

    put(
      `${home}/_components/home/host.tsx`,
      `import dynamic from 'next/dynamic'
      const TABLE = { one: dynamic(() => import('@/${section.replace('.tsx', '')}')) }
      export function Host({ name }: { name: 'one' }) { const Section = TABLE[name]; return <Section/> }`
    )
    put(
      `${home}/page.tsx`,
      `import { Button } from '@sim/emcn/button'
      import { Host } from '@/${home}/_components/home/host'
      export default function Page() { return <><Button variant='primary'/><Host name='one'/></> }`
    )
    expect(run()).toEqual({ status: 0, output: expect.stringContaining('passed') })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it("passes an action's pending label, a value token, and copy nothing renders", () => {
  const { root, put, run } = productFixture()
  try {
    put(
      'app/(product)/o/[organizationId]/home/_components/panel/panel.tsx',
      `function Confirm(_: { pendingLabel: string }) { return null }
      function ActionButton(_: { children: string }) { return null }
      function Dialog(_: { confirmLabel: string; kind?: string }) { return null }
      const idle = 'Loading' === 'x' ? 'Create' : 'Invite'
      export function Panel({ busy, all }: { busy: boolean; all: boolean }) {
        return <>
          <Confirm pendingLabel='Loading…' />
          <button>{busy ? 'Loading…' : 'Load more'}</button>
          <button>{busy ? (all ? 'Loading all…' : 'Loading options…') : 'Load all'}</button>
          <ActionButton>{busy ? 'Saving…' : 'Allow'}</ActionButton>
          <Dialog confirmLabel={busy ? 'Sending…' : 'Invite'} />
          <Dialog confirmLabel={idle} kind='loading' />
        </>
      }
`
    )
    expect(run()).toEqual({ status: 0, output: expect.stringContaining('passed') })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('fails a variant with no Paper key that CODE_FIRST_VARIANTS gives no reason for', () => {
  const { root, put, run } = productFixture()
  try {
    put(
      '../../packages/emcn-platform/src/catalog/variants.json',
      JSON.stringify({ Button: { variant: { primary: ['C0092'], bar: [] } } })
    )
    put(
      '../../packages/emcn/src/components/button/button.tsx',
      `export function Button({variant}: {variant: 'primary' | 'bar'}) { return <button data-variant={variant}/> }`
    )
    put(
      'app/(product)/o/[organizationId]/home/page.tsx',
      `import { Button } from '@sim/emcn/button'
      export default function Page() { return <><Button variant='primary'/><Button variant='bar'/></> }`
    )
    const result = run()
    expect(result.status).toBe(1)
    expect(result.output).toContain('[variant-evidence] Button.variant=bar')
    expect(result.output).not.toContain('[variant-evidence] Button.variant=primary')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('fails an allowlist entry without a one-line reason', () => {
  expect(
    allowlistReasonFindings({
      platformHostModules: {
        'lib/toast/sink': 'The one toast sink each root connects its own toaster to',
        'lib/navigation/paths': '',
        'lib/navigation/settings-aliases': '  ',
        'components/file-viewer/types': 'The file viewer types\nand more',
      },
    })
  ).toEqual([
    'platformHostModules grants lib/navigation/paths without a reason',
    'platformHostModules grants lib/navigation/settings-aliases without a reason',
    'platformHostModules gives components/file-viewer/types a reason longer than one line',
  ])
})

it.each([
  [
    'app/(product)/o/[organizationId]/home/_components/panel/accounts.tsx',
    `export function Accounts({ pending }: { pending: boolean }) { return <p>{pending ? 'Loading accounts…' : 'Accounts'}</p> }`,
  ],
  [
    'app/(product)/o/[organizationId]/home/_components/panel/rows.tsx',
    `export function Rows() { return <p role='status'>Loading...</p> }`,
  ],
  [
    'app/(product)/o/[organizationId]/home/_components/panel/more.tsx',
    `export function More({ busy }: { busy: boolean }) { return <button>{busy ? 'Loading' : 'Load more'}</button> }`,
  ],
  [
    'platform/lib/data/gate.ts',
    `export const gate = (pending: boolean) => (pending ? 'Loading Generic Secrets' : null)`,
  ],
  [
    'app/(product)/o/[organizationId]/home/_components/panel/wait.tsx',
    `export function Wait() { return <p>please wait</p> }`,
  ],
  [
    'app/(product)/o/[organizationId]/home/_components/panel/fetch.tsx',
    `export function Fetch({ busy }: { busy: boolean }) { return <p>{busy ? 'Fetching rows…' : 'Rows'}</p> }`,
  ],
  [
    'app/(product)/o/[organizationId]/home/_components/panel/notice.tsx',
    `function Notice(_: { message: string }) { return null }; export const Read = () => <Notice message='Reading…' />`,
  ],
  [
    'app/(product)/o/[organizationId]/home/_components/panel/status.ts',
    `export function status(ready: boolean) { if (!ready) return 'Checking availability'; return 'Ready' }`,
  ],
  [
    'app/(product)/o/[organizationId]/home/_components/panel/save.tsx',
    `export function Save({ busy }: { busy: boolean }) { return <p>{busy && 'SAVING CHANGES…'}</p> }`,
  ],
])(
  'fails [loading-copy] for %s',
  (file, source) => {
    const { root, put, run } = productFixture()
    try {
      put(file, `${source}\n`)
      const result = run()
      expect(result.status).toBe(1)
      expect(result.output).toContain(`${file}:1 [loading-copy]`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  30_000
)

it('passes the live checks their test database guard, and a script the shared hydration helper', () => {
  const { root, put, run } = productFixture()
  try {
    put('platform/checks/live/seed.ts', `import '@sim/db/testing/test-infrastructure'\nexport {}\n`)
    put('platform/checks/test.ts', 'export const waitUntilHydrated = () => {}\n')
    put('scripts/e2e.ts', `import '@/platform/checks/test'\nexport {}\n`)
    expect(run()).toEqual({ status: 0, output: expect.stringContaining('passed') })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('fails [seam-closure] for legacy views and registries reached from the seam, shared, or a host module', () => {
  const { root, put, run } = productFixture()
  try {
    writeAllowlists(root, {
      seamHelpers: { 'lib/hook': 'A hook the seam runs', 'lib/rows': 'A model shared reads' },
      platformHostModules: { 'components/host/host': 'A host module views import' },
    })
    put('platform/lib/data/chat.ts', `import '@/lib/hook'\nexport {}\n`)
    put('lib/hook.ts', `import '@/components/legacy/view'\nimport '@/blocks/registry'\nexport {}\n`)
    put('components/legacy/view.tsx', 'export const View = () => null\n')
    put('blocks/registry.ts', 'export {}\n')
    put('platform/shared/rows.ts', `import '@/lib/rows'\nexport {}\n`)
    put('lib/rows.ts', `import '@/components/legacy/rows-view'\nexport {}\n`)
    put('components/legacy/rows-view.tsx', 'export const RowsView = () => null\n')
    put(
      'app/(product)/o/[organizationId]/home/host-user.ts',
      `import '@/components/host/host'\nexport {}\n`
    )
    put(
      'components/host/host.tsx',
      `import '@/components/host/part'\nimport '@/components/legacy/host-view'\nexport {}\n`
    )
    put('components/host/part.tsx', 'export const Part = () => null\n')
    put('components/legacy/host-view.tsx', 'export const HostView = () => null\n')
    const result = run()
    expect(result.status).toBe(1)
    for (const file of [
      'components/legacy/view.tsx',
      'blocks/registry.ts',
      'components/legacy/rows-view.tsx',
      'components/legacy/host-view.tsx',
    ])
      expect(result.output).toContain(`${file} [seam-closure]`)
    expect(result.output).not.toContain('components/host/part.tsx [seam-closure]')
    expect(result.output).not.toContain('[stale-allowlist]')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('fails [stale-allowlist] for each entry no check needed', () => {
  const { root, put, run } = productFixture()
  try {
    writeAllowlists(root, {
      seamHelpers: { 'lib/used': 'Imported by the seam', 'lib/unused': 'Imported by nothing' },
      LOADING_COPY_OWNERS: { 'platform/lib/data/quiet.ts': 'Has no loading copy' },
      CODE_FIRST_VARIANTS: { 'Button.variant=primary': 'Has a Paper key' },
    })
    put('platform/lib/data/quiet.ts', `import '@/lib/used'\nexport const label = 'Ready'\n`)
    put('lib/used.ts', 'export {}\n')
    const result = run()
    expect(result.status).toBe(1)
    expect(result.output).not.toContain('names lib/used,')
    for (const entry of [
      'seamHelpers names lib/unused',
      'LOADING_COPY_OWNERS names platform/lib/data/quiet.ts',
      'CODE_FIRST_VARIANTS names Button.variant=primary',
    ])
      expect(result.output).toContain(`[stale-allowlist] ${entry}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('names the allowlist entries no check consulted', () => {
  expect(
    staleAllowlistFindings(
      { seamHelpers: { 'lib/a': 'used', 'lib/b': 'unused' }, LOCAL_TOKEN_OWNERS: { 'x.css': 'r' } },
      new Map([['seamHelpers', new Set(['lib/a'])]])
    )
  ).toEqual([
    'seamHelpers names lib/b, which no check needed; delete the entry',
    'LOCAL_TOKEN_OWNERS names x.css, which no check needed; delete the entry',
  ])
})
