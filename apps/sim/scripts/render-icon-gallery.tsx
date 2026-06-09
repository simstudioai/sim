import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Lucide from 'lucide-react'

const ICONS_DIR = join(import.meta.dir, '../components/emcn/icons')

/** Extract { exportName: svgMarkup } from every emcn icon .tsx file. */
function extractEmcn(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const file of readdirSync(ICONS_DIR)) {
    if (!file.endsWith('.tsx')) continue
    const src = readFileSync(join(ICONS_DIR, file), 'utf8')
    const re = /export\s+(?:function|const)\s+(\w+)[\s\S]*?(<svg[\s\S]*?<\/svg>)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      out[m[1]] = jsxSvgToHtml(m[2])
    }
  }
  return out
}

/** Convert a JSX <svg> string into browser-renderable HTML. */
function jsxSvgToHtml(jsx: string): string {
  return jsx
    .replace(/\{\.\.\.[^}]*\}/g, '') // {...props}
    .replace(/[\w-]+=\{[^}]*\}/g, '') // attr={expr}
    .replace(/\bclassName=/g, 'class=')
    .replace(/\bstrokeWidth=/g, 'stroke-width=')
    .replace(/\bstrokeLinecap=/g, 'stroke-linecap=')
    .replace(/\bstrokeLinejoin=/g, 'stroke-linejoin=')
    .replace(/\bstrokeMiterlimit=/g, 'stroke-miterlimit=')
    .replace(/\bstrokeDasharray=/g, 'stroke-dasharray=')
    .replace(/\bstrokeOpacity=/g, 'stroke-opacity=')
    .replace(/\bfillRule=/g, 'fill-rule=')
    .replace(/\bclipRule=/g, 'clip-rule=')
    .replace(/\bfillOpacity=/g, 'fill-opacity=')
    .replace(/\bclipPath=/g, 'clip-path=')
    .replace(/\bwidth='[^']*'/, '') // strip fixed size → CSS sizes it
    .replace(/\bheight='[^']*'/, '')
    .replace(/aria-hidden='true'/g, '')
}

function lucideSvg(name: string): string | null {
  const Comp = (Lucide as Record<string, unknown>)[name]
  if (!Comp) return null
  try {
    return renderToStaticMarkup(
      createElement(Comp as React.ComponentType, { width: 24, height: 24, strokeWidth: 1.75 })
    )
  } catch {
    return null
  }
}

const emcn = extractEmcn()

type Item = { name: string; count: string; src: 'emcn' | 'lucide'; lucide?: string }
type Section = { title: string; note?: string; items: Item[] }

const e = (name: string, count: string): Item => ({ name, count, src: 'emcn' })
const l = (name: string, count: string, lucide?: string): Item => ({
  name,
  count,
  src: 'lucide',
  lucide: lucide ?? name,
})

const sections: Section[] = [
  {
    title: 'TIER 1 · Core — Arrows & Chevrons',
    note: 'Redesign first. Tier-2 chevrons/arrows are rotations of these.',
    items: [
      e('ChevronDown', '21 +24'),
      e('ArrowLeft', '14 +5'),
      e('ArrowUp', '11 +15'),
      e('ArrowDown', '10 +6'),
      e('ArrowRight', '6 +7'),
      e('ArrowUpDown', '1 +1'),
    ],
  },
  {
    title: 'TIER 1 · Core — Actions & Controls',
    items: [
      e('Search', '44 +14'),
      e('Plus', '27 +29'),
      e('X', '16 +31'),
      e('Check', '16 +23'),
      e('Pencil', '16 +7'),
      e('Trash', '25'),
      e('Trash2', '2 +4'),
      e('Settings', '11 +2'),
      e('MoreHorizontal', '9 +9'),
      e('Send', '13'),
      e('Download', '18'),
      e('Upload', '17'),
      e('Duplicate', '11'),
      e('RefreshCw', '3 +5'),
    ],
  },
  {
    title: 'TIER 1 · Core — Files, Folders & Data',
    items: [
      e('File', '23 +1'),
      e('Files', '18'),
      e('Folder', '15 +3'),
      e('FolderPlus', '4'),
      e('Table', '21 +1'),
      e('Database', '19 +3'),
      e('Library', '12 +1'),
      e('Clipboard', '4 +12'),
    ],
  },
  {
    title: 'TIER 1 · Core — Status & Primitives',
    items: [
      e('Eye', '10 +7'),
      e('EyeOff', '1 +7'),
      e('Lock', '7 +3'),
      e('Unlock', '3 +2'),
      e('Key', '9 +1'),
      e('Info', '5 +10'),
      e('Square', '7 +2'),
      e('Calendar', '10'),
      e('Clock', '2 +4'),
      e('Loader', '10'),
      e('User', '10 +1'),
      e('Users', '5 +2'),
      e('Link', '10'),
      e('Bell', '2 +2'),
      e('Pin', '3 +2'),
      e('PinOff', '2 +1'),
      e('Paperclip', '1 +5'),
      e('PlayOutline', '15'),
      e('Pause', '4 +3'),
    ],
  },
  {
    title: 'TIER 1 · Core — Type Markers (design as a unified set)',
    items: [
      e('TypeText', '4'),
      e('TypeNumber', '4'),
      e('TypeBoolean', '4'),
      e('TypeJson', '2'),
    ],
  },
  {
    title: 'TIER 0 · Name-aliases — no design, just alias existing emcn glyph',
    note: 'Shown is the existing emcn glyph each lucide name maps to.',
    items: [
      e('X', 'XIcon'),
      e('Send', 'SendIcon'),
      e('Server', 'ServerIcon'),
      e('Wrench', 'WrenchIcon'),
      e('TagIcon', 'Tag'),
      e('TriangleAlert', 'AlertTriangle'),
      e('CircleAlert', 'AlertCircle'),
      e('CircleCheck', 'CheckCircle2'),
    ],
  },
  {
    title: 'TIER 2 · lucide-only — derivable from a core glyph (rotate / compose / variant)',
    items: [
      l('ChevronRight', '18'),
      l('ChevronUp', '9'),
      l('ChevronLeft', '6'),
      l('ChevronsUpDown', '4'),
      l('MoreVertical', '2'),
      l('ArrowLeftRight', '5'),
      l('ArrowUpLeft', '1'),
      l('RotateCcw', '4'),
      l('XCircle', '3'),
      l('PauseCircle', '1'),
      l('Circle', '5'),
      l('CircleOff', '2'),
      l('Minus', '1'),
      l('Settings2', '1'),
      l('KeyRound', '1'),
      l('LibraryBig', '1'),
      l('FolderOpen', '1'),
      l('FileText', '4'),
      l('MicOff', '1'),
      l('Filter', '1'),
      l('Image', '2'),
      l('ExternalLink', '8'),
    ],
  },
  {
    title: 'TIER 3 · lucide-only — net-new glyphs to design from scratch',
    items: [
      l('RepeatIcon', '10', 'Repeat'),
      l('SplitIcon', '10', 'Split'),
      l('Wand2', '4'),
      l('GraduationCap', '3'),
      l('Bot', '1'),
      l('Building2', '1'),
      l('Camera', '1'),
      l('Compass', '1'),
      l('FormInput', '1'),
      l('GitBranch', '1'),
      l('Github', '1'),
      l('Globe', '1'),
      l('Hash', '1'),
      l('History', '1'),
      l('MessageCircle', '1'),
      l('Moon', '1'),
      l('Music', '1'),
      l('Phone', '1'),
      l('Rss', '1'),
      l('Scan', '1'),
      l('Scissors', '1'),
      l('SendToBack', '1'),
      l('Share2', '1'),
      l('Sparkles', '1'),
      l('Sun', '1'),
      l('Webhook', '1'),
      l('Workflow', '1'),
    ],
  },
]

function cell(it: Item): string {
  let svg: string | null
  let label: string
  if (it.src === 'emcn') {
    svg = emcn[it.name] ?? null
    label = it.name
  } else {
    svg = lucideSvg(it.lucide ?? it.name)
    label = it.name
  }
  const art = svg
    ? `<div class="art">${svg}</div>`
    : `<div class="art missing">?</div>`
  return `<div class="cell"><div class="box">${art}</div><div class="name">${label}</div><div class="count">${it.count}</div></div>`
}

const body = sections
  .map(
    (s) => `
  <section>
    <h2>${s.title} <span class="n">(${s.items.length})</span></h2>
    ${s.note ? `<p class="note">${s.note}</p>` : ''}
    <div class="grid">${s.items.map(cell).join('')}</div>
  </section>`
  )
  .join('')

const total = sections.reduce((a, s) => a + s.items.length, 0)

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Sim icon update map</title>
<style>
  :root { --ink:#1a1a1a; --muted:#8a8a8a; --line:#ececec; --bg:#fff; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:#fafafa; padding:32px 40px 80px; }
  header h1 { font-size:22px; margin:0 0 2px; }
  header p { color:var(--muted); margin:0 0 28px; }
  section { margin:0 0 36px; }
  h2 { font-size:13px; letter-spacing:.04em; text-transform:uppercase; color:var(--ink); border-bottom:1px solid var(--line); padding-bottom:8px; margin:0 0 4px; }
  h2 .n { color:var(--muted); font-weight:400; }
  .note { color:var(--muted); font-size:12px; margin:6px 0 14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:10px; margin-top:14px; }
  .cell { display:flex; flex-direction:column; align-items:center; gap:6px; padding:14px 6px 10px; background:var(--bg); border:1px solid var(--line); border-radius:10px; }
  .box { width:40px; height:40px; display:flex; align-items:center; justify-content:center; color:var(--ink); }
  .art svg { width:24px; height:24px; display:block; }
  .art.missing { color:#c00; font-size:20px; }
  .name { font-size:11px; font-weight:500; text-align:center; word-break:break-word; }
  .count { font-size:10px; color:var(--muted); font-variant-numeric:tabular-nums; }
</style></head>
<body>
  <header>
    <h1>Sim — icons to update (${total})</h1>
    <p>Counts = emcn usage + lucide sites to migrate. Artwork is the current live glyph.</p>
  </header>
  ${body}
</body></html>`

const outPath = join(import.meta.dir, '../../../icon-gallery.html')
writeFileSync(outPath, html)
console.log(`Wrote ${outPath} — ${total} icons`)
