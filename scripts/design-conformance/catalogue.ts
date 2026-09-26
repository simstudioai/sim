import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { compareStrings } from '@sim/utils/string'
import postcss from 'postcss'
import { extract } from '#design-conformance/extract'
import {
  CATALOGUE_VERSION,
  type Catalogue,
  canonical,
  category,
  family,
  hash,
  SEED,
  TOKEN_FILE,
} from '#design-conformance/model'
import {
  compiler,
  declarations,
  defaultTheme,
  normalizeValue,
  variablesIn,
} from '#design-conformance/normalize'

/** Explicit structural vocabulary supplements observed geometry; numeric scales come only from the seed. */
const keywords: Record<string, string[]> = {
  display: [
    'none',
    'block',
    'inline',
    'inline-block',
    'flex',
    'inline-flex',
    'grid',
    'inline-grid',
    'contents',
    'table',
    'table-row',
    'table-cell',
    'flow-root',
  ],
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  'flex-direction': ['row', 'column', 'row-reverse', 'column-reverse'],
  'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
  'align-items': [
    'normal',
    'stretch',
    'start',
    'end',
    'center',
    'baseline',
    'flex-start',
    'flex-end',
  ],
  'justify-content': [
    'normal',
    'start',
    'end',
    'center',
    'space-between',
    'space-around',
    'space-evenly',
    'flex-start',
    'flex-end',
  ],
  overflow: ['visible', 'hidden', 'clip', 'scroll', 'auto'],
  'overflow-x': ['visible', 'hidden', 'clip', 'scroll', 'auto'],
  'overflow-y': ['visible', 'hidden', 'clip', 'scroll', 'auto'],
  visibility: ['visible', 'hidden', 'collapse'],
  'white-space': ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'],
  'text-align': ['left', 'right', 'center', 'justify', 'start', 'end'],
  'text-overflow': ['clip', 'ellipsis'],
  'text-transform': ['none', 'uppercase', 'lowercase', 'capitalize'],
  'border-style': ['none', 'solid', 'dashed', 'dotted', 'double', 'hidden'],
  'outline-style': ['none', 'solid', 'dashed', 'dotted', 'double', 'auto'],
  isolation: ['auto', 'isolate'],
}
export async function seedCatalogue(repo: string): Promise<Catalogue> {
  const git = (...args: string[]) =>
    execFileSync('git', ['--no-pager', ...args], {
      cwd: repo,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
    }).toString()
  const globals = git('show', `${SEED}:${TOKEN_FILE}`)
  const root = postcss.parse(globals)
  const chunks = [defaultTheme]
  root.each((n) => {
    if (n.type === 'atrule' && ['theme', 'custom-variant', 'utility'].includes(n.name))
      chunks.push(n.toString() + (n.nodes ? '' : ';'))
  })
  const theme = chunks.join('\n')
  const variables: Catalogue['variables'] = {}
  const collect = (css: string) =>
    postcss.parse(css).walkDecls((d) => {
      if (d.prop.startsWith('--'))
        variables[d.prop] = [
          ...new Set([...(variables[d.prop] ?? []), normalizeValue(d.value)]),
        ].sort()
    })
  collect(defaultTheme)
  root.walkDecls((d) => {
    if (d.prop.startsWith('--')) delete variables[d.prop]
  })
  collect(globals)
  const declared = new Set<string>()
  root.walkDecls((d) => {
    if (d.prop.startsWith('--')) declared.add(d.prop)
  })
  const colours = new Set(['--color-white', '--color-black'])
  for (let pass = 0; pass < 8; pass++)
    for (const key of declared) {
      const values = variables[key] ?? []
      if (
        key.startsWith('--color-') ||
        values.some(
          (v) =>
            /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(.+\)|transparent|currentColor)$/i.test(
              v
            ) || variablesIn(v).some((k) => colours.has(k))
        )
      )
        colours.add(key)
    }
  const result: Catalogue = {
    version: CATALOGUE_VERSION,
    sourceCommit: SEED,
    provisional: true,
    sources: [],
    theme,
    variables,
    colourTokens: [...colours].sort(),
    allowed: {},
    provenance: {},
    notes: [
      'Seed permissions are provisional, not adjudicated design guidance.',
      'Documented weights 400/500/600 override inference.',
      'Colours require references or approved named utilities, even when a raw literal matches.',
      'Length normalization uses the nominal 16px Tailwind rem scale.',
      'Global CSS tokens and EMCN style definitions supply values; application call sites and dataset cases do not.',
      'Dynamic expressions are unchecked; no application code, plugins or imported helpers execute.',
    ],
  }
  const allow = (prop: string, value: string, origin: string) => {
    const k = family(prop)
    result.allowed[k] = [...new Set([...(result.allowed[k] ?? []), value])].sort()
    const key = `${k}=${value}`
    result.provenance[key] = [...new Set([...(result.provenance[key] ?? []), origin])].sort()
  }
  for (const [prop, values] of Object.entries(keywords))
    for (const v of values) allow(prop, v, 'policy:structural-keyword')
  const system = await compiler(theme)
  const sourceFiles = git(
    'ls-tree',
    '-r',
    '--name-only',
    SEED,
    '--',
    'packages/emcn/src/components',
    'packages/emcn/src/lib'
  )
    .trim()
    .split('\n')
    .filter((f) => /\.(?:tsx?|css)$/.test(f) && !/\.(?:test|spec|d)\./.test(f))
  for (const file of [TOKEN_FILE, ...sourceFiles].sort()) {
    const blob = git('rev-parse', `${SEED}:${file}`).trim()
    result.sources.push({ file, blob })
    const source = git('cat-file', 'blob', blob)
    const facts = extract(source, file)
    for (const atom of facts.atoms) {
      if (atom.kind === 'token' || file === TOKEN_FILE) continue
      for (const d of declarations(atom, system, variables) ?? []) {
        if (d.category !== 'colours') allow(d.property, d.value, file)
        else for (const name of variablesIn(d.value)) if (declared.has(name)) colours.add(name)
      }
    }
  }
  result.colourTokens = [...colours].sort()
  for (const key of declared) {
    const prop =
      key.startsWith('--text-') && !colours.has(key)
        ? key.endsWith('--line-height')
          ? 'line-height'
          : 'font-size'
        : key.startsWith('--radius')
          ? 'border-radius'
          : key.startsWith('--shadow')
            ? 'box-shadow'
            : key.startsWith('--font-')
              ? 'font-family'
              : undefined
    if (prop && category(prop)) {
      allow(prop, `var(${key})`, TOKEN_FILE)
      for (const value of variables[key] ?? [])
        if (!value.includes(`var(${key})`))
          allow(prop, normalizeValue(value, variables), TOKEN_FILE)
    }
  }
  result.allowed['font-weight'] = ['400', '500', '600', 'inherit']
  result.provenance['font-weight=400'] = ['policy:documented-weight']
  result.provenance['font-weight=500'] = ['policy:documented-weight']
  result.provenance['font-weight=600'] = ['policy:documented-weight']
  result.allowed = Object.fromEntries(
    Object.entries(result.allowed).sort(([a], [b]) => compareStrings(a, b))
  )
  result.variables = Object.fromEntries(
    Object.entries(result.variables).sort(([a], [b]) => compareStrings(a, b))
  )
  result.provenance = Object.fromEntries(
    Object.entries(result.provenance).sort(([a], [b]) => compareStrings(a, b))
  )
  return result
}
if (import.meta.main) {
  const repo = process.argv[process.argv.indexOf('--repo') + 1]
  const output = process.argv[process.argv.indexOf('--output') + 1]
  if (!process.argv.includes('--repo') || !process.argv.includes('--output'))
    throw new Error('Usage: catalogue --repo <repository> --output <catalogue.json>')
  const data = `${JSON.stringify(await seedCatalogue(repo), null, 2)}\n`
  writeFileSync(output, data)
  process.stdout.write(`${canonical({ catalogueHash: hash(data), sourceCommit: SEED })}\n`)
}
