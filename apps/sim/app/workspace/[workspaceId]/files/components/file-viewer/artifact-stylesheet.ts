/**
 * The stylesheet Sim injects into an agent-authored page that opts in.
 *
 * A faithful port of the docs site's look (apps/docs/app/global.css): the same
 * platform tokens under their real names, the same font stacks, the docs
 * sidebar's 30px pill items, and the clerk-style muted TOC. A page opting in
 * renders as a page of the Sim docs, not as a third design system.
 *
 * Injected only into the preview document, never written into the stored file,
 * so restyling every existing page is a change to this constant. The preview is
 * also what the share page renders through, so shared links pick it up too; a
 * raw download is the one path that sees unstyled markup.
 */

/** Marker a page carries to request {@link SIM_ARTIFACT_STYLESHEET}. */
const ARTIFACT_MARKER = /<meta[^>]+name=["']sim-artifact["'][^>]*>/i

export function usesSimArtifactStyles(content: string): boolean {
  return ARTIFACT_MARKER.test(content)
}

/**
 * The app tokens the sheet consumes, under their platform names. The frame has
 * an opaque origin and inherits no CSS, so values must be carried across — but
 * hand-copying them is how the docs app already drifted (its global.css mirrors
 * these under a "keep in sync" comment). Reading the computed values at render
 * time keeps `globals.css` the single definition: change it and every page
 * follows on next render, with no build step and nothing for CI to check.
 */
const ARTIFACT_TOKENS = [
  '--bg',
  '--surface-1',
  '--surface-2',
  '--surface-3',
  '--surface-5',
  '--surface-hover',
  '--surface-active',
  '--border',
  '--text-primary',
  '--text-secondary',
  '--text-body',
  '--text-muted',
  '--text-icon',
  '--text-error',
  '--brand-accent',
  '--brand-secondary',
  '--warning',
  '--badge-success-bg',
  '--badge-success-text',
  '--badge-orange-bg',
  '--badge-orange-text',
  '--badge-error-bg',
  '--badge-error-text',
  '--badge-gray-bg',
  '--badge-gray-text',
] as const

/**
 * A `:root` block rebinding the tokens to the app's live values, or empty off
 * the browser (SSR, tests) where the sheet's own mirrors stand in. The selector
 * list matches the specificity of the sheet's `[data-theme]` fallback blocks,
 * and this block is injected after the sheet, so it wins.
 */
export function simTokenOverrides(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return ''
  const computed = getComputedStyle(document.documentElement)
  const declarations = ARTIFACT_TOKENS.map((token) => {
    const value = computed.getPropertyValue(token).trim()
    return value ? `${token}:${value}` : ''
  }).filter(Boolean)
  if (declarations.length === 0) return ''
  return `:root,:root[data-theme="dark"],:root[data-theme="light"]{${declarations.join(';')}}`
}

/**
 * Token mirrors first (light on bare `:root`, dark under the guarded media
 * query and again under `[data-theme="dark"]` so an explicit stamp wins both
 * ways), then base elements, then the docs chrome. A colour defined solely
 * inside a media or `[data-theme]` block would be undefined in the other theme
 * — the classic unreadable-page bug — so everything lands on `:root` first.
 */
export const SIM_ARTIFACT_STYLESHEET = `
:root {
  --bg: #ffffff;
  --surface-1: #fbfbfb;
  --surface-2: #ffffff;
  --surface-3: #f7f7f7;
  --surface-5: #f3f3f3;
  --surface-hover: #f2f2f2;
  --surface-active: #ececec;
  --border: #d8d8d8;
  --text-primary: #1a1a1a;
  --text-secondary: #525252;
  --text-body: #434343;
  --text-muted: #7a7a7a;
  --text-icon: #5a5a5a;
  --text-error: #ef4444;
  --brand-accent: #33c482;
  --brand-secondary: #33b4ff;
  --warning: #ea580c;
  --badge-success-bg: #bbf7d0;
  --badge-success-text: #15803d;
  --badge-orange-bg: #fed7aa;
  --badge-orange-text: #c2410c;
  --badge-error-bg: #fecaca;
  --badge-error-text: #dc2626;
  --badge-gray-bg: #e7e5e4;
  --badge-gray-text: #57534e;
  --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --text-caption: 12px;
  --text-small: 13px;
  --text-sm: 14px;
  --text-base: 15px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1b1b1b;
    --surface-1: #1e1e1e;
    --surface-2: #232323;
    --surface-3: #242424;
    --surface-5: #363636;
    --surface-hover: #262626;
    --surface-active: #2c2c2c;
    --border: #444444;
    --text-primary: #e6e6e6;
    --text-secondary: #cccccc;
    --text-body: #c1c1c1;
    --text-muted: #6e6e6e;
    --text-icon: #969696;
    --warning: #ff6600;
    --badge-success-bg: rgba(34, 197, 94, 0.2);
    --badge-success-text: #86efac;
    --badge-orange-bg: rgba(249, 115, 22, 0.2);
    --badge-orange-text: #fdba74;
    --badge-error-bg: #551a1a;
    --badge-error-text: #fca5a5;
    --badge-gray-bg: #3a3a3a;
    --badge-gray-text: #a8a8a8;
  }
}
:root[data-theme="dark"] {
  --badge-success-bg: rgba(34, 197, 94, 0.2);
  --badge-success-text: #86efac;
  --badge-orange-bg: rgba(249, 115, 22, 0.2);
  --badge-orange-text: #fdba74;
  --badge-error-bg: #551a1a;
  --badge-error-text: #fca5a5;
  --badge-gray-bg: #3a3a3a;
  --badge-gray-text: #a8a8a8;
  --bg: #1b1b1b;
  --surface-1: #1e1e1e;
  --surface-2: #232323;
  --surface-3: #242424;
  --surface-5: #363636;
  --surface-hover: #262626;
  --surface-active: #2c2c2c;
  --border: #444444;
  --text-primary: #e6e6e6;
  --text-secondary: #cccccc;
  --text-body: #c1c1c1;
  --text-muted: #6e6e6e;
  --text-icon: #969696;
  --warning: #ff6600;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 72px; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  * { transition: none !important; animation: none !important; }
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text-body);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { color: var(--text-primary); letter-spacing: -0.02em; text-wrap: balance; }
h1 { font-size: 1.85rem; font-weight: 600; line-height: 1.2; margin: 0 0 0.75rem; }
h2 { font-size: 1.3rem; font-weight: 600; margin: 2.75rem 0 0.9rem; }
h3 { font-size: 1.02rem; font-weight: 550; margin: 1.9rem 0 0.5rem; }
p, li { max-width: 70ch; }
p { margin: 0 0 1rem; }
a { color: var(--text-primary); text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 3px; }
a:hover { text-decoration-color: var(--text-muted); }
strong { color: var(--text-primary); font-weight: 550; }
hr { border: 0; border-top: 1px solid var(--border); margin: 2.5rem 0; }
code {
  font-family: var(--font-mono);
  font-size: 0.84em;
  background: var(--surface-5);
  border-radius: 6px;
  padding: 0.15em 0.4em;
  color: var(--text-primary);
}
pre {
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  padding: 1rem;
  overflow-x: auto;
  font-size: var(--text-small);
}
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; font-size: var(--text-sm); }
th, td { text-align: left; padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--border); }
th { color: var(--text-muted); font-weight: 500; font-size: var(--text-caption); }
tbody tr:last-child td { border-bottom: none; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
figure { margin: 2rem 0; }
figure svg { display: block; width: 100%; height: auto; color: var(--text-body); }
figcaption { font-size: var(--text-small); color: var(--text-muted); margin-top: 0.8rem; max-width: 70ch; }
:focus-visible { outline: 2px solid var(--brand-secondary); outline-offset: 2px; }

/* Layout ------------------------------------------------------------------ */
.page { max-width: 1080px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
.page[data-layout="brief"] { max-width: 660px; }
.page[data-layout="dashboard"] { max-width: 1240px; }
.page[data-layout="docs"] { max-width: 1400px; padding-top: 0; }

.grid { display: grid; gap: 0.9rem; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.scroll { overflow-x: auto; }

/* Components — the docs/app chip chrome ----------------------------------- */
.eyebrow {
  font-size: var(--text-caption);
  color: var(--text-muted);
  margin: 0 0 0.75rem;
}
.lede { font-size: 1.05rem; color: var(--text-secondary); max-width: 64ch; margin: 0 0 1.75rem; }
.card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  padding: 1rem 1.1rem;
}
.card > :last-child { margin-bottom: 0; }
.stat { font-size: 1.7rem; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1.2; }
.stat-label { font-size: var(--text-caption); color: var(--text-muted); margin-bottom: 0.2rem; }
/* The emcn Badge, verbatim: status colors on rounded-md, md-size metrics. */
.pill {
  display: inline-flex;
  align-items: center;
  font-size: var(--text-caption);
  line-height: 1.35;
  padding: 2px 9px;
  border-radius: 6px;
  background: var(--badge-gray-bg);
  color: var(--badge-gray-text);
}
.pill--ok { background: var(--badge-success-bg); color: var(--badge-success-text); }
.pill--warn { background: var(--badge-orange-bg); color: var(--badge-orange-text); }
.pill--bad { background: var(--badge-error-bg); color: var(--badge-error-text); }

/* Expanding question rows — the accordion, as native <details>, no scripts. */
.faq {
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--surface-2);
  overflow: hidden;
}
.faq > details { border-bottom: 1px solid var(--border); }
.faq > details:last-child { border-bottom: none; }
.faq summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.7rem 1rem;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after {
  content: "";
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-right: 1.5px solid var(--text-icon);
  border-bottom: 1.5px solid var(--text-icon);
  transform: rotate(45deg);
  transition: transform 0.15s;
  margin-top: -3px;
}
.faq details[open] summary::after { transform: rotate(225deg); margin-top: 3px; }
.faq summary:hover { background: var(--surface-hover); }
.faq details > :not(summary) { padding: 0 1rem; }
.faq details > :last-child { padding-bottom: 0.9rem; margin-bottom: 0; }
.callout {
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  padding: 0.9rem 1.1rem;
  margin: 1.5rem 0;
}
.callout > :last-child { margin-bottom: 0; }
.rows { list-style: none; margin: 1.25rem 0 0; padding: 0; border-top: 1px solid var(--border); }
.rows > li {
  display: grid;
  gap: 0.1rem 1.5rem;
  grid-template-columns: 1fr;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
}
@media (min-width: 720px) { .rows > li { grid-template-columns: 240px minmax(0, 1fr); } }
.rows .key { font-family: var(--font-mono); font-size: var(--text-caption); color: var(--text-secondary); word-break: break-all; }

/* Docs chrome -------------------------------------------------------------- */
.art-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 1rem;
  height: 52px;
  margin-bottom: 1.5rem;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.art-bar-title { font-size: var(--text-sm); font-weight: 500; color: var(--text-primary); margin-right: auto; }
.art-search {
  width: min(260px, 45vw);
  height: 30px;
  padding: 0 0.6rem;
  font-family: var(--font-sans);
  font-size: var(--text-small);
  color: var(--text-primary);
  background: var(--surface-5);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}
.art-search::placeholder { color: var(--text-muted); }
.art-cols { display: grid; gap: 2rem; grid-template-columns: 1fr; }
@media (min-width: 1100px) {
  .art-cols { grid-template-columns: 230px minmax(0, 1fr) 190px; gap: 2.75rem; }
  .art-cols > .rail { position: sticky; top: 68px; align-self: start; max-height: calc(100vh - 6rem); overflow-y: auto; }
}
@media (max-width: 1099px) { .art-cols > .rail[data-rail="toc"] { display: none; } }
.rail ol, .rail ul { list-style: none; margin: 0; padding: 0; }
.rail-title { font-size: var(--text-caption); color: var(--text-muted); margin: 0 0 0.4rem; padding: 0 0.5rem; }
.rail a[hidden] { display: none; }

/* Left rail: the docs sidebar's 30px pill items — 14px/20px type, 5px 8px
   padding, rounded-lg, hover/active surfaces, no underline. */
.rail[data-rail="nav"] li { margin-bottom: 1px; }
.rail[data-rail="nav"] a {
  display: block;
  font-size: var(--text-sm);
  line-height: 20px;
  padding: 5px 0.5rem;
  border-radius: 0.5rem;
  color: var(--text-body);
  text-decoration: none;
}
.rail[data-rail="nav"] a:hover { background: var(--surface-hover); }
.rail[data-rail="nav"] a.is-active { background: var(--surface-active); }

/* Right rail: the clerk TOC — 13px muted links, no chrome, active reads as
   primary text rather than a highlight. */
.rail[data-rail="toc"] .rail-title { padding: 0; color: var(--text-muted); font-size: var(--text-small); }
.rail[data-rail="toc"] li { margin-bottom: 0.15rem; }
.rail[data-rail="toc"] a {
  display: block;
  font-size: var(--text-small);
  padding: 0.15rem 0;
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.2s;
}
.rail[data-rail="toc"] a:hover { color: var(--text-body); }
.rail[data-rail="toc"] a.is-active { color: var(--text-primary); }
`.trim()

/**
 * Builds the docs chrome from the document's own headings.
 *
 * Left rail lists the `h2` sections styled as the docs sidebar, right rail the
 * full heading outline styled as the docs TOC, and the top bar carries the
 * title and a filter box — all derived, so a page opts into the whole shape
 * with one attribute and never hand-writes nav that can fall out of step with
 * its own headings. The filter is in-page only; the sandbox blocks the network,
 * and a box that looked like it searched the workspace would lie.
 *
 * No-ops unless the page asked for `data-layout="docs"`.
 */
export const SIM_ARTIFACT_SHELL = `<script>
(() => {
  const build = () => {
    const page = document.querySelector('.page[data-layout="docs"]')
    if (!page || page.dataset.shell === 'ready') return
    const main = page.querySelector('main') || page
    const headings = [...main.querySelectorAll('h2, h3')]
    if (headings.length === 0) return
    page.dataset.shell = 'ready'

    const slug = (text, i) =>
      (text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section') + '-' + i
    headings.forEach((h, i) => { if (!h.id) h.id = slug(h.textContent || '', i) })

    const rail = (label, items, kind) => {
      const nav = document.createElement('nav')
      nav.className = 'rail'
      nav.setAttribute('aria-label', label)
      nav.dataset.rail = kind
      const title = document.createElement('div')
      title.className = 'rail-title'
      title.textContent = label
      const list = document.createElement('ol')
      for (const h of items) {
        const li = document.createElement('li')
        const a = document.createElement('a')
        a.href = '#' + h.id
        a.textContent = h.textContent
        if (kind === 'toc' && h.tagName === 'H3') a.style.paddingLeft = '0.75rem'
        li.appendChild(a)
        list.appendChild(li)
      }
      nav.append(title, list)
      return nav
    }

    const sections = headings.filter((h) => h.tagName === 'H2')
    const left = rail('Sections', sections, 'nav')
    const right = rail('On this page', headings, 'toc')

    const bar = document.createElement('div')
    bar.className = 'art-bar'
    const title = document.createElement('span')
    title.className = 'art-bar-title'
    title.textContent = document.title
    const search = document.createElement('input')
    search.className = 'art-search'
    search.type = 'search'
    search.placeholder = 'Filter sections'
    search.setAttribute('aria-label', 'Filter sections on this page')
    bar.append(title, search)

    const cols = document.createElement('div')
    cols.className = 'art-cols'
    page.insertBefore(bar, page.firstChild)
    page.insertBefore(cols, bar.nextSibling)
    cols.append(left, main, right)

    const links = [...page.querySelectorAll('.rail a')]
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase()
      for (const a of links) a.hidden = q !== '' && !(a.textContent || '').toLowerCase().includes(q)
    })
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      const first = links.find((a) => !a.hidden)
      if (first) { event.preventDefault(); first.click() }
    })

    // Scroll-spy: the last heading to have crossed the top is the current one,
    // which is steadier than marking whatever happens to be intersecting.
    const byId = new Map()
    for (const a of links) {
      const id = a.getAttribute('href').slice(1)
      if (!byId.has(id)) byId.set(id, [])
      byId.get(id).push(a)
    }
    const spy = () => {
      let currentSection = null
      let currentHeading = null
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= 96) {
          currentHeading = h
          if (h.tagName === 'H2') currentSection = h
        }
      }
      for (const a of links) a.classList.remove('is-active')
      for (const target of [currentSection, currentHeading]) {
        if (!target) continue
        for (const a of byId.get(target.id) || []) a.classList.add('is-active')
      }
    }
    document.addEventListener('scroll', spy, { passive: true })
    window.addEventListener('resize', spy)
    spy()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build)
  else build()
})()
</script>`
