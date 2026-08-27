/**
 * The stylesheet Sim injects into an agent-authored page that opts in.
 *
 * A faithful port of the docs site's look, verified against the real chrome:
 * apps/docs/app/global.css (tokens, sidebar item metrics, heading scale, the
 * divider-based table treatment, clerk TOC colors/weights) and the installed
 * fumadocs-ui@16.8.5 (dist/components/toc/clerk.js for the TOC track
 * geometry and its animated active segment, dist/components/callout.js for
 * the callout shape, dist/layouts/docs/page/slots/toc.js for the TOC column).
 * A page opting in renders as a page of the Sim docs, not a third design
 * system.
 *
 * Never written into the stored file: the preview injects it live and
 * page-document.ts bakes it into standalone/share/download documents, so
 * restyling every existing page is a change to this constant.
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
export const ARTIFACT_TOKENS = [
  '--bg',
  '--surface-1',
  '--surface-2',
  '--surface-3',
  '--surface-4',
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
  '--badge-blue-bg',
  '--badge-blue-text',
  '--badge-purple-bg',
  '--badge-purple-text',
  '--text-icon-muted',
  '--code-bg',
  '--selection-bg',
] as const

/**
 * A block rebinding the tokens to the app's live values, or empty off the
 * browser (SSR, tests) where the sheet's own mirrors stand in. Scoped to the
 * app's CURRENT theme only: the computed values ARE that theme's palette, so
 * pinning them under both `[data-theme]` states would freeze the page's own
 * theme toggle — flipping the attribute must fall back to the sheet's palette
 * for the other theme. `:root[data-theme=...]` outranks the sheet's bare
 * `:root` block, so injection order relative to the sheet does not matter.
 */
export function simTokenOverrides(theme: 'dark' | 'light'): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return ''
  const computed = getComputedStyle(document.documentElement)
  const declarations = ARTIFACT_TOKENS.map((token) => {
    const value = computed.getPropertyValue(token).trim()
    return value ? `${token}:${value}` : ''
  }).filter(Boolean)
  if (declarations.length === 0) return ''
  return `:root[data-theme="${theme}"]{${declarations.join(';')}}`
}

/**
 * Token mirrors first (light on bare `:root`, dark under the guarded media
 * query and again under `[data-theme="dark"]` so an explicit stamp wins both
 * ways), then base elements, then the docs chrome. A colour defined solely
 * inside a media or `[data-theme]` block would be undefined in the other theme
 * — the classic unreadable-page bug — so everything lands on `:root` first.
 *
 * Docs-verified values, with their sources:
 * - headings: global.css "Content typography" (1.5rem/550, 1.25rem/500,
 *   16px/470 on --text-body), body prose on --text-secondary at 1rem/1.75.
 * - tables: global.css "Tables — clean divider-based style" (no outer chrome,
 *   th 600 on --text-primary over a --border rule, td on --text-secondary
 *   over --surface-active rules, last row bare, 0.5rem 0.75rem cells, 14px).
 * - clerk TOC: global.css #nd-toc overrides (13px links, muted, primary when
 *   active) over fumadocs' clerk geometry.
 * - callout: fumadocs callout.js (rounded-xl bordered card, 14px, a rounded
 *   2px color bar down the start edge) with the docs' shadow removal.
 * - layout: global.css --spacing-fd-container 1400px, TOC column 268px,
 *   --content-gap 2.25rem. There is no left sidebar — the TOC is the page's
 *   only navigation rail.
 * The face is the PLATFORM's, not the docs' webfont: --font-sans is the
 * system stack (pages live inside the app, and Inter read as foreign next to
 * emcn/sim chrome). The docs' geometry survives; only the face differs.
 */
/**
 * The dark palette, mirrored from globals.css and emitted under BOTH dark
 * selectors (the prefers-color-scheme fallback and the explicit
 * data-theme="dark" stamp) from this single constant — two hand-maintained
 * copies is how the badge colors already diverged between them. The
 * mirror-vs-app sync is enforced by artifact-stylesheet.test.ts, which parses
 * globals.css and fails naming any token that drifts.
 */
const DARK_TOKEN_DECLARATIONS = `
  --bg: #1b1b1b;
  --surface-1: #1e1e1e;
  --surface-2: #232323;
  --surface-3: #242424;
  --surface-4: #292929;
  --surface-5: #363636;
  --surface-hover: #262626;
  --surface-active: #2c2c2c;
  --border: #444444;
  --text-primary: #e6e6e6;
  --text-secondary: #cccccc;
  --text-body: #c1c1c1;
  --text-muted: #6e6e6e;
  --text-icon: #969696;
  --text-error: #ef4444;
  --brand-accent: #33c482;
  --brand-secondary: #33b4ff;
  --warning: #ff6600;
  --badge-success-bg: rgba(34, 197, 94, 0.2);
  --badge-success-text: #86efac;
  --badge-orange-bg: rgba(249, 115, 22, 0.2);
  --badge-orange-text: #fdba74;
  --badge-error-bg: #551a1a;
  --badge-error-text: #fca5a5;
  --badge-gray-bg: #3a3a3a;
  --badge-gray-text: #a8a8a8;
  --badge-blue-bg: rgba(59, 130, 246, 0.2);
  --badge-blue-text: #93c5fd;
  --badge-purple-bg: rgba(168, 85, 247, 0.2);
  --badge-purple-text: #d8b4fe;
  --text-icon-muted: #949494;
  --code-bg: #1f1f1f;
  --code-surface: var(--code-bg);
  --selection-bg: #264f78;`

export const SIM_ARTIFACT_STYLESHEET = `
:root {
  --bg: #fefefe;
  --surface-1: #fbfbfb;
  --surface-2: #ffffff;
  --surface-3: #f7f7f7;
  --surface-4: #f5f5f5;
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
  --badge-blue-bg: #bfdbfe;
  --badge-blue-text: #1d4ed8;
  --badge-purple-bg: #e9d5ff;
  --badge-purple-text: #7c3aed;
  --text-icon-muted: #5c5c5c;
  --code-bg: #f5f5f5;
  --code-surface: var(--surface-5);
  --selection-bg: #add6ff;
  /* The PLATFORM stack, not the docs' webfont: pages live inside the app,
     and emcn/sim render the system face — Inter here read as foreign. The
     docs' geometry survives; the face is the platform's. */
  --font-sans: ui-sans-serif, -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --text-caption: 12px;
  --text-small: 13px;
  --text-sm: 14px;
  --text-md: 16px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK_TOKEN_DECLARATIONS}
  }
}
:root[data-theme="dark"] {${DARK_TOKEN_DECLARATIONS}
}

* { box-sizing: border-box; scrollbar-width: thin; }
/* scrollbar-gutter keeps the centered column from shifting when content
   length toggles the viewport scrollbar (e.g. switching between a long and a
   short tab). */
/* text-size-adjust pins mobile font boosting: without it, Safari and Chrome
   on phones inflate the text of wide scrollable blocks — code blocks and
   tables render at a jarringly larger size than the prose around them. */
html { scroll-behavior: smooth; scroll-padding-top: 72px; scrollbar-gutter: stable; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  * { transition: none !important; animation: none !important; }
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 1rem;
  line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4 { text-wrap: balance; }
h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; color: var(--text-primary); line-height: 1.25; margin: 0 0 0.75rem; }
h2 { font-size: 1.25rem; font-weight: 500; letter-spacing: -0.015em; color: var(--text-primary); margin: 2.5rem 0 0.9rem; }
h3, h4 { font-size: var(--text-md); font-weight: 500; letter-spacing: -0.01em; color: var(--text-body); margin: 1.75rem 0 0.5rem; }
p, li { max-width: 70ch; }
p { margin: 0 0 1rem; }
/* Content links — the docs' prose anchor (fumadocs prose, compiled): 500
   weight, 1.5px underline offset 3.5px in the text color, 80% opacity on
   hover. Chrome links (rails, TOC, pagination, copy) reset this below. */
a {
  color: var(--text-primary);
  font-weight: 500;
  text-decoration: underline;
  text-decoration-color: var(--text-primary);
  text-decoration-thickness: 1.5px;
  text-underline-offset: 3.5px;
  transition: opacity 0.2s;
}
a:hover { opacity: 0.8; }
strong { color: var(--text-primary); font-weight: 600; }
hr { border: 0; border-top: 1px solid var(--border); margin: 3em 0; }
hr + * { margin-top: 0; }
/* Lists — the docs' prose metrics: 1rem/1.625em indents, muted markers. */
ul { padding-inline-start: 1rem; list-style-type: disc; margin: 1.25em 0; }
ol { padding-inline-start: 1.625em; list-style-type: decimal; margin: 1.25em 0; }
li { margin: 0.5em 0; }
ol > li { padding-inline-start: 0.375em; }
ul ul, ul ol, ol ul, ol ol { margin: 0.75em 0; }
ol > li::marker { font-weight: 400; color: var(--text-muted); }
ul > li::marker { color: var(--text-muted); }
/* Blockquote — the docs' prose quote: 500 italic in the heading color over a
   4px border, with real quote marks. */
blockquote {
  margin: 1.6em 0;
  padding-inline-start: 1em;
  font-weight: 500;
  font-style: italic;
  color: var(--text-primary);
  border-inline-start: 0.25rem solid var(--border);
}
blockquote p:first-of-type::before { content: open-quote; }
blockquote p:last-of-type::after { content: close-quote; }
blockquote code { color: inherit; }
/* Inline code chip — the docs' exact chip: no border, color unset so code
   inside a link keeps the link color instead of sitting on it. */
code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  font-weight: 400;
  background-color: var(--surface-5);
  border-radius: 4px;
  padding: 0.125rem 0.375rem;
}
/* Fenced code — the docs' figure.shiki shell and Code.Viewer metrics: 13px
   on a 21px line box over --code-surface, no shadow. The shell upgrades
   these into .codeblock frames with a copy control; bare pre (report
   layout) carries the same shell itself. */
pre {
  background: var(--code-surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.875rem 1rem;
  overflow: auto;
  max-height: 600px;
  font-size: var(--text-small);
  line-height: 21px;
  tab-size: 2;
  -webkit-overflow-scrolling: touch;
}
pre code { background: none; padding: 0; border-radius: 0; font-size: inherit; display: block; width: fit-content; min-width: 100%; }
::selection { background-color: var(--selection-bg); }

/* Tables — the docs' divider-based treatment: no outer chrome, a --border
   rule under the header, --surface-active rules between rows, bare last row. */
table { border-collapse: collapse; border-spacing: 0; width: 100%; font-size: var(--text-sm); }
th, td { text-align: left; padding: 0.5rem 0.75rem; line-height: 1.5; }
/* The docs' tables read their first column as the row's label. */
tbody td:first-child { font-weight: 500; color: var(--text-primary); }
thead th { font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--border); white-space: nowrap; }
td { color: var(--text-secondary); border-bottom: 1px solid var(--surface-active); }
tbody tr:last-child td { border-bottom: none; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
figure { margin: 2rem 0; }
figure svg { display: block; width: 100%; height: auto; color: var(--text-body); }
figcaption { font-size: 0.875em; line-height: 1.4285714; color: var(--text-primary); margin-top: 0.8571429em; max-width: 70ch; }
:focus-visible { outline: 2px solid var(--brand-secondary); outline-offset: 2px; }

/* Layout — the docs frame: a 1400px container, 300px sidebar, 268px TOC. */
.page { max-width: 1400px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
.page[data-layout="report"] { max-width: 760px; }
.page[data-layout="docs"] { padding-top: 0; }

.scroll { overflow-x: auto; }

/* Components ---------------------------------------------------------------- */
.eyebrow {
  font-size: var(--text-caption);
  color: var(--text-muted);
  margin: 0 0 0.75rem;
}
.lede { font-size: 1.05rem; color: var(--text-secondary); max-width: 64ch; margin: 0 0 1.75rem; }
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

/* Expanding question rows — the accordion, as native <details>, no scripts.
   fumadocs-ui accordion.js verbatim: a rounded-lg bg-fd-card frame with
   divide-y rows; each trigger is px-3 py-2.5 font-medium with a LEADING
   chevron-right (16px icon box, muted) that quarter-turns to down over
   200ms when open; content sits at px-4 pb-2 in 15px. The trigger has no
   hover fill — only focus-visible tints the row (has-focus-visible:
   bg-fd-accent). */
.faq {
  border: 1px solid var(--border);
  border-radius: 0.5rem;
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
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  font-weight: 500;
  line-height: 1.5;
  color: var(--text-primary);
}
.faq summary::-webkit-details-marker { display: none; }
/* The lucide chevron as a border glyph, centered in its 16px box via the
   side margins: points right closed, rotates to down open. */
.faq summary::before {
  content: "";
  width: 8px;
  height: 8px;
  margin: 0 4px;
  flex-shrink: 0;
  border-right: 1.5px solid var(--text-muted);
  border-bottom: 1.5px solid var(--text-muted);
  transform: rotate(-45deg);
  transition: transform 0.2s;
}
.faq details[open] summary::before { transform: rotate(45deg); }
.faq summary:focus-visible { outline: none; background: var(--surface-active); }
.faq details > :not(summary) { padding: 0 1rem; font-size: 0.9375rem; }
.faq details > :last-child { padding-bottom: 0.5rem; margin-bottom: 0; }

/* The fumadocs callout: a rounded-xl bordered card at 14px with a rounded
   2px color bar down the start edge (the docs strip its shadow). */
.callout {
  position: relative;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  padding: 0.75rem 1rem 0.75rem 1.5rem;
  margin: 1.5rem 0;
  font-size: var(--text-sm);
}
.callout::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 12px;
  bottom: 12px;
  width: 2px;
  border-radius: 2px;
  background: var(--text-muted);
  opacity: 0.5;
}
.callout > :last-child { margin-bottom: 0; }
.rows { list-style: none; margin: 1.25rem 0 0; padding: 0; border-top: 1px solid var(--surface-active); }
.rows > li {
  display: grid;
  gap: 0.1rem 1.5rem;
  grid-template-columns: 1fr;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--surface-active);
  font-size: var(--text-sm);
}
@media (min-width: 720px) { .rows > li { grid-template-columns: 240px minmax(0, 1fr); } }
.rows .key {
  /* A label, not code — the docs' th treatment. Backticks in the source opt
     a code-like key (a path, an env var) into the inline-code chip. */
  font-weight: 500;
  color: var(--text-primary);
  font-size: var(--text-sm);
}

/* Docs chrome --------------------------------------------------------------- */
.art-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 1rem;
  height: 52px;
  margin-bottom: 0.5rem;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.art-bar-title { font-size: var(--text-sm); font-weight: 500; color: var(--text-primary); margin-right: auto; }
/* With a chrome tab row directly beneath, the row's hairline is the divider. */
.art-bar--tabs { border-bottom-color: transparent; }

/* Multi-page set tabs — the docs' top tab row: muted labels, the current
   page in primary with a 2px underline riding the row's hairline. The row
   scrolls horizontally (no scrollbar chrome) when the set outgrows the
   column, so a long set never wraps or truncates. */
.page-tabs {
  display: flex; gap: 1.75rem;
  margin: 0 0 2rem;
  border-bottom: 1px solid var(--border);
  overflow-x: auto; scrollbar-width: none;
}
.page-tabs::-webkit-scrollbar { display: none; }
.page-tab {
  flex-shrink: 0; white-space: nowrap;
  padding: 0 0 0.65rem;
  font-size: var(--text-sm); color: var(--text-muted);
  text-decoration: none;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
a.page-tab:hover { color: var(--text-body); opacity: 1; }
.page-tab.is-active { color: var(--text-primary); font-weight: 500; border-bottom-color: var(--text-primary); }
/* In the docs layout the tab row is chrome under the sticky top bar (the
   shell repositions it out of the content column): it sticks with the bar so
   tabs stay reachable deep in a page. The negative margin consumes the bar's
   own margin so the two sticky rows sit flush; the padded background keeps
   scrolled content from showing through the seam. */
.page[data-layout="docs"] > .page-tabs {
  position: sticky; top: 52px; z-index: 4;
  margin: -0.5rem 0 0; padding-top: 0.65rem;
  background: var(--bg);
}
/* In-document tabs render as buttons (client-side switch, one file) — same
   chrome as the linked set tabs. */
button.page-tab { background: none; border-top: 0; border-left: 0; border-right: 0; font: inherit; font-size: var(--text-sm); cursor: pointer; }
button.page-tab:hover { color: var(--text-body); }
.doc-tab-panel { display: none; }
.doc-tab-panel.is-active { display: block; }
/* The panel's leading heading otherwise stacks its section margin on the tab
   row's own gap. */
.doc-tab-panel > :first-child { margin-top: 0; }

/* The docs' theme toggle: 30px, rounded-lg, --text-icon, --surface-active hover. */
.art-theme {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; margin-left: 0.5rem; flex-shrink: 0;
  color: var(--text-icon); background: none; border: none; border-radius: 0.5rem;
  cursor: pointer; transition: background-color 0.15s;
}
.art-theme:hover { background: var(--surface-active); }
.art-cols { display: grid; gap: 2.25rem; grid-template-columns: 1fr; }
.art-cols > .art-main {
  padding-top: 1.5rem;
  min-width: 0;
  width: 100%;
}
/* One layout: the content column at reading width with the TOC beside it,
   the pair centered. A narrow pane collapses to a single column; there is no
   left sidebar — the TOC is the page's only navigation rail. */
.art-cols > .rail { display: none; }
@media (min-width: 800px) {
  .art-cols { grid-template-columns: minmax(0, 760px) fit-content(268px); justify-content: center; }
  /* Fixed width, not content-sized: in a tabbed doc the longest TOC entry
     differs per tab, and a column that resizes re-centers the whole grid on
     every switch. */
  .art-cols > .rail[data-rail="toc"] { display: block; position: sticky; top: 68px; align-self: start; max-height: calc(100vh - 6rem); overflow-y: auto; width: 268px; }
}
/* Rails scroll invisibly, like the docs — no scrollbar chrome beside the
   TOC; the absolutely-positioned clerk track SVGs also can't tip the box
   into showing one. */
.art-cols > .rail { scrollbar-width: none; }
.art-cols > .rail::-webkit-scrollbar { display: none; }
.toc-track, .toc-thumb { display: block; }
.rail ol, .rail ul { list-style: none; margin: 0; padding: 0; }
/* Chrome links are navigation, not prose: no underline weight or hover fade. */
.rail a { font-weight: 400; transition: none; }
.rail a:hover { opacity: 1; }

.rail[data-rail="toc"] { min-width: 150px; }

/* Right rail: the clerk TOC. Title at 13px/480 with the text glyph; links at
   13px/430 muted, hover body, active primary at 470 — the docs' #nd-toc
   overrides on fumadocs' clerk geometry (20px/32px item indents). */
.rail[data-rail="toc"] { padding-top: 48px; padding-right: 1rem; }
.rail[data-rail="toc"] .rail-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-small);
  font-weight: 500;
  color: var(--text-muted);
  margin: 0 0 0.5rem;
}
.rail[data-rail="toc"] .rail-title svg { width: 16px; height: 16px; }
.toc-items { position: relative; display: flex; flex-direction: column; }
.toc-items a {
  position: relative;
  display: block;
  padding-top: 6px;
  padding-bottom: 6px;
  font-size: var(--text-small);
  font-weight: 400;
  line-height: 1.4;
  color: var(--text-muted);
  text-decoration: none;
  overflow-wrap: anywhere;
  transition: color 0.2s;
}
.toc-items a:first-of-type { padding-top: 0; }
.toc-items a:last-of-type { padding-bottom: 0; }
.toc-items a[data-depth="2"] { padding-left: 20px; }
.toc-items a[data-depth="3"] { padding-left: 32px; }
.toc-items a:hover { color: var(--text-body); }
/* Color-only active state: a weight flip re-measures the fit-content
   column (widen or wrap) — primary-vs-muted is the docs' real signal
   anyway, the clerk thumb carries the emphasis. */
.toc-items a.is-active { color: var(--text-primary); }
/* The track: the full outline path in foreground at 10%, and the same path in
   full foreground clipped to the active range — fumadocs animates the clip
   window, which is the "black segment" that slides as you scroll. */
.toc-track, .toc-thumb { position: absolute; top: 0; left: 0; pointer-events: none; }
.toc-track path { stroke: var(--text-primary); stroke-opacity: 0.1; stroke-width: 1; fill: none; }
.toc-thumb path { stroke: var(--text-primary); stroke-width: 1; fill: none; }
.toc-thumb {
  clip-path: polygon(0 var(--track-top, 0), 100% var(--track-top, 0), 100% var(--track-bottom, 0), 0 var(--track-bottom, 0));
  transition: clip-path 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Images — content-width, docs card radius; figures already carry captions. */
.page img { max-width: 100%; height: auto; border-radius: 0.5rem; }

/* Code blocks — the docs' framed treatment: the shell wraps each pre in a
   .codeblock with a header bar carrying the language label and a copy
   button, so the bare pre border above only applies to unwrapped blocks. */
/* Fenced code frame — the docs' figure.shiki shell (global.css: 0.5rem
   radius, --border hairline, --code-surface fill, no shadow) with the docs'
   copy control: emcn's quiet icon Button (20px, rounded, --text-icon-muted,
   --surface-active hover) floating top-right, Duplicate flipping to a
   brand-accent Check while copied. Untitled fences carry no header row,
   exactly like the docs' prose fences. */
.codeblock { position: relative; border: 1px solid var(--border); border-radius: 0.5rem; margin: 1rem 0; overflow: hidden; background: var(--code-surface); box-shadow: none; }
.codeblock-copy {
  position: absolute; top: 8px; right: 8px; z-index: 1;
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0;
  color: var(--text-icon-muted); background: none; border: none; border-radius: 0.25rem;
  cursor: pointer;
}
.codeblock-copy:hover { background: var(--surface-active); }
.codeblock-copy svg { stroke-width: 1.25; }
.codeblock-copy.is-copied { color: var(--brand-accent); }
.codeblock pre { border: none; border-radius: 0; margin: 0; background: transparent; }

/* Steps — the docs' numbered timeline: a muted numbered circle per step,
   ONE continuous hairline rail behind the circles, title + content beside.
   Per-step segments with gaps around each circle read as a broken line the
   moment step bodies vary in height; a full-height rail that the opaque
   circles paint over is what the docs render. */
.steps { list-style: none; margin: 1.25rem 0; padding: 0; }
/* Explicit margin/padding resets: the prose list rules (ol > li's inline-start
   indent, li's vertical margins) otherwise leak in — the indent shifts the
   circles off the absolutely-positioned rail, and inter-item margins cut gaps
   into it. */
.step { --step-marker: 28px; position: relative; display: flex; gap: 1rem; margin: 0; padding: 0 0 1.75rem; }
.step:last-child { padding-bottom: 0.25rem; }
/* The rail spans the whole step, dead-centered under the circle; the last
   step draws none, so the line ends AT the final circle. */
.step::before {
  content: ''; position: absolute; left: calc(var(--step-marker) / 2 - 0.5px);
  top: 0; bottom: 0;
  width: 1px; background: var(--border);
}
.step:last-child::before { display: none; }
.step-marker {
  /* Positioned so it paints OVER the rail; opaque fill is what hides the
     line passing behind the circle. */
  position: relative;
  flex-shrink: 0; width: var(--step-marker); height: var(--step-marker); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-5); color: var(--text-muted);
  font-size: var(--text-small); font-weight: 500;
}
/* 3px optically centers the title's ~22px line box on the 28px circle. */
.step-body { min-width: 0; padding-top: 3px; }
.step-title { font-weight: 500; color: var(--text-primary); margin-bottom: 0.4rem; }
/* The body's trailing paragraph margin would compound with the step's own
   padding into an oversized gap. */
.step-body > :last-child { margin-bottom: 0; }

/* Code tabs — the docs' grouped code block: mono tab chips in the header,
   one pane visible at a time. */
.codetabs-head { display: flex; align-items: center; gap: 2px; padding: 0.3rem 0.4rem; }
.codetab {
  font-family: var(--font-mono); font-size: var(--text-small);
  color: var(--text-muted); background: none; border: none;
  border-radius: 0.375rem; padding: 0.2rem 0.6rem; cursor: pointer;
}
.codetab:hover { background: var(--surface-hover); color: var(--text-body); }
.codetab.is-active { background: var(--surface-active); color: var(--text-primary); }
.codetabs-head .codetabs-copy { position: static; margin-left: auto; }

`.trim()

/**
 * Builds the docs chrome from the document's own headings.
 *
 * Left rail lists the `h2` sections styled as the docs sidebar, right rail is
 * the clerk TOC: every `h2`/`h3` with fumadocs' depth indents, a curved track
 * drawn through the items, and the active range highlighted by clipping a
 * full-strength copy of the track — the clip window animates on scroll, which
 * is the docs' signature moving black segment. Geometry follows
 * fumadocs-ui@16.8.5 clerk.js: line x at 8px (h2) / 16px (h3) + 0.5, item
 * spans from offsetTop+paddingTop to offsetTop+height-paddingBottom, adjacent
 * items joined by a cubic that eases across depth changes. The docs hide
 * clerk's traveling dot, so none is drawn here.
 *
 * The top bar carries the title and a filter box for the section rail. The
 * filter is in-page only; the sandbox blocks the network, and a box that
 * looked like it searched the workspace would lie.
 *
 * No-ops unless the page asked for `data-layout="docs"`.
 */
export const SIM_ARTIFACT_SHELL = `<script>
(() => {
  const build = () => {
    const page = document.querySelector('.page[data-layout="docs"]')
    if (!page || page.dataset.shell === 'ready') return
    const main = page.querySelector('main') || page
    if (main.querySelectorAll('h2, h3').length === 0) return
    page.dataset.shell = 'ready'

    // In a multi-tab document each tab is its own page: the TOC is built from
    // the ACTIVE panel's headings only and rebuilt on every tab switch.
    const tocScope = () => main.querySelector('[data-tab-panel].is-active') || main
    let headings = []
    let tocLinks = []

    const ICON_ATTRS = 'viewBox="-1 -2 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
    const slug = (text, i) =>
      (text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section') + '-' + i

    // Right rail — the clerk TOC.
    const right = document.createElement('nav')
    right.className = 'rail'
    right.dataset.rail = 'toc'
    right.setAttribute('aria-label', 'On this page')
    const rightTitle = document.createElement('div')
    rightTitle.className = 'rail-title'
    rightTitle.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/></svg>' +
      '<span>On this page</span>'
    const tocItems = document.createElement('div')
    tocItems.className = 'toc-items'
    const SVG_NS = 'http://www.w3.org/2000/svg'
    const track = document.createElementNS(SVG_NS, 'svg')
    track.setAttribute('class', 'toc-track')
    track.setAttribute('aria-hidden', 'true')
    const trackPath = document.createElementNS(SVG_NS, 'path')
    track.appendChild(trackPath)
    const thumb = document.createElementNS(SVG_NS, 'svg')
    thumb.setAttribute('class', 'toc-thumb')
    thumb.setAttribute('aria-hidden', 'true')
    const thumbPath = document.createElementNS(SVG_NS, 'path')
    thumb.appendChild(thumbPath)
    tocItems.append(track, thumb)
    right.append(rightTitle, tocItems)

    // Top bar with the page title and the theme toggle.
    const bar = document.createElement('div')
    bar.className = 'art-bar'
    const title = document.createElement('span')
    title.className = 'art-bar-title'
    title.textContent = document.title

    // Theme toggle, top right — the docs' exact control (components/ui/
    // theme-toggle.tsx): a 30px rounded-lg ghost button, --surface-active on
    // hover, showing the emcn Sun icon in light and Moon in dark at 14px.
    // data-theme wins over the prefers-color-scheme fallback in every
    // stylesheet block, so flipping the attribute is the whole mechanism.
    // Storage is unavailable in the sandboxed preview, so the choice lives
    // for the page view.
    const SUN = '<svg ' + ICON_ATTRS + '><circle cx="10.25" cy="9.75" r="4"/><path d="M10.25 3.75V1.25M16.25 9.75H18.75M10.25 15.75V18.25M4.25 9.75H1.75"/><path d="M14.49 5.51L16.26 3.74M14.49 13.99L16.26 15.76M6.01 13.99L4.24 15.76M6.01 5.51L4.24 3.74"/></svg>'
    const MOON = '<svg ' + ICON_ATTRS + '><path d="M10.25 1.5A5.84 5.84 0 0 0 18.5 9.75A8.25 8.25 0 1 1 10.25 1.5Z"/></svg>'
    const themeButton = document.createElement('button')
    themeButton.className = 'art-theme'
    themeButton.type = 'button'
    themeButton.setAttribute('aria-label', 'Toggle theme')
    const resolvedTheme = () =>
      document.documentElement.dataset.theme ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    const paintThemeButton = () => {
      themeButton.innerHTML = resolvedTheme() === 'dark' ? MOON : SUN
    }
    themeButton.addEventListener('click', () => {
      document.documentElement.dataset.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'
      paintThemeButton()
    })
    paintThemeButton()
    bar.append(title, themeButton)

    // Code blocks get the docs frame: like the docs' prose fences, an
    // untitled block has no header row — just the floating copy control,
    // emcn's Duplicate icon flipping to a brand-accent Check while copied.
    const COPY_ICON = '<svg ' + ICON_ATTRS + '><path d="M14.25 0.75H2.75C1.64543 0.75 0.75 1.64543 0.75 2.75V14.25"/><rect x="5.25" y="5.25" width="14" height="14" rx="2"/></svg>'
    const COPIED_ICON = '<svg ' + ICON_ATTRS + '><path d="M18.25 2.75L7.25 15.75L1.75 10.25"/></svg>'
    // The async clipboard API is denied in the sandboxed in-app preview (the
    // frame's origin is opaque, so no clipboard permission can match it); the
    // selection command still honors the click's user activation there, so it
    // is the fallback wherever the modern API refuses.
    const copyText = async (text) => {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {}
      const scratch = document.createElement('textarea')
      scratch.value = text
      scratch.setAttribute('readonly', '')
      scratch.style.position = 'fixed'
      scratch.style.opacity = '0'
      document.body.appendChild(scratch)
      scratch.select()
      let copied = false
      try { copied = document.execCommand('copy') } catch {}
      scratch.remove()
      return copied
    }
    for (const pre of [...main.querySelectorAll('pre')]) {
      if (pre.closest('.codeblock')) continue
      const codeEl = pre.querySelector('code')
      const frame = document.createElement('figure')
      frame.className = 'codeblock'
      const copy = document.createElement('button')
      copy.className = 'codeblock-copy'
      copy.type = 'button'
      copy.setAttribute('aria-label', 'Copy Text')
      copy.innerHTML = COPY_ICON
      let copyResetTimer
      copy.addEventListener('click', async () => {
        const text = (codeEl || pre).textContent || ''
        if (!(await copyText(text))) return
        copy.innerHTML = COPIED_ICON
        copy.classList.add('is-copied')
        copy.setAttribute('aria-label', 'Copied Text')
        clearTimeout(copyResetTimer)
        copyResetTimer = setTimeout(() => {
          copy.innerHTML = COPY_ICON
          copy.classList.remove('is-copied')
          copy.setAttribute('aria-label', 'Copy Text')
        }, 1500)
      })
      pre.replaceWith(frame)
      frame.append(copy, pre)
    }

    // Markdown tables arrive bare (only sim:table fences are pre-wrapped);
    // an over-wide one must scroll inside the column — on a phone a bare
    // table is what drags the whole page sideways.
    for (const table of [...main.querySelectorAll('table')]) {
      if (table.closest('.scroll')) continue
      const wrap = document.createElement('div')
      wrap.className = 'scroll'
      table.replaceWith(wrap)
      wrap.appendChild(table)
    }

    // Code-tab groups: switch panes; the docs' icon copy control targets the
    // visible pane.
    for (const group of [...main.querySelectorAll('.codetabs')]) {
      const head = group.querySelector('.codetabs-head')
      if (!head) continue
      const groupCopy = document.createElement('button')
      groupCopy.className = 'codeblock-copy codetabs-copy'
      groupCopy.type = 'button'
      groupCopy.setAttribute('aria-label', 'Copy Text')
      groupCopy.innerHTML = COPY_ICON
      let groupResetTimer
      groupCopy.addEventListener('click', async () => {
        const pane = group.querySelector('pre:not([hidden])')
        if (!(await copyText((pane && pane.textContent) || ''))) return
        groupCopy.innerHTML = COPIED_ICON
        groupCopy.classList.add('is-copied')
        clearTimeout(groupResetTimer)
        groupResetTimer = setTimeout(() => {
          groupCopy.innerHTML = COPY_ICON
          groupCopy.classList.remove('is-copied')
        }, 1500)
      })
      head.appendChild(groupCopy)
      head.addEventListener('click', (event) => {
        const origin = event.target
        const btn = origin && origin.closest ? origin.closest('.codetab') : null
        if (!btn) return
        const tabs = [...head.querySelectorAll('.codetab')]
        const panes = [...group.querySelectorAll('pre')]
        const index = tabs.indexOf(btn)
        tabs.forEach((tab, i) => tab.classList.toggle('is-active', i === index))
        panes.forEach((pane, i) => { pane.hidden = i !== index })
      })
    }

    const cols = document.createElement('div')
    cols.className = 'art-cols'
    const mid = document.createElement('div')
    mid.className = 'art-main'
    page.insertBefore(bar, page.firstChild)
    page.insertBefore(cols, bar.nextSibling)
    if (main === page) {
      while (cols.nextSibling) mid.appendChild(cols.nextSibling)
    } else {
      mid.appendChild(main)
    }
    cols.append(mid, right)

    // The tab row is chrome, not article content: it sits full-width under
    // the top bar (the docs' own placement), not inside the content column
    // above the h1.
    const pageTabs = page.querySelector('.page-tabs')
    if (pageTabs) {
      page.insertBefore(pageTabs, cols)
      // One divider, not two: the tab row's own bottom hairline is the
      // chrome's edge, so the bar sheds its border.
      bar.classList.add('art-bar--tabs')
    }

    // Clerk track geometry (fumadocs clerk.js): one path threading every item,
    // vertical through each and a cubic easing across depth changes.
    const lineOffset = (depth) => (depth === '2' ? 8 : 16)
    let positions = []
    const measure = () => {
      positions = []
      let w = 0
      let h = 0
      let d = ''
      for (let i = 0; i < tocLinks.length; i++) {
        const a = tocLinks[i]
        const styles = getComputedStyle(a)
        const x = lineOffset(a.dataset.depth) + 0.5
        const top = a.offsetTop + parseFloat(styles.paddingTop)
        const bottom = a.offsetTop + a.clientHeight - parseFloat(styles.paddingBottom)
        w = Math.max(w, x + 8)
        h = Math.max(h, bottom)
        if (i === 0) d += ' M' + x + ' ' + top + ' L' + x + ' ' + bottom
        else {
          const prev = positions[i - 1]
          d += ' C ' + prev[2] + ' ' + (top - 4) + ' ' + x + ' ' + (prev[1] + 4) + ' ' + x + ' ' + top + ' L' + x + ' ' + bottom
        }
        positions.push([top, bottom, x])
      }
      for (const svg of [track, thumb]) {
        svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h)
        svg.setAttribute('width', String(w))
        svg.setAttribute('height', String(h))
      }
      trackPath.setAttribute('d', d.trim())
      thumbPath.setAttribute('d', d.trim())
    }

    // Scroll-spy. The TOC marks the RANGE of headings whose sections touch the
    // viewport (fumadocs behavior) and slides the clip window over it.
    const spy = () => {
      const viewTop = 96
      const viewBottom = window.innerHeight
      const rects = headings.map((h) => h.getBoundingClientRect().top)
      let first = -1
      let last = -1
      for (let i = 0; i < headings.length; i++) {
        const sectionTop = rects[i]
        const sectionBottom = i + 1 < headings.length ? rects[i + 1] : Infinity
        if (sectionBottom > viewTop && sectionTop < viewBottom) {
          if (first === -1) first = i
          last = i
        }
      }
      for (const a of tocLinks) a.classList.remove('is-active')
      if (first === -1 || positions.length === 0) {
        thumb.style.setProperty('--track-top', '0')
        thumb.style.setProperty('--track-bottom', '0')
        return
      }
      for (let i = first; i <= last; i++) tocLinks[i].classList.add('is-active')
      thumb.style.setProperty('--track-top', positions[first][0] + 'px')
      thumb.style.setProperty('--track-bottom', positions[last][1] + 'px')
    }

    const refresh = () => { measure(); spy() }
    new ResizeObserver(refresh).observe(tocItems)
    document.addEventListener('scroll', spy, { passive: true })
    window.addEventListener('resize', refresh)

    // (Re)builds the TOC from the active scope — the whole page, or the
    // active tab's panel. Each tab switch produces a fresh rail, so every
    // tab reads as its own page.
    let slugSeq = 0
    const populateToc = () => {
      headings = [...tocScope().querySelectorAll('h2, h3')]
      headings.forEach((h) => { if (!h.id) h.id = slug(h.textContent || '', slugSeq++) })
      for (const a of [...tocItems.querySelectorAll('a')]) a.remove()
      tocLinks = []
      for (const h of headings) {
        const a = document.createElement('a')
        a.href = '#' + h.id
        a.textContent = h.textContent
        a.dataset.depth = h.tagName === 'H2' ? '2' : '3'
        tocItems.appendChild(a)
        tocLinks.push(a)
      }
      // In a tabbed doc an empty rail stays (its fixed column holds the grid
      // steady across switches); only an untabbed page drops it entirely.
      const tabbed = main.querySelector('[data-tab-panel]') !== null
      right.style.display = headings.length === 0 && !tabbed ? 'none' : ''
      refresh()
    }
    document.addEventListener('sim-tab-change', populateToc)
    populateToc()
  }

  // In-page anchors must scroll, never navigate. Under the preview's
  // about:srcdoc base a default '#' click is a real navigation in Electron —
  // it escapes the document and lands on the app's sign-in page (the
  // sandboxed frame carries no cookies).
  document.addEventListener(
    'click',
    (event) => {
      const origin = event.target
      const anchor = origin && origin.closest ? origin.closest('a[href^="#"]') : null
      if (!anchor) return
      event.preventDefault()
      const id = decodeURIComponent((anchor.getAttribute('href') || '').slice(1))
      const target = id ? document.getElementById(id) : null
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    true
  )

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build)
  else build()
})()
</script>`
