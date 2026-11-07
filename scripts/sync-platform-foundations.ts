/**
 * Rebuild scoped tokens and type recipes from Shared Light MCP readbacks.
 * Usage: bun scripts/sync-platform-foundations.ts <tokens.json> <registry.json> <styles.json> [--check]
 * Inputs: get_tokens' token array, the canonical registry, and the get_computed_styles node map.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { compareStrings } from '@sim/utils/string'

interface Token {
  name: string
  type: string
  value: string
}
interface TypeMaster {
  key: string
  base: string
}
interface TypeStyle {
  fontFamily: string
  fontSize: string
  lineHeight: string
  fontWeight: string | number
  letterSpacing?: string
  fontVariationSettings?: string
}

const [tokensFile, registryFile, stylesFile, mode] = process.argv.slice(2)
if (!stylesFile)
  throw new Error('Supply Shared tokens, registry and computed type styles. See script header.')
const tokens: Token[] = JSON.parse(readFileSync(tokensFile, 'utf8'))
const { typography }: { typography: TypeMaster[] } = JSON.parse(readFileSync(registryFile, 'utf8'))
const styles: Record<string, TypeStyle> = JSON.parse(readFileSync(stylesFile, 'utf8'))
const directory = path.resolve(import.meta.dirname, '../packages/emcn/src/styles/generated')
const compare = mode === '--check'
function emit(filename: string, css: string) {
  const file = path.join(directory, filename)
  const formatted = execFileSync(
    path.resolve(import.meta.dirname, '../node_modules/.bin/biome'),
    ['format', '--stdin-file-path', file],
    { input: css, encoding: 'utf8' }
  )
  if (compare && readFileSync(file, 'utf8') !== formatted)
    throw new Error(`${filename} differs from Paper readback`)
  if (!compare) writeFileSync(file, formatted)
}

function fontFamily(value: string) {
  return value
    .replaceAll('Geist Mono', 'EMCN Geist Mono')
    .replace(/(?<!EMCN )Geist(?! Mono)/g, 'EMCN Geist')
}

const scalable = new Set(['fontSize', 'lineHeight', 'container', 'spacing', 'breakpoint', 'radius'])
function tokenValue(token: Token) {
  // A fallback keeps first paint in a sans face while the self-hosted Geist loads.
  if (token.type === 'fontFamily')
    return `${fontFamily(token.value)}, ${token.value.includes('Mono') ? 'ui-monospace, monospace' : 'Arial, sans-serif'}`
  const size = /^(\d+(?:\.\d+)?)px$/.exec(token.value)
  return size && scalable.has(token.type) && Number(size[1]) >= 4
    ? `${Number(size[1]) / 16}rem`
    : token.value
}

const ordered = tokens
  .slice()
  .sort((a, b) => compareStrings(a.type, b.type) || compareStrings(a.name, b.name))
emit(
  'tokens.css',
  `/* Shared foundation. Reference px become rem at a 16px root; strokes retain their measured width. */\n[data-emcn] {\n${ordered.map((t) => `  ${t.name}: ${tokenValue(t)};`).join('\n')}\n}`
)

const recipes = new Map<string, string[]>()
for (const { key, base } of typography) {
  const type = styles[base]
  if (!type?.fontSize || !type.lineHeight || !type.fontFamily || !type.fontWeight)
    throw new Error(`Missing live type recipe: ${key}`)
  const weight =
    type.fontWeight === 400 || type.fontWeight === '400'
      ? 'var(--font-weight-regular)'
      : type.fontWeight
  const properties = [
    `font: ${weight} ${type.fontSize} / ${type.lineHeight} ${fontFamily(type.fontFamily)};`,
  ]
  if (type.letterSpacing) properties.push(`letter-spacing: ${type.letterSpacing};`)
  if (type.fontVariationSettings) {
    const axis = type.fontVariationSettings.replace(
      /"wght" (400|450)$/,
      (_, value) => `"wght" var(--font-weight-${value === '400' ? 'regular' : 'control'})`
    )
    properties.push(`font-variation-settings: ${axis};`)
  }
  const recipe = properties.join('\n')
  const keys = recipes.get(recipe) ?? []
  keys.push(key)
  recipes.set(recipe, keys)
}
function typeSelector(key: string) {
  return `[data-emcn] [data-type="${key}"]`
}

emit(
  'typography.css',
  `/* Shared type masters. Color and wrapping belong to the semantic slot. */\n[data-emcn] [data-type] { letter-spacing: normal; font-variation-settings: normal; }\n${[...recipes].map(([recipe, keys]) => `${keys.map(typeSelector).join(',\n')} {\n${recipe}\n}`).join('\n')}`
)
process.stdout.write(
  `${compare ? 'Verified' : 'Wrote'} ${tokens.length} tokens and ${typography.length} registered type recipes.\n`
)
