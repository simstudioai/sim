import { expect, test } from 'vitest'
import type { ControlSource } from '#control-analysis/model'
import { inspectSimplifications } from '#control-analysis/simplifications'

const mergeSource =
  "import { type ClassValue, clsx } from 'clsx'\nimport { extendTailwindMerge } from 'tailwind-merge'\n\n/**\n * v3 of tailwind-merge, matching the app's Tailwind v4 utility surface. v2\n * encodes Tailwind v3's smaller set and would stop resolving conflicts for\n * anything v4 added or renamed.\n *\n * The `font-size` extension teaches the merger that Sim's own type scale keys\n * are font sizes, not colours \u2014 without it `text-small` and `text-sm` do not\n * conflict, so a component that sets one while a consumer passes the other\n * emits both and CSS source order decides instead of the caller.\n */\nconst twMerge = extendTailwindMerge({\n  extend: {\n    classGroups: {\n      'font-size': [{ text: ['micro', 'caption', 'small', 'md'] }],\n    },\n  },\n})\n\n/** Combines class names and resolves Tailwind conflicts, last argument winning. */\nexport function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs))\n}\n"
const buttonSource =
  "import { type ButtonHTMLAttributes, forwardRef } from 'react'\nimport { cva, type VariantProps } from 'class-variance-authority'\nimport { cn } from '../../lib/cn'\n\n/**\n * `size='icon'` is the square 20px icon-only button \u2014 a chip field's trailing\n * affordance, a toast dismiss, a section-header action. It drops the text padding\n * the `sm`/`md` sizes carry and tightens the radius to `rounded-sm` (4px), which\n * reads correctly at this size where the base 5px does not. The box is deliberately\n * larger than every glyph it holds; that margin IS the button's padding, since the\n * glyph is sized at the call site rather than here.\n *\n * Glyphs also draw one step thinner than the 1.55 the icon set ships, so a lone\n * icon reads as a secondary affordance rather than a piece of UI text. CSS wins\n * over the SVG's own `stroke-width` attribute, so this reaches every stroked icon\n * without touching the icon components \u2014 including the few that ship at 2.\n *\n * Compose it with `quiet` (the usual choice) or `ghost` (where the surrounding\n * surface owns the hover) \u2014 those pairings also pick up the muted icon color.\n *\n * @example <Button variant='quiet' size='icon' aria-label='Dismiss'><X className='size-[16px]' /></Button>\n */\nconst buttonVariants = cva(\n  'inline-flex items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-70 outline-hidden focus:outline-hidden focus-visible:outline-hidden rounded-[5px]',\n  {\n    variants: {\n      variant: {\n        default:\n          'text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)] bg-[var(--surface-4)] hover-hover:bg-[var(--surface-6)] border border-[var(--border)] hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]',\n        active:\n          'bg-[var(--surface-5)] hover-hover:bg-[var(--surface-6)] text-[var(--text-primary)] hover-hover:text-[var(--text-primary)] border border-[var(--border-1)] hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--border-1)]',\n        '3d': 'text-[var(--text-tertiary)] border-t border-l border-r border-[var(--border-1)] shadow-[0_2px_0_0_var(--border-1)] hover-hover:shadow-[0_4px_0_0_var(--border-1)] transition-[transform,box-shadow,color] hover-hover:-translate-y-0.5 hover-hover:text-[var(--text-primary)]',\n        outline:\n          'text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)] border border-[var(--text-muted)] bg-transparent hover-hover:border-[var(--text-secondary)]',\n        primary:\n          'bg-[var(--text-primary)] text-[var(--text-inverse)] hover-hover:text-[var(--text-inverse)] hover-hover:bg-[var(--text-body)] dark:bg-white dark:text-[var(--bg)] dark:hover-hover:bg-[var(--text-secondary)] dark:hover-hover:text-[var(--bg)]',\n        destructive:\n          'bg-[var(--text-error)] text-white hover-hover:text-white hover-hover:brightness-106',\n        secondary: 'bg-[var(--brand-secondary)] text-[var(--text-primary)]',\n        tertiary:\n          'bg-[var(--brand-accent)] text-[var(--text-inverse)] hover-hover:text-[var(--text-inverse)] hover-hover:bg-[var(--brand-accent-hover)] dark:bg-[var(--brand-accent)] dark:hover-hover:bg-[var(--brand-accent-hover)] dark:text-[var(--text-inverse)] dark:hover-hover:text-[var(--text-inverse)]',\n        ghost: 'text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)]',\n        subtle:\n          'text-[var(--text-body)] hover-hover:text-[var(--text-body)] hover-hover:bg-[var(--surface-4)]',\n        'ghost-secondary': 'text-[var(--text-muted)] hover-hover:text-[var(--text-primary)]',\n        quiet: 'text-[var(--text-secondary)] hover-hover:bg-[var(--surface-active)]',\n      },\n      size: {\n        sm: 'px-1.5 py-1 text-[length:11px]',\n        md: 'px-2 py-1.5 text-[length:12px]',\n        icon: 'size-[20px] rounded-sm p-0 [&_svg]:[stroke-width:1.25]',\n      },\n    },\n    compoundVariants: [\n      /**\n       * A lone glyph is icon content, not text, so the neutral icon buttons paint\n       * with `--text-icon-muted` rather than the variant's text color. Scoped to\n       * the neutral variants: the filled ones (`primary`, `destructive`, \u2026) carry\n       * inverse text that must keep winning over their own surface.\n       */\n      { size: 'icon', variant: 'quiet', className: 'text-[var(--text-icon-muted)]' },\n      { size: 'icon', variant: 'ghost', className: 'text-[var(--text-icon-muted)]' },\n    ],\n    defaultVariants: {\n      variant: 'default',\n      size: 'md',\n    },\n  }\n)\n\nexport interface ButtonProps\n  extends ButtonHTMLAttributes<HTMLButtonElement>,\n    VariantProps<typeof buttonVariants> {}\n\nconst Button = forwardRef<HTMLButtonElement, ButtonProps>(\n  ({ className, variant, size, ...props }, ref) => {\n    return (\n      <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />\n    )\n  }\n)\n\nButton.displayName = 'Button'\n\nexport { Button, buttonVariants }\n"
const consumer = 'apps/sim/components/example.tsx'
const icon = `<svg viewBox='0 0 24 24' aria-hidden='true'><rect x='4' y='4' width='16' height='16' rx='3' ry='3'/></svg>`
function source(ui: string, extra: Record<string, string> = {}): ControlSource {
  const files: Record<string, string> = {
    'packages/emcn/src/index.ts': `export { Button } from './components/button/button'; export { X } from './icons/x'`,
    'packages/emcn/src/components/button/button.tsx': buttonSource,
    'packages/emcn/src/lib/cn.ts': mergeSource,
    'packages/emcn/src/icons/x.tsx': `export function X(){ return ${icon} }`,
    [consumer]: ui,
    ...extra,
  }
  return {
    entries: Object.entries(files).map(([path, text]) => ({
      path,
      mode: '100644',
      kind: 'blob',
      blob: 'a'.repeat(40),
      bytes: Buffer.byteLength(text),
    })),
    read: (entry) => files[entry.path],
  }
}
const ui = (body: string) =>
  `import { Button, X } from '@sim/emcn'; export function View(){return (${body})}`
const run = (body: string, extra: Record<string, string> = {}) =>
  inspectSimplifications(source(ui(body), extra)).simplifications
const matching = (result: ReturnType<typeof run>, rule: string) =>
  result.findings.filter((f) => f.rule === rule)

test('exact default padding/radius repeats have source-backed removal proofs', () => {
  const result = run(`<Button className='px-2 py-1.5 rounded-[5px]'>Save</Button>`)
  expect(matching(result, 'control-redundant-style').map((f) => f.value)).toEqual([
    'px-2',
    'py-1.5',
    'rounded-[5px]',
  ])
  expect(matching(result, 'control-accessible-name')).toHaveLength(0)
  expect(result.findings.every((f) => f.proof.recipe)).toBe(true)
})

test('intervening conflicts, important flags and responsive scopes are not mistaken for repeats', () => {
  for (const classes of ['p-4 px-2', 'px-2!', 'hover:px-2', 'sm:px-2']) {
    expect(
      matching(run(`<Button className='${classes}'>Save</Button>`), 'control-redundant-style')
    ).toHaveLength(0)
  }
})

test('all finite size/default alternatives must preserve classes', () => {
  expect(
    matching(
      run(`<Button size={enabled ? 'md' : 'sm'} className='px-2'>Save</Button>`),
      'control-redundant-style'
    )
  ).toHaveLength(0)
  expect(
    matching(
      run(`<Button size={enabled ? 'md' : undefined} className='px-2'>Save</Button>`),
      'control-redundant-style'
    )
  ).toHaveLength(1)
  expect(
    matching(run(`<Button size={null} className='px-2'>Save</Button>`), 'control-redundant-style')
  ).toHaveLength(0)
})

test('ordered immutable imported spreads and aliases resolve, later unknown spreads do not', () => {
  const module = {
    'apps/sim/components/shared.ts': `export const props = {className:'px-2',size:'md'} as const`,
  }
  const prefix = `import {Button as Action} from '@sim/emcn'; import {props} from './shared';`
  const known = inspectSimplifications(
    source(`${prefix} export const View=()=> <Action {...props} aria-label='Save'/>`, module)
  ).simplifications
  expect(matching(known, 'control-redundant-style')).toHaveLength(1)
  const uncertain = inspectSimplifications(
    source(`${prefix} export const View=({runtime})=> <Action {...props} {...runtime}/>`, module)
  ).simplifications
  expect(matching(uncertain, 'control-redundant-style')).toHaveLength(0)
  expect(uncertain.unchecked.some((n) => n.reason.includes('unresolved'))).toBe(true)
})

test('namespace aliases work and shadowed central names do not acquire recipe authority', () => {
  const namespaced = inspectSimplifications(
    source(
      `import * as E from '@sim/emcn'; export const View=()=> <E.Button className='px-2'>Save</E.Button>`
    )
  ).simplifications
  expect(matching(namespaced, 'control-redundant-style')).toHaveLength(1)
  const shadowed = inspectSimplifications(
    source(
      `import {Button} from '@sim/emcn'; export function View(){ const Button=({children})=><div>{children}</div>; return <Button className='px-2'>Save</Button> }`
    )
  ).simplifications
  expect(matching(shadowed, 'control-redundant-style')).toHaveLength(0)
})

test('unsupported cn implementation or runtime class factory produces uncertainty, never a removal', () => {
  expect(
    matching(
      run(`<Button className='px-2'>Save</Button>`, {
        'packages/emcn/src/lib/cn.ts': `export const cn=(...args)=>args.join(' ')`,
      }),
      'control-redundant-style'
    )
  ).toHaveLength(0)
  expect(
    matching(run(`<Button className={getClasses()}>Save</Button>`), 'control-redundant-style')
  ).toHaveLength(0)
})

test('icon-only buttons need names; a tooltip description is not one', () => {
  expect(
    matching(run(`<Button aria-describedby='tooltip'><X/></Button>`), 'control-accessible-name')
  ).toHaveLength(1)
  expect(
    matching(
      run(`<button><svg aria-hidden='true'><path d='M0 0'/></svg></button>`),
      'control-accessible-name'
    )
  ).toHaveLength(1)
})

test('text, screen-reader text, labels, titles and resolvable labelledby name buttons', () => {
  for (const body of [
    `<Button>Save</Button>`,
    `<Button><span className='sr-only'>Save</span><X/></Button>`,
    `<Button aria-label='Save'><X/></Button>`,
    `<Button title='Save'><X/></Button>`,
    `<div><span id='label'>Save</span><Button aria-labelledby='label'><X/></Button></div>`,
  ])
    expect(matching(run(body), 'control-accessible-name')).toHaveLength(0)
})

test('dynamic name/content/spreads and missing label references stay unresolved', () => {
  for (const body of [
    `<Button aria-label={label}><X/></Button>`,
    `<Button>{children}</Button>`,
    `<Button {...runtime}><X/></Button>`,
    `<Button aria-labelledby='missing'><X/></Button>`,
  ]) {
    const result = run(body)
    expect(matching(result, 'control-accessible-name')).toHaveLength(0)
    expect(result.unchecked.some((n) => n.reason.includes('Accessible name unresolved'))).toBe(true)
  }
})

test('generic icon parameters are followed through statically known wrapper callers', () => {
  const result = inspectSimplifications(
    source(
      `import {Button,X} from '@sim/emcn'; function Action({icon:Icon,label}) {return <Button><Icon/></Button>} export const View=()=> <Action icon={X} label='Delete'/>`
    )
  ).simplifications
  expect(matching(result, 'control-accessible-name')).toHaveLength(1)
  expect(matching(result, 'control-accessible-name')[0].context).toBe('Action')
})

test('drawing equality ignores formatting and caller size but retains geometry and paint', () => {
  const result = run(
    `<Button aria-label='Stop'><svg className='size-[14px] fill-current' viewBox='0 0 24 24'><rect ry='3' rx='3' height='16' width='16' y='4' x='4'/></svg></Button>`
  )
  expect(matching(result, 'control-duplicate-artwork')).toHaveLength(1)
  expect(matching(result, 'control-duplicate-artwork')[0].proof.central).toEqual([
    'packages/emcn/src/icons/x.tsx#X',
  ])
  for (const rect of [
    `<rect x='3' y='3' width='18' height='18' rx='2'/>`,
    `<rect x='4' y='4' width='16' height='16' rx='3' ry='3' fill='red'/>`,
  ])
    expect(
      matching(
        run(`<Button aria-label='Stop'><svg viewBox='0 0 24 24'>${rect}</svg></Button>`),
        'control-duplicate-artwork'
      )
    ).toHaveLength(0)
})

test('dynamic SVG geometry remains explicit and excluded landing artwork stays excluded', () => {
  const result = run(
    `<Button aria-label='Stop'><svg viewBox='0 0 24 24'><rect x={x}/></svg></Button>`,
    { 'apps/sim/app/(landing)/page.tsx': `export const Page=()=>${icon}` }
  )
  expect(matching(result, 'control-duplicate-artwork')).toHaveLength(0)
  expect(result.unchecked.some((n) => n.reason.includes('SVG equivalence unresolved'))).toBe(true)
})

test('analysis never executes source and is independent of discovery order', () => {
  const input = source(
    `throw new Error('must not execute'); ${ui(`<Button className='px-2'><X/></Button>`)}`
  )
  const forward = inspectSimplifications(input, [], 'forward')
  const reverse = inspectSimplifications(
    { ...input, entries: [...input.entries].reverse() },
    [],
    'reverse'
  )
  expect(reverse).toEqual(forward)
})

test('forwarded SVG props preserve explicit caller overrides and default decorative status', () => {
  const extra = {
    'packages/emcn/src/icons/x.tsx': `export function X({className,...props}){return <svg aria-hidden='true' {...props}><path d='M0 0'/></svg>}`,
  }
  expect(matching(run(`<Button><X/></Button>`, extra), 'control-accessible-name')).toHaveLength(1)
  expect(
    matching(
      run(`<Button><X aria-hidden={false} aria-label='Save'/></Button>`, extra),
      'control-accessible-name'
    )
  ).toHaveLength(0)
})

test('a CSS-hidden programmatic trigger is not an unnamed visible button', () => {
  expect(
    matching(run(`<button className='hidden' onClick={remove}/>`), 'control-accessible-name')
  ).toHaveLength(0)
  expect(
    matching(
      run(`<button className='hidden sm:block' onClick={remove}/>`),
      'control-accessible-name'
    )
  ).toHaveLength(1)
})

test('statically resolved ARIA buttons require a name', () => {
  expect(matching(run('<div role="button"/>'), 'control-accessible-name')).toHaveLength(1)
  expect(
    matching(run('<div role="button" aria-label="Run"/>'), 'control-accessible-name')
  ).toHaveLength(0)
  expect(matching(run('<div role={role}/>'), 'control-accessible-name')).toHaveLength(0)
})
