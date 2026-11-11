/**
 * Pure syntax predicates behind `check-platform-design.ts`'s copy and route rules. Each reads one
 * node of a parsed source file, with parent pointers set, and needs no type checker.
 */
import ts from '@typescript/typescript6'

interface RenderedText {
  text: string
  /** The node the value flows out through (see {@link valueRoot}). */
  root: ts.Node
  /** The element or attribute that renders it. */
  host: ts.Node
  /** The attribute the text is the value of, if any. */
  attribute?: string
}

/**
 * The node a string's value flows out through: past parentheses, conditional branches, the right
 * side of `??`/`||`/`&&`, and the template a head starts.
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

/**
 * Text a view renders: JSX text, a JSX attribute value, or a returned string. A bare lowercase
 * token such as a `'loading'` variant or status is a value, not copy.
 */
function renderedText(node: ts.Node): RenderedText | undefined {
  if (ts.isJsxText(node)) {
    const text = node.text.trim()
    return text ? { text, root: node, host: node.parent } : undefined
  }
  if (!ts.isStringLiteralLike(node) && !ts.isTemplateHead(node)) return
  const text = node.text.trim()
  if (!text || /^[a-z][\w-]*$/.test(text)) return
  const root = valueRoot(node)
  const rendered =
    ts.isJsxExpression(root.parent) ||
    ts.isJsxAttribute(root.parent) ||
    ts.isReturnStatement(root.parent) ||
    (ts.isArrowFunction(root.parent) && root.parent.body === root)
  if (!rendered) return
  const host = ts.isJsxExpression(root.parent) ? root.parent.parent : root.parent
  return { text, root, host, attribute: ts.isJsxAttribute(host) ? host.name.getText() : undefined }
}

/**
 * Copy that announces a pending read: `Loading`, its synonyms, `Please wait`, a `Saving…` or
 * `Sending…` status, and a `Preparing`, `Syncing`, `Generating` (and the like) status, which counts
 * only alone or ending in an ellipsis, since `Opening hours` or `Searching tips` is not one. Any case.
 */
const LOADING_COPY =
  /^(?:(?:loading|checking|fetching|reading|refreshing|retrieving)\b|please wait\b|(?:saving|sending)\b.*…$|(?:preparing|connecting|syncing|updating|waiting|opening|searching|generating)(?:$|\b.*(?:…|\.\.\.)$))/i
/** A string branch a Load action shows at rest, such as `Load more` or `Search all options`. */
const LOAD_ACTION = /^(?:Load|Search)\b(?!ing)/

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
 * A string a same-file `const` holds, rendered where that constant is a JSX child or attribute
 * value (`const PENDING = 'Loading…'` … `<p>{PENDING}</p>`). Matched by name within the file only.
 */
function renderedConstant(node: ts.Node): RenderedText | undefined {
  if (!ts.isStringLiteralLike(node)) return
  const text = node.text.trim()
  const declaration = valueRoot(node).parent
  if (
    !text ||
    /^[a-z][\w-]*$/.test(text) ||
    !ts.isVariableDeclaration(declaration) ||
    !ts.isIdentifier(declaration.name) ||
    !(ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const)
  )
    return
  const name = declaration.name
  let found: RenderedText | undefined
  const visit = (child: ts.Node) => {
    if (found) return
    if (
      ts.isIdentifier(child) &&
      child !== name &&
      child.text === name.text &&
      !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child)
    ) {
      const root = valueRoot(child)
      if (ts.isJsxExpression(root.parent)) {
        const host = root.parent.parent
        const attribute = ts.isJsxAttribute(host) ? host.name.getText() : undefined
        found = { text, root, host, attribute }
      }
    }
    ts.forEachChild(child, visit)
  }
  visit(node.getSourceFile())
  return found
}

/** Whether a JSX element acts: it has an `onClick` or `href`, or submits (`submit`, `type="submit"`). */
function isActionable(element: ts.JsxOpeningElement) {
  return element.attributes.properties.some((attribute) => {
    if (!ts.isJsxAttribute(attribute)) return false
    const name = attribute.name.getText()
    if (name === 'onClick' || name === 'href' || name === 'submit') return true
    const value =
      attribute.initializer && ts.isJsxExpression(attribute.initializer)
        ? attribute.initializer.expression
        : attribute.initializer
    return name === 'type' && !!value && ts.isStringLiteralLike(value) && value.text === 'submit'
  })
}

/**
 * Rendered text, or a same-file constant rendered in JSX, that announces a pending read. An
 * action's pending label is feedback, not loading copy, so one that ends in `…` passes as the text
 * of a button that acts (`onClick`, `href`, `submit`; a disabled placeholder `<Button>` does not) or as a `pendingLabel` or `confirmLabel` (`busy ? 'Saving…' : 'Save'`), and as the pending
 * branch of a Load or Search action (`busy ? 'Loading…' : 'Load more'`).
 */
export function isLoadingCopy(node: ts.Node): boolean {
  const rendered = renderedText(node) ?? renderedConstant(node)
  if (!rendered || !LOADING_COPY.test(rendered.text)) return false
  const { text, root, host, attribute } = rendered
  if (!text.endsWith('…')) return true
  const buttonText =
    ts.isJsxElement(host) &&
    /(?:^|\.)(?:button|\w*Button)$/.test(host.openingElement.tagName.getText()) &&
    isActionable(host.openingElement)
  const loadAction =
    /^(?:loading|searching)\b/i.test(text) &&
    conditionalLeaves(root).some((leaf) => LOAD_ACTION.test(leaf))
  return !(attribute === 'pendingLabel' || attribute === 'confirmLabel' || buttonText || loadAction)
}

/** Copy that reports a failed read. */
const LOAD_FAILURE_COPY =
  /^(?:couldn[’']t|could not|failed to|unable to|can[’']t|cannot) (?:load|read|fetch|retrieve|open)\b/i
/** The components that own a failed read's message and its Retry. */
const FAILURE_OWNERS = new Set(['FailureNotice', 'QueryFailure'])

/**
 * JSX text or an attribute value that reports a failed read anywhere but the failure owner
 * (`FailureNotice` from `@sim/emcn/status`, or `QueryFailure`), which pairs it with Retry.
 */
export function isUnownedLoadFailure(node: ts.Node): boolean {
  const rendered = renderedText(node)
  if (!rendered || !LOAD_FAILURE_COPY.test(rendered.text)) return false
  if (ts.isReturnStatement(rendered.root.parent) || ts.isArrowFunction(rendered.root.parent))
    return false
  const element = ts.isJsxAttribute(rendered.host) ? rendered.host.parent.parent : undefined
  const tag =
    element && (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element))
      ? element.tagName.getText()
      : undefined
  return !(tag && FAILURE_OWNERS.has(tag.split('.').pop() ?? tag))
}

/** Whether a string is the value of an object or record property, such as a status label. */
function isPropertyValue(node: ts.Node): boolean {
  if (!ts.isStringLiteralLike(node) && !ts.isTemplateHead(node)) return false
  const root = valueRoot(node)
  return ts.isPropertyAssignment(root.parent) && root.parent.initializer === root
}

/**
 * Rendered copy, or an object or record property's string value (a status or column label), that
 * spells an ellipsis as three periods after a word.
 */
export function hasAsciiEllipsis(node: ts.Node): boolean {
  const text =
    renderedText(node)?.text ??
    (isPropertyValue(node) ? (node as ts.StringLiteralLike | ts.TemplateHead).text : undefined)
  return Boolean(text && /[\p{L}\p{N}]\.\.\.(?!\.)/u.test(text))
}

/**
 * No-results copy that echoes the query or says “found” (`No matching links for “…”`, `No tools
 * found matching …`, `No results for …`). Platform reads No matching {noun}, as Paper does.
 */
export function echoesNoResultsQuery(node: ts.Node): boolean {
  if (!ts.isStringLiteralLike(node) && !ts.isTemplateHead(node) && !ts.isJsxText(node)) return false
  return /^\s*No (?:matching\b.*\b(?:for|found)\b|results for\b|[\p{L} ]+ found matching\b)/u.test(
    node.text
  )
}

/** The last segment of a JSX tag (`Menu.Item` → `Item`). */
function tagName(element: ts.JsxOpeningLikeElement): string {
  const tag = element.tagName.getText()
  return tag.slice(tag.lastIndexOf('.') + 1)
}

/** A JSX attribute's literal string value, unwrapped from a JSX expression container. */
function literalAttribute(element: ts.JsxOpeningLikeElement, name: string): string | undefined {
  const value = element.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name
  )?.initializer
  const expression = value && ts.isJsxExpression(value) ? value.expression : value
  return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined
}

/** A `Modal` opened as a confirmation, which `ConfirmDialog` owns with its pending label. */
export function isHandConfirm(node: ts.Node): boolean {
  return (
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
    tagName(node) === 'Modal' &&
    literalAttribute(node, 'variant') === 'confirm'
  )
}

/** A text `Button` or `Chip` led by a back glyph: a way back that `DirectoryBack` or `DetailHeader` owns. */
export function isHandBack(node: ts.Node): boolean {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return false
  const icon = literalAttribute(node, 'icon')
  return (
    (tagName(node) === 'Button' || tagName(node) === 'Chip') && (icon === 'I093' || icon === 'I140')
  )
}

/** The roles an EMCN primitive owns: tabs (`ContentTabs`) and alerts (`InlineNotice`, `FailureNotice`). */
const OWNED_ROLES = new Set(['tab', 'tablist', 'alert'])

/** The literal `role` a JSX attribute hand-builds, when an EMCN primitive owns it. */
export function handRole(node: ts.Node): string | undefined {
  if (!ts.isJsxAttribute(node) || node.name.getText() !== 'role') return
  const value =
    node.initializer && ts.isJsxExpression(node.initializer)
      ? node.initializer.expression
      : node.initializer
  if (value && ts.isStringLiteralLike(value) && OWNED_ROLES.has(value.text)) return value.text
}

/** Elements whose `title` is their accessible name, not a hover tooltip. */
const TITLED_EMBEDS = new Set(['iframe', 'frame', 'object', 'embed'])

/** A native `title=` tooltip on a DOM element, which `Tooltip` or `OverflowText` owns. */
export function isNativeTitle(node: ts.Node): boolean {
  if (!ts.isJsxAttribute(node) || node.name.getText() !== 'title') return false
  const element = node.parent.parent
  const tag = element.tagName.getText()
  return /^[a-z][\w-]*$/.test(tag) && !TITLED_EMBEDS.has(tag)
}

/** A data property whose value names a control: `label` or any `*Label` (`confirmLabel`, `createLabel`, …). */
const isNamingProperty = (name: string) => name === 'label' || name.endsWith('Label')
/** An attribute whose value names a control or dialog: a naming property, or `title`. */
const isNamingAttribute = (name: string) => name === 'title' || isNamingProperty(name)
/** Controls whose text is their name: a button, a menu or list item, a chip. */
const NAMED_CONTROL = /^(?:button|\w*Button|\w*Item|Chip)$/

/**
 * Capitalized words that stay capitalized mid-label: Sim's products (Chat, Assistant, Search), its
 * plans, the Agent block, brands and services, key names and the calendar. Home and Wiki are
 * destinations Paper capitalizes mid-label (Customize Home, Create a Wiki page); other surfaces
 * that are also tabs or pages (logs, runs, skills, integrations) are common nouns mid-label. An all-caps
 * or mixed-case word (`API`, `SSO`, `OAuth`, `GitHub`) is never read as Title Case, so it needs no
 * entry.
 */
export const PROPER_NOUNS: ReadonlySet<string> = new Set([
  'Sim',
  'Chat',
  'Assistant',
  'Search',
  'Home',
  'Wiki',
  'Agent',
  'Enterprise',
  'Max',
  'Team',
  'Pro',
  'Slack',
  'Google',
  'Gmail',
  'Microsoft',
  'Outlook',
  'Excel',
  'Entra',
  'Azure',
  'Notion',
  'Linear',
  'Jira',
  'Confluence',
  'Salesforce',
  'Zoom',
  'Dropbox',
  'Stripe',
  'Discord',
  'Telegram',
  'Twilio',
  'Anthropic',
  'Claude',
  'Gemini',
  'Grok',
  'Mistral',
  'Docker',
  'Python',
  'Chrome',
  'Safari',
  'Firefox',
  'Windows',
  'Linux',
  'Mac',
  'Apple',
  'Okta',
  'Databricks',
  'Lucid',
  'Airtable',
  'Asana',
  'Figma',
  'Gong',
  'Zendesk',
  'Intercom',
  'Shopify',
  'Supabase',
  'Snowflake',
  'Postgres',
  'Redis',
  'Vercel',
  'Cloudflare',
  'Cursor',
  'Markdown',
  'Esc',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'English',
  'I',
])

/** Names whose later words are capitalized only inside the name: products, plans and OS settings. */
export const PROPER_PHRASES: readonly string[] = [
  'AWS Marketplace',
  'Claude Code',
  'Claude Desktop',
  'Compute Units',
  'Control Center',
  'Credential Groups',
  'Generic Secrets',
  'GitHub App',
  'Graph Explorer',
  'Google Calendar',
  'Google Docs',
  'Google Drive',
  'Google Meet',
  'Google Sheets',
  'Microsoft Teams',
  'Microsoft Word',
  'Oracle Database',
  'Screen Recording',
  'Sim Dark',
  'Sim Light',
  'Sim Mailer',
  'Slack Search',
  'System Settings',
  'VS Code',
]

/** The literal copy under a naming value: string and template parts, conditional and fallback branches. */
function namingCopy(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
  if (ts.isTemplateExpression(node))
    return [
      [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' # '),
      ...node.templateSpans.flatMap((span) => namingCopy(span.expression)),
    ]
  if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node))
    return node.expression ? namingCopy(node.expression) : []
  if (ts.isConditionalExpression(node))
    return [...namingCopy(node.whenTrue), ...namingCopy(node.whenFalse)]
  if (
    ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
      node.operatorToken.kind
    )
  )
    return [...namingCopy(node.left), ...namingCopy(node.right)]
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return namingCopy(node.body)
  return []
}

/**
 * The Title Case words in one label: capitalized words after the first, except a proper noun or
 * name, a word that starts a new sentence or clause (after `.`, `!`, `?`, `:` or a `·` separator),
 * or a quoted name. Each part of a hyphenated word counts.
 */
function titleCaseIn(text: string): string[] {
  const named = PROPER_PHRASES.reduce(
    (copy, phrase) => copy.replaceAll(phrase, phrase.replace(/\s+/g, '_')),
    text.replace(/[“"][^”"]*[”"]/g, ' “” ')
  )
  const found: string[] = []
  let opensClause = true
  for (const token of named.split(/\s+/)) {
    if (!token) continue
    for (const word of token
      .split('-')
      .map((part) => part.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))) {
      if (!opensClause && /^\p{Lu}\p{Ll}+$/u.test(word) && !PROPER_NOUNS.has(word)) found.push(word)
      opensClause = false
    }
    opensClause = /[.!?:·]$/.test(token)
  }
  return found
}

/**
 * The Title Case words in a control's or dialog's name, which Platform copy writes in sentence case:
 * a literal `title`, `label` or any `*Label` attribute (`confirmLabel`, `createLabel`, …), a `label`
 * or `*Label` in menu, column, option or action data, or the text of a button, menu item or chip.
 */
export function titleCaseWords(node: ts.Node): string[] {
  let copy: string[] = []
  if (ts.isJsxAttribute(node) && isNamingAttribute(node.name.getText()) && node.initializer)
    copy = namingCopy(node.initializer)
  else if (
    ts.isPropertyAssignment(node) &&
    isNamingProperty(node.name.getText()) &&
    ts.isObjectLiteralExpression(node.parent)
  )
    copy = namingCopy(node.initializer)
  else if (
    (ts.isJsxText(node) || ts.isJsxExpression(node)) &&
    ts.isJsxElement(node.parent) &&
    NAMED_CONTROL.test(tagName(node.parent.openingElement))
  )
    copy = ts.isJsxText(node) ? [node.text.trim()] : namingCopy(node)
  return copy.filter(Boolean).flatMap(titleCaseIn)
}

/** `process.env.SIM_PLATFORM_FIXTURES` or `resolvePlatformMode()`. */
function isPlatformModeRead(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node))
    return node.getText() === 'process.env.SIM_PLATFORM_FIXTURES'
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'resolvePlatformMode'
  )
}

/** The fixture build switch itself, which a branch tests so a normal build drops fixture code. */
function isFixtureBuildRead(node: ts.Node): boolean {
  return isPlatformModeRead(node) && !node.getText().startsWith('resolvePlatformMode')
}

/** Whether a fixture-mode value decides anything here: a mode read, or a `fixture` prop tested. */
export function isFixtureModeBranch(node: ts.Node): boolean {
  if (isPlatformModeRead(node)) return true
  const named =
    (ts.isIdentifier(node) && node.text === 'fixture') ||
    (ts.isPropertyAccessExpression(node) && node.name.text === 'fixture')
  if (!named || ts.isPropertyAccessExpression(node.parent)) return false
  let top = node
  while (
    ts.isParenthesizedExpression(top.parent) ||
    (ts.isPrefixUnaryExpression(top.parent) &&
      top.parent.operator === ts.SyntaxKind.ExclamationToken)
  )
    top = top.parent
  const parent = top.parent
  return (
    (ts.isIfStatement(parent) && parent.expression === top) ||
    (ts.isConditionalExpression(parent) && parent.condition === top) ||
    (ts.isBinaryExpression(parent) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(
        parent.operatorToken.kind
      ))
  )
}

/** Whether `node` sits in the branch a fixture build takes, which a normal build drops. */
export function inFixtureBranch(node: ts.Node): boolean {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    const condition = ts.isIfStatement(parent)
      ? parent.thenStatement === child && parent.expression
      : ts.isConditionalExpression(parent) && parent.whenTrue === child && parent.condition
    if (condition && containsNode(condition, isFixtureBuildRead)) return true
  }
  return false
}

function containsNode(node: ts.Node, test: (node: ts.Node) => boolean): boolean {
  return (
    test(node) || Boolean(ts.forEachChild(node, (child) => containsNode(child, test) || undefined))
  )
}

type PageKind = 'fixture-branch' | 'live-only' | 'redirect-only' | 'unclassified'

/**
 * What a product `page.tsx` renders on a fixture build: its own branch, nothing (a live-only gate
 * answers not found), or a redirect (it renders no JSX and calls a redirect).
 */
export function classifyPage(source: ts.SourceFile): PageKind {
  const isJsx = (node: ts.Node) =>
    ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
  const isRedirect = (node: ts.Node) =>
    ts.isCallExpression(node) &&
    /redirect/i.test(
      ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : node.expression.getText()
    )
  if (!containsNode(source, isJsx) && containsNode(source, isRedirect)) return 'redirect-only'
  if (containsNode(source, isFixtureBuildRead)) return 'fixture-branch'
  if (containsNode(source, isPlatformModeRead)) return 'live-only'
  return 'unclassified'
}

/** Where a helper line sits: under a field, a form dialog's title, a row or page header, or in field data. */
export type HelperCopyKind = 'field-hint' | 'dialog-subtitle' | 'row-subtitle' | 'data-hint'

/** A helper line, the node it sits on, and the subject (`label`, `title` or field `id`) that names it. */
export interface HelperCopy {
  kind: HelperCopyKind
  node: ts.Node
  subject: string
}

const EMCN_MODULE = /^@sim\/emcn(?:-platform)?(?:\/|$)/

/** Each local name an `@sim/emcn` or `@sim/emcn-platform` import binds, to the name it exports. */
function emcnBindings(source: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue
    const specifier = statement.moduleSpecifier
    if (!ts.isStringLiteral(specifier) || !EMCN_MODULE.test(specifier.text)) continue
    const named = statement.importClause?.namedBindings
    if (!named || !ts.isNamedImports(named)) continue
    for (const element of named.elements)
      bindings.set(element.name.text, (element.propertyName ?? element.name).text)
  }
  return bindings
}

/** A literal string an expression is, unwrapped from a JSX expression container. */
function staticText(node: ts.Node | undefined): string | undefined {
  const value = node && ts.isJsxExpression(node) ? node.expression : node
  if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)))
    return value.text
}

/** Whether any string or template under `node` spells out copy rather than only interpolating. */
function containsCopy(node: ts.Node): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text.trim().length > 0
  if (ts.isTemplateExpression(node))
    return [node.head, ...node.templateSpans.map((span) => span.literal)].some(
      (part) => part.text.trim().length > 0
    )
  return ts.forEachChild(node, containsCopy) ?? false
}

/** The attribute `name` of a JSX element. */
function attribute(element: ts.JsxOpeningLikeElement, name: string) {
  return element.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name
  )
}

/** How a finding names its element: the attribute's literal text, or its expression in braces. */
function subjectOf(element: ts.JsxOpeningLikeElement, name: string): string {
  const value = attribute(element, name)?.initializer
  const text = staticText(value)
  if (text !== undefined) return text
  if (value && ts.isJsxExpression(value) && value.expression)
    return `{${value.expression.getText().replace(/\s+/g, ' ')}}`
  return element.tagName.getText()
}

/** The `id`, `value` or `label` that names an object literal of field data, else `fallback`. */
function fieldSubject(object: ts.ObjectLiteralExpression, fallback: string): string {
  for (const key of ['id', 'value', 'label']) {
    const property = object.properties.find(
      (entry): entry is ts.PropertyAssignment =>
        ts.isPropertyAssignment(entry) && entry.name.getText() === key
    )
    const text = staticText(property?.initializer)
    if (text) return text
  }
  return fallback
}

/**
 * The helper lines in `source`, each a second line of copy under something that already has a name:
 * a `hint` on an EMCN field, or on any element when the hint spells out copy (a wrapper's
 * pass-through `hint={hint}` is judged where it reaches EMCN); a `description` on a form `Modal`
 * (a confirm or feedback dialog's description is its question, not a subtitle); a literal
 * `description` on a `SettingsRow` or a settings `DetailHeader` (a computed one reports state); and a
 * non-empty `hint` in field data. `disabledReason`, `error` and `aria-*` are other attributes, so
 * nothing here reads them.
 */
export function helperCopy(source: ts.SourceFile): HelperCopy[] {
  const emcn = emcnBindings(source)
  const found: HelperCopy[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText()
      const exported = emcn.get(tag.split('.')[0])
      const hint = attribute(node, 'hint')
      if (hint?.initializer && (exported || containsCopy(hint.initializer)))
        found.push({ kind: 'field-hint', node: hint, subject: subjectOf(node, 'label') })
      const description = attribute(node, 'description')
      if (description?.initializer) {
        const variant = attribute(node, 'variant')
        if (exported === 'Modal' && (!variant || staticText(variant.initializer) === 'form'))
          found.push({
            kind: 'dialog-subtitle',
            node: description,
            subject: subjectOf(node, 'title'),
          })
        else if (
          (exported === 'SettingsRow' || tag === 'DetailHeader') &&
          staticText(description.initializer)?.trim()
        )
          found.push({
            kind: 'row-subtitle',
            node: description,
            subject: subjectOf(node, tag === 'DetailHeader' ? 'title' : 'label'),
          })
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'hint' &&
      containsCopy(node.initializer)
    )
      found.push({
        kind: 'data-hint',
        node,
        subject: ts.isObjectLiteralExpression(node.parent)
          ? fieldSubject(node.parent, node.initializer.getText())
          : node.initializer.getText(),
      })
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}
