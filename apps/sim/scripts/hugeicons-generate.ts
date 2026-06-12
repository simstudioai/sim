/**
 * Generate emcn icon components from Hugeicons (free, stroke-rounded) assets.
 * - Overwrites existing emcn icon files whose every export maps to a Hugeicons glyph.
 * - Creates new files for mapped exports that don't exist yet.
 * - Leaves keep-custom files (Sim, Blimp, brand bubbles, bespoke animated) untouched.
 * - Rebuilds index.ts barrel from the full export set.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HUGEICONS_MAP } from './hugeicons-map'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ICONS_DIR = join(HERE, '../components/emcn/icons')
const INDEX = join(ICONS_DIR, 'index.ts')

const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()

type IconNode = [string, Record<string, string>]

/** Load a Hugeicons node array and serialize it to JSX child elements. */
async function hugeiconsInner(hugeName: string): Promise<string> {
  const mod = await import(`@hugeicons/core-free-icons/${hugeName}`)
  const nodes = mod.default as IconNode[]
  return nodes
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => `${k}='${v}'`)
        .join(' ')
      return `<${tag} ${a} />`
    })
    .join('\n      ')
}

function parseBarrel(): {
  fileToExports: Record<string, string[]>
  exportToFile: Record<string, string>
} {
  const src = readFileSync(INDEX, 'utf8')
  const fileToExports: Record<string, string[]> = {}
  const exportToFile: Record<string, string> = {}
  const re = /export\s+\{([^}]*)\}\s+from\s+'\.\/([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    fileToExports[m[2]] = names
    for (const n of names) exportToFile[n] = m[2]
  }
  return { fileToExports, exportToFile }
}

function componentBlock(name: string, hugeName: string, inner: string): string {
  return `/**
 * ${name} icon (Hugeicons stroke-rounded: ${hugeName})
 * @param props - SVG properties including className, size, fill, etc.
 */
export function ${name}({ size = 24, width, height, ...props }: IconProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={width ?? size}
      height={height ?? size}
      viewBox='0 0 24 24'
      fill='none'
      aria-hidden='true'
      {...props}
    >
      ${inner}
    </svg>
  )
}`
}

function fileContents(blocks: string[]): string {
  return `import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Square size in px applied to width and height; overridden by explicit width/height or a className size. */
  size?: number | string
}

${blocks.join('\n\n')}
`
}

const { fileToExports, exportToFile } = parseBarrel()
const existingExports = new Set(Object.keys(exportToFile))

// Pre-resolve all inner SVG markup (async import) once.
const innerByName: Record<string, string> = {}
for (const [name, huge] of Object.entries(HUGEICONS_MAP)) {
  if (huge == null) continue
  innerByName[name] = await hugeiconsInner(huge)
}

let regenerated = 0
let created = 0
const written: Record<string, string[]> = {}

// 1. Regenerate existing files whose every export is mapped.
for (const [file, names] of Object.entries(fileToExports)) {
  if (names.some((n) => HUGEICONS_MAP[n] == null)) continue
  written[file] = names
  const blocks = names.map((n) => componentBlock(n, HUGEICONS_MAP[n] as string, innerByName[n]))
  writeFileSync(join(ICONS_DIR, `${file}.tsx`), fileContents(blocks))
  regenerated++
}

// 2. Create new files for mapped exports that don't exist yet.
for (const [name, huge] of Object.entries(HUGEICONS_MAP)) {
  if (huge == null || existingExports.has(name)) continue
  const file = kebab(name)
  written[file] = [name]
  exportToFile[name] = file
  writeFileSync(
    join(ICONS_DIR, `${file}.tsx`),
    fileContents([componentBlock(name, huge, innerByName[name])])
  )
  created++
}

// 3. Rebuild the barrel.
const allFiles = new Set<string>([...Object.keys(fileToExports), ...Object.keys(written)])
const lines: Array<{ first: string; line: string }> = []
for (const file of allFiles) {
  const names = written[file] ?? fileToExports[file]
  const sorted = [...names].sort()
  lines.push({ first: sorted[0], line: `export { ${sorted.join(', ')} } from './${file}'` })
}
lines.sort((a, b) => a.first.toLowerCase().localeCompare(b.first.toLowerCase()))
writeFileSync(INDEX, lines.map((l) => l.line).join('\n') + '\n')

const unmapped = [...existingExports].filter((n) => !(n in HUGEICONS_MAP))
console.log(`Regenerated: ${regenerated}, new: ${created}, barrel: ${lines.length}`)
if (unmapped.length) console.log(`Not in map (kept original): ${unmapped.join(', ')}`)
