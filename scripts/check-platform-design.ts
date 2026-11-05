#!/usr/bin/env bun
/**
 * Enforces the design ownership boundary for the standalone Platform project.
 * A gallery is documentation: only a real Platform screen, or a Base used by one,
 * can establish a variant. Native layout and interactive behavior are checked in the browser.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from '@typescript/typescript6'
import postcss from 'postcss'
import { productUsage } from './platform-variant-usage'

const app = path.resolve(process.argv[2] ?? path.resolve(import.meta.dir, '..'), 'apps/sim')
const platform = 'platform/'
const system = 'platform/design-system/'
const foundation = `${system}styles/`
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
const errors = new Set<string>()
function report(rule: string, file: string, message: string) {
  errors.add(`${file} [${rule}] ${message}`)
}

function* files(dir = ''): Generator<string> {
  for (const item of readdirSync(path.join(app, dir), { withFileTypes: true })) {
    if (item.name.startsWith('.') || ['node_modules', 'dist', 'coverage'].includes(item.name))
      continue
    const file = path.join(dir, item.name)
    if (item.isDirectory()) yield* files(file)
    else if (item.isFile() && /\.(?:[cm]?[jt]sx?|css)$/.test(file)) yield file
  }
}

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
    }
  }
}

const dataSeam = 'platform/lib/data/'
/** Everything under these may cross into the data seam; each wraps a contract or its hook. */
const seamRoots = ['hooks/queries', 'lib/api']
/** Named pure helpers the seam needs. Their import closures reach no `@/app` or `@/components`. */
const seamHelpers = new Set([
  'components/settings/use-settings-browser-navigation',
  'components/settings/use-settings-leave-links',
  'components/settings/use-settings-unsaved-guard',
  'ee/access-requests/components/search-params',
  'ee/access-requests/components/status',
  'ee/access-requests/lib/constants',
  'ee/access-requests/lib/navigation',
  'ee/access-requests/lib/policy-description',
  'ee/access-requests/lib/targets',
  'ee/organization-usage/constants',
  'ee/organization-usage/format',
  'ee/organization-usage/hooks/use-usage-window',
  'ee/organization-usage/search-params',
  'ee/scim/hooks/scim',
  'ee/whitelabeling/form',
  'ee/whitelabeling/hooks/whitelabel',
  'hooks/use-before-unload-while',
  'hooks/use-debounce',
  'hooks/use-debounced-search-setter',
  'hooks/use-desktop-update-state',
  'hooks/use-is-mobile',
  'hooks/use-profile-picture-upload',
  'hooks/use-search-filter-value',
  'hooks/use-seed-deployment-shape',
  'hooks/use-settings-search',
  'hooks/use-url-sort',
  'lib/auth/browser-storage',
  'lib/auth/client',
  'lib/auth/session-context',
  'lib/auth/oauth-provider',
  'lib/auth/session-expiry',
  'lib/billing/constants',
  'lib/billing/core/organization-activity',
  'lib/billing/credits/conversion',
  'lib/billing/invoices',
  'lib/billing/on-demand',
  'lib/billing/plan-helpers',
  'lib/billing/subscription-permissions',
  'lib/billing/subscriptions/utils',
  'lib/billing/upgrade-reasons',
  'lib/billing/usage-limit-draft',
  'lib/branding',
  'lib/consent/copy',
  'lib/consent/store-provider',
  'lib/core/config/env',
  'lib/core/config/public-env',
  'lib/core/utils/timezone',
  'lib/core/utils/timezone-picker',
  'lib/core/utils/urls',
  'lib/credential-groups/managed-mcp-connectors',
  'lib/desktop',
  'lib/favicon/url',
  'lib/help-links',
  'lib/help/request',
  'lib/invitations/failure-message',
  'lib/messaging/email/validation',
  'lib/navigation/paths',
  'lib/oauth/utils',
  'lib/organizations/personal-accounts',
  'lib/people/read-sheet',
  'lib/people/search-params',
  'lib/people/validation',
  'lib/sim-links/search-params',
  'lib/sim-links/urls',
  'lib/sim-links/validation',
  'lib/telemetry/browser-preference',
  'lib/uploads/client/download',
  'lib/uploads/client/logo-file',
  'lib/url-state',
  'lib/workspaces/permissions/role-lock',
  'stores/settings/dirty/store',
])
const seamPackages =
  /^@sim\/(?:utils|logger|browser-extension-protocol|platform-authz\/predicates)(?:\/|$)/
function resolveImport(file: string, specifier: string) {
  if (specifier.startsWith('@/')) return path.normalize(specifier.slice(2))
  if (specifier.startsWith('.')) return path.normalize(path.join(path.dirname(file), specifier))
  return null
}
function privateRouteOwner(file: string) {
  return /^(platform\/app\/(?:.*\/)?)_components(?:\/|$)/.exec(file)?.[1]
}
const privateRoute = (file: string) => Boolean(privateRouteOwner(file))

function checkImport(file: string, specifier: string, dynamic = false, typesOnly = false) {
  const target = resolveImport(file, specifier)
  const inPlatform = file.startsWith(platform)
  const primitive = file.startsWith(`${system}components/`)
  if (inPlatform && /^@base-ui\/react(?:\/|$)/.test(specifier) && !primitive)
    report('primitive-owner', file, 'Use the Platform component that owns this Base UI primitive')
  if (
    !typesOnly &&
    (primitive || file.startsWith('platform/app/')) &&
    target?.replace(/\.tsx?$/, '') === `${system}catalog/component-recipe`
  )
    report(
      'specimen-owner',
      file,
      'Render an EMCN component; static Paper specimens belong in the workbench'
    )
  const targetOwner = target && privateRouteOwner(target)
  if (
    target?.endsWith('.module.css') &&
    (targetOwner || target.startsWith(`${system}components/`))
  ) {
    const sameFamily = path.dirname(file) === path.dirname(target)
    const sharedPrimitiveRecipe =
      primitive &&
      target.startsWith(`${system}components/`) &&
      target.endsWith('.shared.module.css')
    if (!sameFamily && !sharedPrimitiveRecipe)
      report('private-recipe', file, `Use the component that owns ${specifier}; its CSS is private`)
  }
  if (targetOwner) {
    const gallery = file.startsWith('platform/preview/')
    const dataContract =
      typesOnly && (file.startsWith('platform/fixtures/') || file.startsWith(dataSeam))
    if (!file.startsWith(targetOwner) && !gallery && !dataContract)
      report('private-composition', file, `Promote ${specifier} before using it outside its route`)
  }
  const workbenchDependency = target && /^platform\/(preview|app\/workbench)(?:\/|$)/.test(target)
  const workbenchConsumer = /^(?:platform\/preview|platform\/app\/workbench)\//.test(file)
  if (inPlatform && workbenchDependency && !workbenchConsumer)
    report('workbench-dependency', file, 'Only the workbench may import its tooling')
  const inSeam = file.startsWith(dataSeam)
  const seamTarget =
    inSeam &&
    target !== null &&
    (seamHelpers.has(target) ||
      seamRoots.some((root) => target === root || target.startsWith(`${root}/`)))
  if (
    (target &&
      (target === 'platform' || target.startsWith(platform)) !== inPlatform &&
      !seamTarget) ||
    (inPlatform &&
      /^@sim\/(?!utils(?:\/|$))/.test(specifier) &&
      !(inSeam && seamPackages.test(specifier)) &&
      !(
        file === 'platform/app/(shell)/_components/desktop/desktop-host.tsx' &&
        specifier === '@sim/desktop-bridge'
      ))
  ) {
    report('legacy-import', file, specifier)
  }
  if (
    target &&
    /^platform\/fixtures\/(?!index(?:\.|$)|types(?:\.|$))/.test(target) &&
    !(file === 'platform/fixtures/index.ts' && dynamic) &&
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
  if (file.startsWith(system) && target?.startsWith(platform) && !target.startsWith(system)) {
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
  const base = file.startsWith(foundation)
  const preview = file.startsWith('platform/preview/')
  if (
    !base &&
    (!(preview || file.startsWith(system) || privateRoute(file)) || !file.endsWith('.module.css'))
  ) {
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
        (!file.startsWith(system) && !privateRoute(file)) ||
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
      file === `${foundation}globals.css` &&
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
  if (!base && !preview) {
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
  if (preview) {
    sheet.walkRules((rule) => {
      if (!rule.selectors.every((selector) => /^\.[\w-]+(?::[\w-]+)*$/.test(selector))) {
        report('preview-selector', file, `Style the preview wrapper directly: ${rule.selector}`)
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
      const positioned =
        file.startsWith(`${system}components/`) && positionerMeasurements.has(token)
      if (!tokens.has(token) && !positioned) report('unknown-token', location, token)
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
    if (prop.startsWith('--'))
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
      report('raw-geometry', location, `Use a foundation token: ${value}`)
  })
}

const sourceFiles = [...files()]
const program = ts.createProgram(
  sourceFiles
    .filter(
      (file) => file.startsWith(platform) && /\.tsx?$/.test(file) && !file.includes('/checks/')
    )
    .map((file) => path.join(app, file)),
  {
    strictNullChecks: true,
    types: [],
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: { '@/platform/*': [path.join(app, 'platform/*')] },
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
  if (file?.startsWith(path.join(app, system, 'components/'))) return symbol?.name
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

function checkProps(name: string, node: ts.Node, file: string, owner: boolean) {
  const choices = new Map<string, Set<string | null>>()
  const type = checker.getTypeAtLocation(node)
  for (const shape of type.isUnion() ? type.types : [type]) {
    for (const member of shape.getProperties()) {
      const prop = member.getName()
      if (['style', 'className', 'css', 'sx'].includes(prop)) report('style-api', file, prop)
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

function checkJs(file: string, content: string) {
  const inPlatform = file.startsWith(platform)
  if (!inPlatform && !content.includes('platform')) return
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
  const owner = file.startsWith(system) || privateRoute(file)
  const preview = file.startsWith('platform/preview/')
  const ownsTimeLabels =
    file === 'platform/lib/time.ts' ||
    file.startsWith('platform/checks/') ||
    /\.test\.[jt]sx?$/.test(file)
  const modules = new Map<string, string>()
  const primitives = new Set<string>()
  const location = (node: ts.Node) =>
    `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
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
    if (
      inPlatform &&
      (owner || file.startsWith('platform/app/')) &&
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
        const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined
        const typesOnly = ts.isExportDeclaration(node)
          ? node.isTypeOnly
          : Boolean(
              node.importClause?.isTypeOnly ||
                (bindings &&
                  ts.isNamedImports(bindings) &&
                  bindings.elements.length &&
                  bindings.elements.every((binding) => binding.isTypeOnly) &&
                  !node.importClause?.name)
            )
        checkImport(file, specifier.text, false, typesOnly)
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
      !preview &&
      !file.startsWith('platform/checks/') &&
      (ts.isStringLiteralLike(node) || ts.isJsxText(node)) &&
      /\b(?:in this preview|in preview mode|in this demo)\b/i.test(node.text)
    )
      report('product-copy', location(node), 'Keep development-mode messaging out of the product')
    if (inPlatform && ts.isJsxSpreadAttribute(node))
      report('prop-spread', location(node), 'Pass named props explicitly')
    if (inPlatform && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
      const tag = node.tagName.getText(sf)
      if (programSource && file.startsWith('platform/app/')) checkDialog(node, location)
      if (
        tag === 'svg' &&
        file !== `${system}components/icon/icon.tsx` &&
        !file.startsWith(catalog) &&
        !preview &&
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
          const localClass =
            expr &&
            (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) &&
            ts.isIdentifier(expr.expression) &&
            modules.has(expr.expression.text)
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
            file === 'platform/app/(shell)/home/_components/calendar/calendar-day.tsx' &&
            native &&
            attr === 'style' &&
            expr &&
            ts.isObjectLiteralExpression(expr) &&
            expr.properties.length === 1 &&
            expr.properties.every(
              (property) =>
                ts.isPropertyAssignment(property) &&
                property.name.getText(sf) === 'gridRow' &&
                ts.isCallExpression(property.initializer) &&
                property.initializer.expression.getText(sf) === 'timeSlot'
            )
          if (
            !calendarPlacement &&
            !(native && attr === 'className' && (owner || preview) && localClass)
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
    if (programSource) {
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
  if (file.startsWith(`${system}features/`))
    report('feature-owner', file, 'Colocate product UI in the owning route’s _components directory')
  if (/^platform\/design-system\/components\/[^/]+$/.test(file) && !file.endsWith('/index.ts'))
    report(
      'component-folder',
      file,
      'Colocate the component and its CSS in their owning family folder'
    )
  const source = read(file)
  if (!file.endsWith('.css')) checkJs(file, source)
  else if (file.startsWith(platform)) {
    const sheet = postcss.parse(source, { from: file })
    sheets.set(file, sheet)
    if (file.startsWith(foundation))
      sheet.walkDecls(/^--/, (decl) => {
        tokens.add(decl.prop)
        if (decl.parent?.type === 'atrule' && decl.parent.name === 'theme')
          themeTokens.add(decl.prop)
      })
  } else if (source.includes('platform')) {
    postcss.parse(source, { from: file }).walkAtRules('import', (rule) => {
      const specifier = rule.params.match(/['"]([^'"]+)['"]/)?.[1]
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
if (errors.size) {
  process.stderr.write(`${[...errors].sort().join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `Platform design passed (${keys.size} reachable Paper keys, ${tokens.size} foundation tokens).\n`
  )
}
