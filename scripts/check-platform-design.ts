#!/usr/bin/env bun
/**
 * Enforces the design ownership boundary for the Platform: its product routes in the main app
 * (`PRODUCT_ROUTES`) and the project beside them in `platform/` (data seam, shared helpers,
 * fixtures, styles). Only a real screen, or a Base used by one, can establish a variant. Native
 * layout and interactive behavior are checked in the browser.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from '@typescript/typescript6'
import postcss from 'postcss'
import { emcnPackages, emcnTypeScriptPaths, resolveEmcnImport } from './emcn-packages'
import {
  type AllowlistName,
  allowlistReasonFindings,
  type PlatformAllowlists,
  staleAllowlistFindings,
} from './platform-allowlists'
import { ORGANIZATION_ROUTES, PRODUCT_ROUTES } from './platform-product-routes'
import { productUsage } from './platform-variant-usage'
import { listRepoFiles } from './repo-files'

const root = path.resolve(
  process.argv.slice(2).find((argument) => !argument.startsWith('--')) ??
    path.resolve(import.meta.dir, '..')
)
const app = path.join(root, 'apps/sim')
const packages = emcnPackages(root)
/**
 * The exceptions the audited tree grants (`scripts/platform-allowlists.ts`); a tree without that
 * module grants none. Each consulted entry is recorded, so `stale-allowlist` can name the rest.
 */
const allowlistModule = path.join(root, 'scripts/platform-allowlists.ts')
const allowlists: Partial<PlatformAllowlists> = existsSync(allowlistModule)
  ? (await import(allowlistModule)).PLATFORM_ALLOWLISTS
  : {}
const consulted = new Map<string, Set<string>>()
/** Whether `name` grants `entry`, recording the grant. Call it only where a finding would otherwise fire. */
function grants(name: AllowlistName, entry: string): boolean {
  if (!Object.hasOwn(allowlists[name] ?? {}, entry)) return false
  const entries = consulted.get(name) ?? new Set<string>()
  entries.add(entry)
  consulted.set(name, entries)
  return true
}
const platform = 'platform/'
/** What the Platform's design rules govern: its own project and its product routes. */
const inPlatformTree = (file: string) =>
  file.startsWith(platform) || file.startsWith(PRODUCT_ROUTES)
const shared = '../../packages/emcn/src/'
const system = '../../packages/emcn-platform/src/'
const systems = [shared, system]
const packageSources = packages.map((owner) => `${path.relative(app, owner.source)}/`)
const isSystem = (file: string) => systems.some((owner) => file.startsWith(owner))
const isComponent = (file: string) =>
  systems.some((owner) => file.startsWith(`${owner}components/`))
const isFoundation = (file: string) => systems.some((owner) => file.startsWith(`${owner}styles/`))
const isCatalog = (file: string) => systems.some((owner) => file.startsWith(`${owner}catalog/`))
const catalog = `${system}catalog/`
const variantsPath = `${catalog}variants.json`
const evidencePath = `${catalog}evidence.json`
const productFiles = new Set([
  '01M6A91A32GBA6GTN4HASVG0ER',
  '01M6ABW6M1BXJE1J513A6VR6TY',
  '01M6F0RKAQMZQJGC8PD5PR0SSE',
])
const libraryFiles = {
  shared: { L: '01M6ASMJ22TS7WG8Q3P5YTHWWD', D: '01M6ASMN2120W3CEDT8FXWCTQX' },
  platform: { L: '01M6ASMDKJ81HACJGPNYCJQVVT', D: '01M6ASMG4R446K2Z96JZRXZFX7' },
} as const

type Location = [string, string, string]
interface Evidence {
  key: string
  family: string
  owner: string
  theme: 'L' | 'D'
  scope: keyof typeof libraryFiles
  base: Location
  use: Location
  parentKey?: string
}
type Variants = Record<string, Record<string, Record<string, string[]>>>
const read = (file: string) => readFileSync(path.join(app, file), 'utf8')
/**
 * The Workflows tab's canvas reproduces the legacy editor's canvas pixel for pixel, as the user
 * required ("the workflow blocks themselves and the canvas nodes and the loops ... must look the exact
 * same"). Its blocks, handles, borders, edges, subflow containers, notes and cursors are the legacy
 * renderer's views copied into this one folder, so it keeps the renderer's pixel geometry and type
 * metrics (shared with its JS layout math in `@sim/workflow-renderer/dimensions`), its literal palette
 * and timings, its decorative SVG, its local component sizes and focus treatment, and React Flow's
 * inline style for node geometry and block colors. Its colors otherwise come from the legacy canvas
 * tokens, declared once in `workflow-canvas/canvas-tokens.module.css`. Chrome around the canvas
 * (menus, panels, dialogs, the toolbar) lives outside this folder and keeps every rule.
 */
const WORKFLOW_CANVAS = `${PRODUCT_ROUTES}_components/workspace/workflows/canvas/`
const WORKFLOW_CANVAS_RULES: ReadonlySet<string> = new Set([
  'consumer-style',
  'focus-style',
  'icon-owner',
  'motion-timing',
  'prop-spread',
  'raw-color',
  'raw-geometry',
  'style-api',
  'untokenized-style',
  'variant-declaration',
])
/** Custom properties the canvas's own modules declare, readable only from those modules. */
const workflowCanvasTokens = new Set<string>([
  // The legacy document faces: next/font sets the first on the canvas root; the second falls back.
  '--font-season',
  '--font-martian-mono',
])

/** Each distinct finding, rendered; `location` may carry a `:line` suffix. */
const findings = new Map<string, { rule: string; file: string }>()
function report(rule: string, location: string, message: string) {
  if (location.startsWith(WORKFLOW_CANVAS) && WORKFLOW_CANVAS_RULES.has(rule)) return
  findings.set(`${location} [${rule}] ${message}`, {
    rule,
    file: location.replace(/:\d+$/, ''),
  })
}

for (const owner of packages) {
  for (const dependency of Object.keys({
    ...owner.manifest.dependencies,
    ...owner.manifest.peerDependencies,
  })) {
    if (dependency === '@sim/emcn-legacy')
      report(
        'legacy-import',
        path.relative(app, path.join(owner.directory, 'package.json')),
        dependency
      )
    if (
      packages.some(
        (target) =>
          target.name === dependency && target.name !== '@sim/emcn' && target.name !== owner.name
      )
    )
      report(
        'design-dependency',
        path.relative(app, path.join(owner.directory, 'package.json')),
        dependency
      )
  }
}

/** Source and CSS files the repo lists (`listRepoFiles`), relative to the app. */
const listedFiles = listRepoFiles(root)
  .filter((file) => /\.(?:[cm]?[jt]sx?|css)$/.test(file))
  .map((file) => path.relative(app, path.join(root, file)))
/** The listed files under `dir` (relative to the app), or every file inside the app. */
const files = (dir = '') =>
  listedFiles.filter((file) =>
    dir ? file.startsWith(`${dir.replace(/\/$/, '')}/`) : !file.startsWith('../')
  )

const variants: Variants = JSON.parse(read(variantsPath))
const evidence: Evidence[] = JSON.parse(read(evidencePath))
const keys = new Map(evidence.map((row) => [row.key, row]))
if (!keys.size) report('paper-base', evidencePath, 'Missing Platform evidence')
const validLocation = (value: Location) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((x) => typeof x === 'string' && x.length > 0) &&
  /^p-/.test(value[1])

for (const row of evidence) {
  if (
    !/^C\d{4}$/.test(row.key) ||
    !row.owner ||
    !row.family ||
    !validLocation(row.base) ||
    libraryFiles[row.scope]?.[row.theme] !== row.base[0] ||
    !validLocation(row.use) ||
    keys.get(row.key) !== row
  )
    report('paper-base', evidencePath, row.key)
}
function reachesScreen(row: Evidence | undefined, visited = new Set<string>()): boolean {
  if (!row || visited.has(row.key) || !validLocation(row.use)) return false
  if (productFiles.has(row.use[0])) return true
  const parent = row.parentKey && keys.get(row.parentKey)
  visited.add(row.key)
  return (
    !!parent &&
    parent.base[0] === row.use[0] &&
    parent.base[1] === row.use[1] &&
    reachesScreen(parent, visited)
  )
}
for (const row of evidence) {
  if (!reachesScreen(row))
    report('variant-use', evidencePath, `${row.key}: needs a Use rooted in a Platform screen`)
}
const recipesPath = `${catalog}recipes.json`
const recipes: Record<string, { slots: Record<string, string> }> = JSON.parse(read(recipesPath))
for (const [key, recipe] of Object.entries(recipes)) {
  if (keys.get(key)?.owner !== 'ComponentRecipe')
    report('recipe-owner', recipesPath, `${key} lacks a structural master`)
  for (const nested of Object.values(recipe.slots)) {
    if (!['text', 'media', 'trend', 'bars', 'donut'].includes(nested) && !keys.has(nested))
      report('recipe-owner', recipesPath, `${key} names unknown slot master ${nested}`)
  }
}
const exportedOwners = new Set<string>()
const declarations = new Set<string>()
for (const [owner, props] of Object.entries(variants)) {
  for (const [prop, values] of Object.entries(props)) {
    for (const [value, ids] of Object.entries(values)) {
      if (
        !Array.isArray(ids) ||
        ids.some((id) => keys.get(id)?.owner !== owner || !reachesScreen(keys.get(id)))
      ) {
        report(
          'variant-use',
          variantsPath,
          `${owner}.${prop}=${value}: missing reachable Paper key`
        )
      }
      const variant = `${owner}.${prop}=${value}`
      if (Array.isArray(ids) && !ids.length && !grants('CODE_FIRST_VARIANTS', variant)) {
        report(
          'variant-evidence',
          variantsPath,
          `${variant}: name its Paper key, or its reason in CODE_FIRST_VARIANTS`
        )
      }
    }
  }
}

const dataSeam = 'platform/lib/data/'
/** Whether a file belongs to the product route tree, whose `_components` are private to their route. */
const inRouteTree = (file: string) => file.startsWith(PRODUCT_ROUTES)
/**
 * The product's root layout is the bootstrap for its routes: it loads the host's analytics, consent,
 * desktop and public-environment pieces the site's root layout loads, so it alone may import them.
 */
const PRODUCT_ROOT_LAYOUT = `${PRODUCT_ROUTES}layout.tsx`
/** The one table cell whose width is a caller's value, carried to its CSS as a custom property. */
const COLUMN_WIDTH_OWNER = `${shared}components/data-display/data-display`
/** The calendar day column, which places each event by its time through an inline style. */
const CALENDAR_DAY = `${ORGANIZATION_ROUTES}home/_components/calendar/calendar-day.tsx`
/** The org chart's canvas, whose nodes and edges are styled through React Flow's own props. */
const FLOW_CANVAS = `${ORGANIZATION_ROUTES}people/_components/org-chart/chart-canvas.tsx`
const seamRoots = ['hooks/queries', 'lib/api']
const isServerOnly = (file: string) => /^import 'server-only'$/m.test(read(file))
/** A seam module that runs only on the server, or a test, which no bundle includes. */
const runsOnServer = (file: string) => /\.test\.tsx?$/.test(file) || isServerOnly(file)
/** Each pulls in a whole subsystem, which only the workflow editor's seam may bundle. */
const seamClosureBanned = /^(?:blocks|tools|triggers)\/registry\.tsx?$/
const seamPackages =
  /^@sim\/(?:utils|logger|browser-extension-protocol|browser-protocol|desktop-bridge|terminal-protocol|platform-authz\/predicates|realtime-protocol|auth\/principal)(?:\/|$)/
/**
 * The Workflows tab runs the legacy editor's logic unchanged (the user asked for the canvas exactly
 * as it is), so its seam folders are the one place the blocks and tools registry, the workflow
 * packages and the editor's context providers may cross. A knowledge connector's selector fields
 * resolve their options through the same blocks registry, so their isolated folder shares the
 * exception. Everything else keeps the rules above.
 */
const workflowSeam =
  /^platform\/lib\/data\/(?:workflows|workflow-editor|workflow-deploy|knowledge\/connector-selectors)\//
/**
 * The workflow model, its persisted shape, the realtime protocol, the renderer's pure layout data and
 * the legacy glyph set block configs already name their icons from.
 */
const workflowSeamPackages =
  /^@sim\/(?:workflow-types|workflow-persistence|realtime-protocol)(?:\/|$)|^@sim\/workflow-renderer\/(?:dimensions|note-colors|note-content|tile-icon-color)$|^@sim\/emcn-legacy\/icons$/
const workflowClosureGlyphs = /^components\/icons\/[\w-]+\.tsx$/
function resolveImport(file: string, specifier: string) {
  const workspace = resolveEmcnImport(packages, specifier, path.join(app, file))
  if (workspace) return path.relative(app, workspace)
  if (specifier.startsWith('@/')) return path.normalize(specifier.slice(2))
  if (specifier.startsWith('.')) return path.normalize(path.join(path.dirname(file), specifier))
  return null
}
function privateRouteOwner(file: string) {
  if (!inRouteTree(file)) return
  const owner = /^((?:.*\/)?)_components(?:\/|$)/.exec(file.slice(PRODUCT_ROUTES.length))?.[1]
  return owner === undefined ? undefined : `${PRODUCT_ROUTES}${owner}`
}
const privateRoute = (file: string) => Boolean(privateRouteOwner(file))

function checkImport(file: string, specifier: string, dynamic = false, typesOnly = false) {
  const target = resolveImport(file, specifier)
  const inPlatform = inPlatformTree(file) || isSystem(file)
  const primitive = isComponent(file)
  const modernPackage =
    file.startsWith('../../packages/emcn') && !file.startsWith('../../packages/emcn-legacy/')
  if (/^@sim\/emcn(?:-auth|-docs|-platform)?$/.test(specifier))
    report('family-import', file, 'Import the public EMCN family subpath')
  if (modernPackage && /^@sim\/emcn-legacy(?:\/|$)/.test(specifier))
    report('legacy-import', file, specifier)
  const packageOwner = packages.find((owner) =>
    path.join(app, file).startsWith(owner.source + path.sep)
  )
  const targetOwnerPackage =
    target && packages.find((owner) => path.join(app, target).startsWith(owner.source + path.sep))
  if (
    packageOwner &&
    targetOwnerPackage &&
    targetOwnerPackage.name !== '@sim/emcn' &&
    targetOwnerPackage.name !== packageOwner.name
  )
    report(
      'design-dependency',
      file,
      'Surface packages compose Shared, never another surface package'
    )
  if (modernPackage && target && !target.startsWith('../../packages/'))
    report('design-dependency', file, 'EMCN packages cannot import application code')
  if (inPlatform && /^@base-ui\/react(?:\/|$)/.test(specifier) && !primitive)
    report('primitive-owner', file, 'Use the Platform component that owns this Base UI primitive')
  if (
    !typesOnly &&
    (primitive || inRouteTree(file)) &&
    target?.replace(/\.tsx?$/, '') === `${system}catalog/component-recipe`
  )
    report(
      'specimen-owner',
      file,
      'Render an EMCN component; static Paper specimens belong in the workbench'
    )
  const targetOwner = target && privateRouteOwner(target)
  if (target?.endsWith('.module.css') && (targetOwner || isComponent(target))) {
    const sameFamily = path.dirname(file) === path.dirname(target)
    const sharedPrimitiveRecipe =
      primitive && isComponent(target) && target.endsWith('.shared.module.css')
    if (!sameFamily && !sharedPrimitiveRecipe)
      report('private-recipe', file, `Use the component that owns ${specifier}; its CSS is private`)
  }
  if (targetOwner) {
    const dataContract =
      typesOnly && (file.startsWith('platform/fixtures/') || file.startsWith(dataSeam))
    if (!file.startsWith(targetOwner) && !dataContract)
      report('private-composition', file, `Promote ${specifier} before using it outside its route`)
  }
  const inSeam = file.startsWith(dataSeam) || file.startsWith('platform/shared/')
  const seamTarget =
    inSeam &&
    target !== null &&
    (grants('seamHelpers', target) ||
      (runsOnServer(file) && grants('serverSeamHelpers', target)) ||
      seamRoots.some((root) => target === root || target.startsWith(`${root}/`)))
  // Shared helpers stay pure; a shared model may name the design system's icon or menu types.
  const sharedNamesDesignSystemType = typesOnly && Boolean(target && isSystem(target))
  if (
    file.startsWith('platform/shared/') &&
    target &&
    /^platform\/(?!shared\/)/.test(target) &&
    !sharedNamesDesignSystemType
  )
    report('shared-import', file, `platform/shared may only import itself: ${specifier}`)
  // The e2e scripts share the Platform checks' browser helpers; neither ships to users.
  const scriptTakesCheckHelper = file.startsWith('scripts/') && target === `${platform}checks/test`
  if (
    (target &&
      !scriptTakesCheckHelper &&
      (((target === 'platform' || inPlatformTree(target)) && !inPlatform) ||
        (inPlatform &&
          !inPlatformTree(target) &&
          !isSystem(target) &&
          !grants('platformHostModules', target))) &&
      !seamTarget &&
      file !== PRODUCT_ROOT_LAYOUT) ||
    (inPlatform &&
      file !== PRODUCT_ROOT_LAYOUT &&
      /^@sim\/(?!utils(?:\/|$)|emcn(?:-platform)?(?:\/|$))/.test(specifier) &&
      !(inSeam && seamPackages.test(specifier)) &&
      !(workflowSeam.test(file) && workflowSeamPackages.test(specifier)) &&
      // Tests take the repo's shared mocks, which never ship.
      !(/\.test\.tsx?$/.test(file) && /^@sim\/testing(?:\/|$)/.test(specifier)) &&
      // The live checks refuse to seed anything but a disposable test database.
      !(
        file.startsWith(`${platform}checks/live/`) &&
        specifier === '@sim/db/testing/test-infrastructure'
      ) &&
      !(
        file === `${PRODUCT_ROUTES}_components/desktop/desktop-host.tsx` &&
        specifier === '@sim/desktop-bridge'
      ))
  ) {
    report('legacy-import', file, specifier)
  }
  if (
    target &&
    /^platform\/fixtures\/(?!index(?:\.|$)|types(?:\.|$))/.test(target) &&
    !(file === 'platform/fixtures/index.ts' && dynamic) &&
    !(file.startsWith('platform/fixtures/settings/') && target.startsWith('platform/fixtures/')) &&
    !(file.startsWith('platform/fixtures/') && target === 'platform/fixtures/clock') &&
    !(
      /^platform\/fixtures\/[\w-]+-data\.ts$/.test(file) &&
      target.startsWith('platform/fixtures/media/') &&
      /\.(?:png|jpe?g|webp)$/.test(target)
    )
  ) {
    report(
      'fixture-boundary',
      file,
      'Only the flagged server loader may dynamically import fixture data'
    )
  }
  if (isSystem(file) && target && inPlatformTree(target) && !isSystem(target)) {
    report('design-dependency', file, specifier)
  }
}

const tokens = new Set<string>()
const themeTokens = new Set<string>()
const layoutUtilities = new Set([
  'block',
  'inline-block',
  'inline',
  'contents',
  'hidden',
  'flex',
  'inline-flex',
  'grid',
  'flex-none',
  'flex-1',
  'flex-col',
  'flex-row',
  'flex-wrap',
  'shrink-0',
  'min-w-0',
  'min-h-0',
  'items-start',
  'items-end',
  'items-center',
  'items-stretch',
  'justify-start',
  'justify-center',
  'justify-end',
  'justify-between',
  'relative',
  'absolute',
  'overflow-hidden',
  'overflow-auto',
])
function themeUtility(utility: string) {
  if (layoutUtilities.has(utility)) return true
  const match =
    /^(gap(?:-[xy])?|p[xytrbl]?|m[xytrbl]?|rounded|bg|border|text)-([a-z][a-z0-9-]*)$/.exec(utility)
  if (!match) return false
  const [, kind, role] = match
  const namespace =
    kind === 'rounded' ? 'radius' : ['bg', 'border', 'text'].includes(kind) ? 'color' : 'spacing'
  return themeTokens.has(`--${namespace}-${role}`)
}
const positionerMeasurements = new Set([
  '--anchor-width',
  '--available-width',
  '--available-height',
])
const sheets = new Map<string, postcss.Root>()
const classOwners = new Map<string, Set<string>>()
const variantProps = new Set(Object.values(variants).flatMap((props) => Object.keys(props)))
function checkCss(file: string, sheet: postcss.Root) {
  const base = isFoundation(file) || file === 'platform/styles/bootstrap.css'
  if (!base && (!(isSystem(file) || privateRoute(file)) || !file.endsWith('.module.css'))) {
    report('css-owner', file, 'Move the recipe into its design owner')
  }
  sheet.walkAtRules((rule) => {
    if (rule.name === 'import' || rule.name === 'reference') {
      const specifier = rule.params.match(/(?:url\()?['"]([^'"]+)['"]/)?.[1]
      if (specifier)
        checkImport(
          file,
          specifier.startsWith('@') || !specifier.endsWith('.css') ? specifier : `./${specifier}`
        )
    }
    if (rule.name === 'apply') {
      if (
        (!isSystem(file) && !privateRoute(file)) ||
        rule.params.split(/\s+/).some((utility) => !themeUtility(utility))
      )
        report(
          'utility-token',
          file,
          `Use a structural utility or a named theme role: ${rule.params}`
        )
    }
    if (!base && ['import', 'theme', 'tailwind'].includes(rule.name)) {
      report('css-owner', file, `@${rule.name} outside foundations`)
    }
  })
  sheet.walkRules((rule) => {
    if (
      !/(?::focus(?:-visible|-within)?\b|\[data-focus(?:ed|-visible)?(?:\]|[=\s]))/i.test(
        rule.selector
      )
    )
      return
    if (
      file === `${system}styles/platform.css` &&
      rule.selector === '[data-platform-ui] :focus' &&
      rule.nodes.every(
        (node) => node.type === 'decl' && node.prop === 'outline' && node.value === 'none'
      )
    )
      return
    // Keyboard focus is visible, as review on the running app settled. Pointer focus stays unpainted.
    if (/:focus-visible/.test(rule.selector) && !/:focus(?!-visible)/.test(rule.selector)) return
    if (
      file === `${shared}components/search-field/search-field.module.css` &&
      rule.selector === '.search:is(:hover, :focus-within) .queryFrame::after' &&
      rule.nodes.every(
        (node) =>
          node.type === 'decl' &&
          node.prop === 'border-block-end-color' &&
          node.value === 'var(--control-hover-border)'
      )
    )
      return
    if (
      file === `${shared}styles/global.css` &&
      rule.selector === '[data-platform-ui] :focus' &&
      rule.nodes.every(
        (node) => node.type === 'decl' && node.prop === 'outline' && node.value === 'none'
      )
    )
      return
    report(
      'focus-style',
      file,
      `DOM focus preserves the recipe's resting appearance: ${rule.selector}`
    )
  })
  if (!base) {
    sheet.walkRules((rule) => {
      for (const selector of rule.selectors) {
        const owners = [...selector.matchAll(/\.([\w-]+)/g)].flatMap(([, name]) => [
          ...(classOwners.get(`${file}.${name}`) ?? []),
        ])
        for (const [, prop, value] of selector.matchAll(
          /\[data-([\w-]+)\s*=\s*['"]?([\w-]+)['"]?\]/g
        )) {
          if (
            variantProps.has(prop) &&
            !(owners.length ? owners : Object.keys(variants)).some(
              (owner) => variants[owner]?.[prop]?.[value]
            )
          ) {
            report('variant-selector', file, `${selector} has no declared variant`)
          }
        }
      }
    })
  }
  sheet.walkDecls((declaration) => {
    const { prop, value, source, parent } = declaration
    if (
      privateRoute(file) &&
      /^(?:stroke(?:-width)?|fill)$/.test(prop) &&
      parent?.type === 'rule' &&
      parent.selectors.some((selector) => /\bsvg\s|\[data-interface-icon\]/.test(selector))
    ) {
      report(
        'icon-owner',
        `${file}:${source?.start?.line ?? 1}`,
        'Use the shared glyph ink and stroke; put chart paint on its own marks'
      )
    }
    if (prop === 'composes') {
      const from = value.match(/\bfrom\s+['"]([^'"]+)['"]/u)?.[1]
      if (from) checkImport(file, from)
    }
    const location = `${file}:${source?.start?.line ?? 1}`
    for (const [, token] of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const positioned = isComponent(file) && positionerMeasurements.has(token)
      const columnWidth = token === '--column-width' && file.startsWith(COLUMN_WIDTH_OWNER)
      const canvasToken = file.startsWith(WORKFLOW_CANVAS) && workflowCanvasTokens.has(token)
      if (!tokens.has(token) && !positioned && !columnWidth && !canvasToken)
        report('unknown-token', location, token)
    }
    if (base) return
    if (
      /^(?:transition|animation)(?:-|$)/.test(prop) &&
      /(?:^|[^\w-])(?:\d*\.)?\d+(?:ms|s)\b/.test(value)
    )
      report('motion-timing', location, 'Use the shared motion duration instead of a local time')
    if (
      (prop === 'opacity' && /^(?:0)?\.\d+$/.test(value)) ||
      (/^(?:font(?:-family|-weight|-size)?|line-height|letter-spacing)$/.test(prop) &&
        !value.includes('var(') &&
        !/^(?:inherit|normal|initial|unset|0)$/.test(value))
    ) {
      report('untokenized-style', location, `Use a foundation recipe: ${prop}: ${value}`)
    }
    if (
      prop.startsWith('--') &&
      !file.startsWith(WORKFLOW_CANVAS) &&
      !grants('LOCAL_TOKEN_OWNERS', file)
    )
      report('css-owner', location, 'Token definitions belong in foundations')
    const literal = value.replace(/url\([^)]*\)|--[\w-]+|"[^"]*"|'[^']*'/gi, '')
    if (
      /(?:^|[^\w-])#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|(?:ok)?lch|(?:ok)?lab|color|device-cmyk)\(/i.test(
        literal
      ) ||
      [...literal.matchAll(/\b[a-z]+\b/gi)].some(
        ([word]) => !/^(transparent|currentcolor)$/i.test(word) && Bun.color(word, 'hex') !== null
      )
    ) {
      report('raw-color', location, `Use a color token: ${value}`)
    }
    if (
      [...literal.matchAll(/(-?(?:\d*\.)?\d+)(?:px|pt|rem|em|ch)\b/gi)].some(
        ([, length]) => Number(length) !== 0
      )
    )
      if (!grants('FRAMES_OUTSIDE_SURFACE', file))
        report('raw-geometry', location, `Use a foundation token: ${value}`)
  })
}

const sourceFiles = [
  ...files(),
  ...packages.flatMap((owner) =>
    existsSync(owner.source) ? files(path.relative(app, owner.source)) : []
  ),
]
const program = ts.createProgram(
  sourceFiles
    .filter(
      (file) =>
        (inPlatformTree(file) || isSystem(file)) &&
        /\.tsx?$/.test(file) &&
        !file.startsWith('platform/checks/')
    )
    .map((file) => path.join(app, file)),
  {
    strictNullChecks: true,
    types: [],
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: {
      '@/platform/*': [path.join(app, 'platform/*')],
      [`@/${PRODUCT_ROUTES}*`]: [path.join(app, `${PRODUCT_ROUTES}*`)],
      ...emcnTypeScriptPaths(packages),
    },
  }
)
const checker = program.getTypeChecker()

type ElementTag = ts.JsxOpeningElement | ts.JsxSelfClosingElement

function jsxAttribute(node: ElementTag, name: string) {
  return node.attributes.properties.find(
    (attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && attr.name.getText() === name
  )
}

function jsxValue(node: ts.Node | undefined): string | undefined {
  if (!node) return
  if (ts.isJsxText(node) || ts.isStringLiteralLike(node)) return node.text.trim()
  if (ts.isJsxExpression(node) && node.expression) {
    const type = checker.getTypeAtLocation(node.expression)
    return type.isStringLiteral() ? type.value.trim() : `{${node.expression.getText()}}`
  }
}

function componentName(node: ElementTag) {
  const tag = node.tagName.getText()
  if (/^[a-z][\w-]*$/.test(tag)) return tag
  let symbol = checker.getSymbolAtLocation(node.tagName)
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
  const file = symbol?.valueDeclaration?.getSourceFile().fileName
  if (file && isComponent(path.relative(app, file))) return symbol?.name
}

function checkDialog(node: ElementTag, location: (node: ts.Node) => string) {
  const name = componentName(node)
  const reject = (part: ts.Node) =>
    report(
      'dialog-owner',
      location(part),
      'Use Modal or MultiStepModal for form titles, actions and cancellation'
    )
  if (name === 'ModalHeader' || name === 'ModalFooter') return reject(node)
  const role = jsxValue(jsxAttribute(node, 'role')?.initializer)
  const formModal = name === 'Modal' || name === 'MultiStepModal'
  if (
    !formModal &&
    name !== 'dialog' &&
    name !== 'OverlayDialog' &&
    role !== 'dialog' &&
    role !== 'alertdialog'
  )
    return
  const title = jsxValue(jsxAttribute(node, 'title')?.initializer)
  if (name === 'OverlayDialog') {
    const presentation = jsxAttribute(node, 'presentation')
    const command = jsxValue(presentation?.initializer) === 'command'
    if ((presentation && !command) || jsxAttribute(node, 'onSubmit')) reject(node)
    if (!(command ? jsxValue(jsxAttribute(node, 'label')?.initializer) : title))
      report(
        'dialog-name',
        location(node),
        'Give the dialog a title or the command palette an accessible label'
      )
    if (command) return
  }
  function inspect(child: ts.Node) {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      const tag = ts.isJsxElement(child) ? child.openingElement : child
      const part = componentName(tag)
      const label =
        ts.isJsxElement(child) && child.children.length === 1
          ? jsxValue(child.children[0])
          : undefined
      if (
        part === 'form' ||
        ((part === 'Button' || part === 'button') &&
          ((formModal && label === 'Cancel') ||
            jsxValue(jsxAttribute(tag, 'type')?.initializer) === 'submit')) ||
        (formModal && title && label === title && /^h[1-6]$/.test(part ?? ''))
      )
        reject(tag)
    }
    ts.forEachChild(child, inspect)
  }
  if (ts.isJsxOpeningElement(node)) node.parent.children.forEach(inspect)
  const steps = jsxAttribute(node, 'steps')?.initializer
  if (name === 'MultiStepModal' && steps) inspect(steps)
}

const svgOwners = new Map<string, readonly string[]>([
  [`${shared}components/icon/icon.tsx`, ['Icon']],
  [`${shared}components/brand/wordmark.tsx`, ['Wordmark']],
  [`${shared}components/brand/provider-icon.tsx`, ['GoogleIcon', 'MicrosoftIcon', 'GithubIcon']],
])

function checkProps(name: string, node: ts.Node, file: string, owner: boolean) {
  const choices = new Map<string, Set<string | null>>()
  const type = checker.getTypeAtLocation(node)
  for (const shape of type.isUnion() ? type.types : [type]) {
    for (const member of shape.getProperties()) {
      const prop = member.getName()
      if (
        ['style', 'className', 'css', 'sx'].includes(prop) &&
        file !== FLOW_CANVAS &&
        !(
          prop === 'className' &&
          (svgOwners.get(file)?.includes(name) ||
            (file === `${shared}components/brand/provider-icon.tsx` && name === 'ProviderIcon'))
        )
      )
        report('style-api', file, prop)
      if (
        !variants[name]?.[prop] &&
        !(owner && ['variant', 'size', 'tone', 'appearance', 'density'].includes(prop))
      )
        continue
      const values = choices.get(prop) ?? new Set<string | null>()
      const value = checker.getTypeOfSymbolAtLocation(member, node)
      for (const option of value.isUnion() ? value.types : [value]) {
        if (!(option.flags & ts.TypeFlags.Undefined))
          values.add(option.isStringLiteral() ? option.value : null)
      }
      choices.set(prop, values)
    }
  }
  for (const [prop, values] of choices) {
    declarations.add(`${name}.${prop}`)
    const expected = Object.keys(variants[name]?.[prop] ?? {})
    if (
      !expected.length ||
      expected.length !== values.size ||
      !expected.every((value) => values.has(value))
    ) {
      report('variant-declaration', file, `${name}.${prop}: declare only cataloged variant values`)
    }
  }
}

function isTypesOnly(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) return node.isTypeOnly
  const bindings = node.importClause?.namedBindings
  return Boolean(
    node.importClause?.isTypeOnly ||
      (bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length &&
        bindings.elements.every((binding) => binding.isTypeOnly) &&
        !node.importClause?.name)
  )
}

function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest)
  const found: string[] = []
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!isTypesOnly(node)) found.push(node.moduleSpecifier.text)
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text)
    } else if (
      // Webpack bundles an inline `require` as it would an import.
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function resolveSource(file: string, specifier: string): string | null {
  const target = resolveImport(file, specifier)
  if (!target) return null
  for (const suffix of ['', '.ts', '.tsx', '.cjs', '/index.ts', '/index.tsx']) {
    if (statSync(path.join(app, target + suffix), { throwIfNoEntry: false })?.isFile())
      return target + suffix
  }
  return null
}

/**
 * Walks what the seam actually bundles, past the modules it names directly. A `.tsx` under `@/app`
 * or `@/components` is legacy UI riding in behind a hook, and so is any import of the legacy EMCN
 * barrel. The workflow seam is walked under its own exception; every other seam must reach neither
 * the block, tool or trigger registry nor legacy views, which holds the real workflow stores behind
 * `stores/workflows/state-port`. The walk starts from every seam module, `platform/shared`, and each
 * `platformHostModules` entry, which views import directly. A server-only module is not walked from:
 * it never reaches a browser bundle.
 */
function checkSeamClosure() {
  const hostModules = Object.keys(allowlists.platformHostModules ?? {}).flatMap(
    (entry) => resolveSource('', `@/${entry}`) ?? []
  )
  /** A host module's own family folder (`components/file-viewer/`) is part of that host. */
  const hostFamilies = hostModules.flatMap(
    (file) => /^(?:components|app)\/[^/]+\//.exec(file)?.[0] ?? []
  )
  const roots = [...files(dataSeam), ...files('platform/shared/'), ...hostModules].filter(
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !isServerOnly(file)
  )
  walkSeam(
    roots.filter((file) => workflowSeam.test(file)),
    true
  )
  walkSeam(
    roots.filter((file) => !workflowSeam.test(file)),
    false
  )

  function walkSeam(seeds: string[], workflow: boolean) {
    const visited = new Set<string>(seeds)
    const queue = [...seeds]
    for (let file = queue.pop(); file; file = queue.pop()) {
      for (const specifier of runtimeImports(file)) {
        // Logic modules name glyphs from the legacy icon set (block configs, table column types,
        // enrichments). Icons are not chrome, and product views never import them directly.
        if (specifier === '@sim/emcn-legacy/icons') continue
        if (/^@sim\/emcn-legacy(?:\/|$)/.test(specifier)) {
          report('seam-closure', file, `The data seam bundles legacy EMCN: ${specifier}`)
          continue
        }
        const target = resolveSource(file, specifier)
        if (!target || visited.has(target)) continue
        visited.add(target)
        queue.push(target)
        const view = /^(?:app|components|ee\/[^/]+\/components)\/.*\.tsx$/.test(target)
        const allowedView =
          view &&
          (hostFamilies.some((family) => target.startsWith(family)) ||
            grants('seamClosureViews', target) ||
            (workflow &&
              (workflowClosureGlyphs.test(target) || grants('workflowClosureViews', target))))
        if ((seamClosureBanned.test(target) && !workflow) || (view && !allowedView))
          report(
            'seam-closure',
            target,
            `The data seam bundles this legacy module through ${file}; cut that edge`
          )
      }
    }
    return visited
  }
}

/**
 * Copy that announces a pending read: `Loading`, its synonyms, `Please wait`, and a `Saving…` or
 * `Sending…` status. Any case.
 */
const LOADING_COPY =
  /^(?:(loading|checking|fetching|reading|refreshing|retrieving)\b|please wait\b|(saving|sending)\b.*…$)/i

/**
 * The node a rendered string's value flows out through: past parentheses, conditional branches,
 * the right side of `??`/`||`/`&&`, and the template a head starts.
 */
function valueRoot(node: ts.Node): ts.Node {
  let top = ts.isTemplateHead(node) ? node.parent : node
  while (
    ts.isParenthesizedExpression(top.parent) ||
    (ts.isConditionalExpression(top.parent) && top.parent.condition !== top) ||
    (ts.isBinaryExpression(top.parent) &&
      top.parent.right === top &&
      [
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
      ].includes(top.parent.operatorToken.kind))
  )
    top = top.parent
  return top
}

/** A string branch a Load action shows at rest, such as `Load more` or `Load all`. */
const LOAD_ACTION = /^Load\b(?!ing)/

/** The string leaves of the conditional chain under `root`. */
function conditionalLeaves(root: ts.Node): string[] {
  const leaves: string[] = []
  const collect = (branch: ts.Node) => {
    if (ts.isParenthesizedExpression(branch)) collect(branch.expression)
    else if (ts.isConditionalExpression(branch)) {
      collect(branch.whenTrue)
      collect(branch.whenFalse)
    } else if (ts.isStringLiteralLike(branch)) leaves.push(branch.text.trim())
  }
  collect(root)
  return leaves
}

/**
 * Rendered text (JSX text, a JSX attribute value, a returned string) that announces a pending read.
 * An action's pending label is feedback, not loading copy, so the rule passes one that ends in `…`
 * as a button's text or a `pendingLabel` or `confirmLabel` (`busy ? 'Saving…' : 'Save'`), and the
 * pending branch of a Load action (`busy ? 'Loading…' : 'Load more'`).
 */
function isLoadingCopy(node: ts.Node): boolean {
  const text =
    ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isJsxText(node)
      ? node.text.trim()
      : ''
  // A bare lowercase token such as a `'loading'` variant or status is a value, not copy.
  if (!LOADING_COPY.test(text) || (!ts.isJsxText(node) && /^[a-z][\w-]*$/.test(text))) return false
  const root = ts.isJsxText(node) ? node : valueRoot(node)
  const host = ts.isJsxExpression(root.parent) ? root.parent.parent : root.parent
  const attribute = ts.isJsxAttribute(host) ? host.name.getText() : undefined
  const rendered =
    ts.isJsxText(node) ||
    ts.isJsxExpression(root.parent) ||
    ts.isJsxAttribute(root.parent) ||
    ts.isReturnStatement(root.parent) ||
    (ts.isArrowFunction(root.parent) && root.parent.body === root)
  if (!rendered || !text.endsWith('…')) return rendered
  const buttonText =
    ts.isJsxElement(host) &&
    /(?:^|\.)(?:button|\w*Button)$/.test(host.openingElement.tagName.getText())
  const loadAction =
    /^loading\b/i.test(text) && conditionalLeaves(root).some((leaf) => LOAD_ACTION.test(leaf))
  return !(attribute === 'pendingLabel' || attribute === 'confirmLabel' || buttonText || loadAction)
}

function checkJs(file: string, content: string) {
  const inPlatform = inPlatformTree(file) || isSystem(file)
  if (
    !inPlatform &&
    !content.includes('platform') &&
    !content.includes('@sim/emcn') &&
    !file.startsWith('../../packages/')
  )
    return
  const programSource = program.getSourceFile(path.join(app, file))
  const sf =
    programSource ??
    ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
  const owner = isSystem(file) || privateRoute(file)
  const ownsTimeLabels =
    file === 'platform/shared/time.ts' ||
    file.startsWith('platform/checks/') ||
    /\.test\.[jt]sx?$/.test(file)
  const modules = new Map<string, string>()
  const primitives = new Set<string>()
  const location = (node: ts.Node) =>
    `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
  function ownsSvg(node: ElementTag) {
    const fn = ts.findAncestor(node, ts.isFunctionDeclaration)
    return (
      node.tagName.getText(sf) === 'svg' && fn?.name && svgOwners.get(file)?.includes(fn.name.text)
    )
  }
  function visit(node: ts.Node) {
    if (inPlatform && !ownsTimeLabels) {
      const factory =
        ts.isNewExpression(node) || ts.isCallExpression(node) ? node.expression : undefined
      const readingZone =
        factory &&
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name.text === 'resolvedOptions'
      if (
        (factory &&
          !readingZone &&
          (/^Intl\.(?:DateTimeFormat|RelativeTimeFormat)$/.test(factory.getText(sf)) ||
            (ts.isPropertyAccessExpression(factory) &&
              (/^toLocale(?:Date|Time)String$/.test(factory.name.text) ||
                (factory.name.text === 'toLocaleString' &&
                  checker.getNonNullableType(checker.getTypeAtLocation(factory.expression)).symbol
                    ?.name === 'Date'))))) ||
        ((ts.isStringLiteralLike(node) || ts.isTemplateTail(node)) &&
          /(?:\d+\s*|^)(?:m|mins?|minutes?|h|hrs?|hours?|d|days?) ago$/i.test(node.text.trim()))
      ) {
        report(
          'time-format',
          location(node),
          'Use the shared Platform time formatter and supply raw dates'
        )
      }
    }
    if (inPlatform && !ownsTimeLabels && isLoadingCopy(node)) {
      if (!grants('LOADING_COPY_OWNERS', file))
        report(
          'loading-copy',
          location(node),
          `Loading paints nothing: render no copy while the read is pending (${node.getText(sf).trim()})`
        )
    }
    if (
      inPlatform &&
      (owner || inRouteTree(file)) &&
      ts.isCallExpression(node) &&
      /^(?:(?:globalThis|window)\.)?setTimeout$/.test(node.expression.getText()) &&
      node.arguments[1] &&
      ts.isNumericLiteral(node.arguments[1])
    )
      report(
        'feedback-timing',
        location(node),
        'Use shared feedback expiry or a named timing policy'
      )
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier
      if (specifier && ts.isStringLiteral(specifier)) {
        checkImport(file, specifier.text, false, isTypesOnly(node))
        if (
          specifier.text === 'next/link' &&
          ts.isImportDeclaration(node) &&
          node.importClause?.name
        ) {
          primitives.add(node.importClause.name.text)
        }
        if (ts.isImportDeclaration(node) && /^@base-ui\/react(?:\/|$)/.test(specifier.text)) {
          const bindings = node.importClause?.namedBindings
          if (bindings && ts.isNamespaceImport(bindings)) primitives.add(bindings.name.text)
          else if (bindings) {
            for (const binding of bindings.elements) primitives.add(binding.name.text)
          }
        }
        if (ts.isImportDeclaration(node) && specifier.text.startsWith('@radix-ui/react-')) {
          const bindings = node.importClause?.namedBindings
          if (bindings && ts.isNamespaceImport(bindings)) primitives.add(bindings.name.text)
          if (specifier.text === '@radix-ui/react-popover') {
            tokens.add('--radix-popover-trigger-width')
            tokens.add('--radix-popover-content-available-height')
          }
        }
        if (
          ts.isImportDeclaration(node) &&
          node.importClause?.name &&
          specifier.text.endsWith('.module.css')
        ) {
          modules.set(
            node.importClause.name.text,
            resolveImport(file, specifier.text) ?? specifier.text
          )
        }
      }
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const [specifier] = node.arguments
      if (specifier && ts.isStringLiteralLike(specifier))
        checkImport(file, specifier.text, node.expression.kind === ts.SyntaxKind.ImportKeyword)
    }
    if (
      inPlatform &&
      !file.startsWith('platform/checks/') &&
      (ts.isStringLiteralLike(node) || ts.isJsxText(node)) &&
      /\b(?:in this preview|in preview mode|in this demo)\b/i.test(node.text)
    )
      report('product-copy', location(node), 'Keep development-mode messaging out of the product')
    if (inPlatform && ts.isJsxSpreadAttribute(node) && !ownsSvg(node.parent.parent))
      report('prop-spread', location(node), 'Pass named props explicitly')
    if (
      inPlatform &&
      !isSystem(file) &&
      ts.isCallExpression(node) &&
      node.arguments.length > 1 &&
      /^(?:React\.)?(?:cloneElement|createElement)$/.test(node.expression.getText(sf))
    )
      report('prop-spread', location(node), 'Render the component with its named props')
    if (inPlatform && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
      const tag = node.tagName.getText(sf)
      if (programSource && inRouteTree(file)) checkDialog(node, location)
      if (
        tag === 'svg' &&
        !ownsSvg(node) &&
        !isCatalog(file) &&
        !node.attributes.properties.some(
          (attr) =>
            ts.isJsxAttribute(attr) &&
            ['aria-label', 'aria-labelledby'].includes(attr.name.getText(sf))
        )
      ) {
        report(
          'icon-owner',
          location(node),
          'Use Icon for interface glyphs; give an original data graphic an accessible name'
        )
      }
      if (tag === 'select')
        report('native-picker', location(node), 'Use the shared Platform value picker')
      const native = /^[a-z][\w-]*$/.test(tag) || (owner && primitives.has(tag.split('.')[0]))
      if (
        tag === 'style' ||
        (tag === 'link' &&
          node.attributes.properties.some((prop) => {
            if (!ts.isJsxAttribute(prop) || prop.name.getText(sf) !== 'rel') return false
            const value =
              prop.initializer && ts.isJsxExpression(prop.initializer)
                ? prop.initializer.expression
                : prop.initializer
            return (
              !value ||
              !ts.isStringLiteralLike(value) ||
              value.text.toLowerCase().split(/\s+/).includes('stylesheet')
            )
          }))
      )
        report('consumer-style', location(node), 'Load styles through the isolated CSS owners')

      for (const prop of node.attributes.properties) {
        if (!ts.isJsxAttribute(prop)) continue
        const attr = prop.name.getText(sf)
        if (['style', 'css', 'sx', 'className'].includes(attr)) {
          const expr =
            prop.initializer && ts.isJsxExpression(prop.initializer) && prop.initializer.expression
          const isLocalClass = (value: ts.Expression): boolean =>
            ((ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) &&
              ts.isIdentifier(value.expression) &&
              modules.has(value.expression.text)) ||
            (ts.isConditionalExpression(value) &&
              isLocalClass(value.whenTrue) &&
              isLocalClass(value.whenFalse)) ||
            (ts.isTemplateExpression(value) &&
              value.templateSpans.every((span) => isLocalClass(span.expression)))
          const localClass = expr && isLocalClass(expr)
          if (native && owner && localClass && expr && ts.isPropertyAccessExpression(expr)) {
            const fn = ts.findAncestor(node, ts.isFunctionDeclaration)
            if (fn?.name && variants[fn.name.text]) {
              const key = `${modules.get(expr.expression.getText(sf))}.${expr.name.text}`
              const owners = classOwners.get(key) ?? new Set<string>()
              owners.add(fn.name.text)
              classOwners.set(key, owners)
            }
          }
          const calendarPlacement =
            file === CALENDAR_DAY &&
            native &&
            attr === 'style' &&
            expr &&
            ts.isObjectLiteralExpression(expr) &&
            expr.properties.every(
              (property) =>
                ts.isPropertyAssignment(property) &&
                (property.name.getText(sf) === 'visibility' ||
                  (property.name.getText(sf) === 'gridRow' &&
                    ts.isCallExpression(property.initializer) &&
                    property.initializer.expression.getText(sf) === 'timeSlot'))
            )
          if (
            !calendarPlacement &&
            !(file === FLOW_CANVAS && attr === 'className' && localClass) &&
            !(file.startsWith(COLUMN_WIDTH_OWNER) && attr === 'style') &&
            !(native && attr === 'className' && owner && localClass) &&
            !(ownsSvg(node) && attr === 'className')
          ) {
            report('consumer-style', location(prop), `${tag}.${attr}: pass a named variant`)
          }
        }
        if (
          (!owner || !native) &&
          /^(?:data-(?:type(?:-light|-dark)?|elevation|material|recipe|paper-recipe|platform-ui|theme|variant|size|organization|density|axis|edges)|fill|stroke)$/.test(
            attr
          )
        ) {
          report('consumer-style', location(prop), attr)
        }
      }
    }
    if (programSource && inPlatform) {
      if (
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
        node.name.text.endsWith('Props')
      ) {
        checkProps(node.name.text.slice(0, -5), node, file, owner)
      } else if (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) {
        const fn = ts.isFunctionDeclaration(node)
          ? node
          : node.initializer &&
              (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))
            ? node.initializer
            : undefined
        if (fn && node.name && ts.isIdentifier(node.name)) {
          const name = node.name.text
          if (owner && ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export)
            exportedOwners.add(name)
          if (/^[A-Z]/.test(name) && fn.parameters[0])
            checkProps(name, fn.parameters[0], file, owner)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}
for (const file of sourceFiles) {
  if (packageSources.some((owner) => file.startsWith(`${owner}features/`)))
    report('feature-owner', file, 'Colocate product UI in the owning route’s _components directory')
  if (
    (packageSources.some(
      (owner) =>
        file.startsWith(`${owner}components/`) &&
        !file.slice(`${owner}components/`.length).includes('/')
    ) &&
      !file.endsWith('/index.ts')) ||
    (inRouteTree(file) && /\/_components\/[^/]+\.module\.css$/.test(file))
  )
    report(
      'component-folder',
      file,
      'Colocate the component and its CSS in their owning family folder'
    )
  const source = read(file)
  if (!file.endsWith('.css')) checkJs(file, source)
  else if (inPlatformTree(file) || isSystem(file)) {
    const sheet = postcss.parse(source, { from: file })
    sheets.set(file, sheet)
    if (file.startsWith(WORKFLOW_CANVAS))
      sheet.walkDecls(/^--/, (decl) => {
        workflowCanvasTokens.add(decl.prop)
      })
    if (isFoundation(file) || file === 'platform/styles/bootstrap.css')
      sheet.walkDecls(/^--/, (decl) => {
        tokens.add(decl.prop)
        if (decl.parent?.type === 'atrule' && decl.parent.name === 'theme')
          themeTokens.add(decl.prop)
      })
  } else if (source.includes('platform')) {
    const sheet = postcss.parse(source, { from: file })
    sheet.walkAtRules('import', (rule) => {
      const specifier = rule.params.match(/['"]([^'"]+)['"]/)?.[1]
      if (specifier) checkImport(file, specifier)
    })
    sheet.walkDecls('composes', (decl) => {
      const specifier = decl.value.match(/\bfrom\s+['"]([^'"]+)['"]/)?.[1]
      if (specifier) checkImport(file, specifier)
    })
  }
}
for (const [file, sheet] of sheets) checkCss(file, sheet)
for (const row of evidence) {
  if (
    !exportedOwners.has(row.owner) ||
    (row.owner === 'ComponentRecipe' && !Object.hasOwn(recipes, row.key))
  ) {
    report('recipe-owner', evidencePath, `${row.key} has no implementation for ${row.owner}`)
  }
}
for (const [name, props] of Object.entries(variants)) {
  for (const prop of Object.keys(props)) {
    if (!declarations.has(`${name}.${prop}`))
      report('variant-declaration', variantsPath, `${name}.${prop} has no component declaration`)
  }
}
const usage = productUsage(app, program)
for (const key of usage.recipes) {
  for (const child of Object.values(recipes[key]?.slots ?? {})) {
    if (keys.has(child)) usage.recipes.add(child)
  }
}
for (const [name, props] of Object.entries(variants)) {
  for (const [prop, choices] of Object.entries(props)) {
    for (const [value, ids] of Object.entries(choices)) {
      const id = `${name}.${prop}=${value}`
      if (!usage.variants.has(id) && !ids.some((key) => usage.recipes.has(key))) {
        report('code-use', variantsPath, `${id}: no consumer reachable from a product page`)
      }
    }
  }
}
checkSeamClosure()

for (const finding of allowlistReasonFindings(allowlists))
  report('allowlist-reason', 'scripts/platform-allowlists.ts', finding)
for (const finding of staleAllowlistFindings(allowlists, consulted))
  report('stale-allowlist', 'scripts/platform-allowlists.ts', finding)

function compareRendered(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}
if (findings.size) {
  process.stderr.write(`${[...findings.keys()].sort(compareRendered).join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `Platform design passed (${keys.size} reachable Paper keys, ${tokens.size} foundation tokens).\n`
  )
}
