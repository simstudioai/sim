import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import postcss from 'postcss'
import valueParser from 'postcss-value-parser'
import { __unstable__loadDesignSystem } from 'tailwindcss'
import {
  type Atom,
  type Catalogue,
  category,
  type Declaration,
  family,
} from '#design-conformance/model'

const require = createRequire(import.meta.url)
export const defaultTheme = readFileSync(
  path.join(path.dirname(require.resolve('tailwindcss/package.json')), 'theme.css'),
  'utf8'
)
/** Only declarative theme data reaches the pinned compiler; module/import loading always fails. */
export async function compiler(theme: string) {
  return __unstable__loadDesignSystem(theme, {
    loadModule: async () => {
      throw new Error('Application modules are not executable inputs')
    },
    loadStylesheet: async () => {
      throw new Error('Stylesheet imports are not executable inputs')
    },
  })
}
export type Compiler = Awaited<ReturnType<typeof compiler>>
export function utility(candidate: string): { base: string; variants: string } {
  let depth = 0
  let last = -1
  for (let i = 0; i < candidate.length; i++) {
    if ('[('.includes(candidate[i])) depth++
    if ('])'.includes(candidate[i])) depth--
    if (candidate[i] === ':' && depth === 0) last = i
  }
  return {
    base: candidate.slice(last + 1).replace(/^!|!$/g, ''),
    variants: candidate.slice(0, last + 1),
  }
}
/** Canonical comparisons use the nominal 16px Tailwind rem scale, not a runtime layout claim. */
export function normalizeValue(
  input: string,
  variables: Record<string, string[]> = {},
  depth = 0
): string {
  let value = valueParser(input)
    .toString()
    .replace(/\s*!important\s*$/, '')
    .trim()
    .replace(/\s+/g, ' ')
  if (depth < 6)
    value = value.replace(/var\((--[\w-]+)\)/g, (all, key: string) => {
      const values = variables[key]
      if (
        !values ||
        values.length !== 1 ||
        !/^(?:-?[\d.]+(?:px|rem|s|ms)?|calc\([\d.\s*+\-/pxrem]+\))$/.test(values[0])
      )
        return all
      return normalizeValue(values[0], variables, depth + 1)
    })
  value = value.replace(
    /(-?(?:\d*\.)?\d+)rem\b/g,
    (_, n: string) => `${Number((Number(n) * 16).toFixed(6))}px`
  )
  value = value.replace(
    /calc\(\s*(-?[\d.]+)px\s*\*\s*(-?[\d.]+)\s*\)/g,
    (_, a: string, b: string) => `${Number((Number(a) * Number(b)).toFixed(6))}px`
  )
  value = value.replace(
    /calc\(\s*(-?[\d.]+)px\s*([+-])\s*([\d.]+)px\s*\)/g,
    (_, a: string, op: string, b: string) => `${Number(a) + (op === '+' ? 1 : -1) * Number(b)}px`
  )
  value = value
    .replace(/(?<![\w.])0(?:px|rem|em|%|s|ms)\b/g, '0')
    .replace(/(?<![\w.])(-?[\d.]+)s\b/g, (_, n: string) => `${Number(n) * 1000}ms`)
  return value
    .replace(/\s*,\s*/g, ',')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
}
const internal: Record<string, string> = {
  '--tw-shadow': 'box-shadow',
  '--tw-ring-color': 'outline-color',
  '--tw-ring-shadow': 'box-shadow',
  '--tw-inset-shadow': 'box-shadow',
  '--tw-blur': 'filter',
  '--tw-backdrop-blur': 'backdrop-filter',
  '--tw-rotate-x': 'rotate',
  '--tw-rotate-y': 'rotate',
  '--tw-rotate-z': 'rotate',
  '--tw-scale-x': 'scale',
  '--tw-scale-y': 'scale',
}
export function declarations(
  atom: Atom,
  system: Compiler,
  variables: Catalogue['variables'],
  detailed = false
): Declaration[] | null {
  if (atom.kind === 'token') return []
  const { base } = utility(atom.value)
  if (
    atom.kind === 'class' &&
    /^(?:-?(?:translate|top|bottom|left|right|inset)(?:-|$)|(?:group|peer)(?:\/|$))/.test(base)
  )
    return []
  if (
    atom.kind === 'style' &&
    /^(?:top|bottom|left|right|inset(?:-|$)|translate)$/.test(atom.property)
  )
    return []
  if (
    atom.kind === 'style' &&
    atom.property === 'transform' &&
    /^(?:translate(?:X|Y|Z|3d)?\([^()]+\)\s*)+$/.test(atom.value)
  )
    return []
  const css =
    atom.kind === 'class' ? system.candidatesToCss([base])[0] : `x{${atom.property}:${atom.value}}`
  if (!css) return null
  const found: Declaration[] = []
  postcss.parse(css).walkDecls((d) => {
    const prop = internal[d.prop] ?? d.prop
    const cat =
      category(prop) ??
      (detailed && prop.startsWith('--') && !prop.startsWith('--tw-')
        ? 'custom-properties'
        : undefined)
    if (!cat) return
    let value = normalizeValue(d.value, cat === 'colours' ? {} : variables)
    if (['opacity', 'scale'].includes(prop))
      value = value.replace(/(-?[\d.]+)%/g, (_, n: string) => String(Number(n) / 100))
    if (prop === 'transform' && /(?:--tw-translate|--tw-rotate|--tw-skew)/.test(value)) return
    if (
      ['box-shadow', 'filter', 'backdrop-filter'].includes(prop) &&
      /var\(--tw-/.test(value) &&
      !internal[d.prop]
    )
      return
    if (detailed) {
      found.push({
        property: prop,
        value:
          value +
          (d.important || (atom.kind === 'class' && /(?:^|:)!|!$/.test(atom.value))
            ? ' !important'
            : ''),
        category: cat,
      })
      return
    }
    const parts = valueParser(value)
      .nodes.filter((n) => n.type !== 'space' && n.type !== 'comment')
      .map((n) => valueParser.stringify(n))
    if (/^(?:padding|margin|gap|border-radius)$/.test(family(prop))) {
      for (const part of parts.filter((x) => x !== '/'))
        found.push({ property: family(prop), value: part, category: cat })
    } else if (/^(?:border(?:-(?:top|bottom|left|right))?|outline)$/.test(prop)) {
      const prefix = prop.startsWith('outline') ? 'outline' : 'border'
      for (const part of parts) {
        const suffix =
          /^(?:none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(part)
            ? 'style'
            : /^(?:[\d.]+(?:px|em)|0|thin|medium|thick)$/.test(part) ||
                part.includes('--border-width')
              ? 'width'
              : 'color'
        found.push({
          property: `${prefix}-${suffix}`,
          value: part,
          category: suffix === 'color' ? 'colours' : 'borders',
        })
      }
    } else found.push({ property: family(prop), value, category: cat })
  })
  return [...new Map(found.map((x) => [JSON.stringify(x), x])).values()]
}
/** Literal colours cannot bypass token requirements inside gradients or composite effects. */
export function rawColours(value: string): boolean {
  return (
    /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i.test(
      value.replace(/(?:rgb|rgba|hsl|hsla)\(\s*var\([^)]*\)(?:\s*\/\s*[\d.%]+)?\s*\)/g, '')
    ) || /^(?:black|white|red|blue|green|yellow|gray|grey|orange|pink|purple)$/i.test(value)
  )
}
export function variablesIn(value: string): string[] {
  return [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((x) => x[1])
}
