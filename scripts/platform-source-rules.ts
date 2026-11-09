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
export function renderedText(node: ts.Node): RenderedText | undefined {
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
 * Copy that announces a pending read: `Loading`, its synonyms, `Please wait`, and a `Saving…` or
 * `Sending…` status. Any case.
 */
const LOADING_COPY =
  /^(?:(?:loading|checking|fetching|reading|refreshing|retrieving)\b|please wait\b|(?:saving|sending)\b.*…$)/i
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
 * Rendered text that announces a pending read. An action's pending label is feedback, not loading
 * copy, so one that ends in `…` passes as a button's text or a `pendingLabel` or `confirmLabel`
 * (`busy ? 'Saving…' : 'Save'`), and as the pending branch of a Load action
 * (`busy ? 'Loading…' : 'Load more'`).
 */
export function isLoadingCopy(node: ts.Node): boolean {
  const rendered = renderedText(node)
  if (!rendered || !LOADING_COPY.test(rendered.text)) return false
  const { text, root, host, attribute } = rendered
  if (!text.endsWith('…')) return true
  const buttonText =
    ts.isJsxElement(host) &&
    /(?:^|\.)(?:button|\w*Button)$/.test(host.openingElement.tagName.getText())
  const loadAction =
    /^loading\b/i.test(text) && conditionalLeaves(root).some((leaf) => LOAD_ACTION.test(leaf))
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

/** Rendered copy that spells an ellipsis as three periods after a word. */
export function hasAsciiEllipsis(node: ts.Node): boolean {
  const rendered = renderedText(node)
  return Boolean(rendered && /[\p{L}\p{N}]\.\.\.(?!\.)/u.test(rendered.text))
}

/** `process.env.SIM_PLATFORM_FIXTURES`, `isPlatformFixtureBuild()` or `resolvePlatformMode()`. */
export function isPlatformModeRead(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node))
    return node.getText() === 'process.env.SIM_PLATFORM_FIXTURES'
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    ['isPlatformFixtureBuild', 'resolvePlatformMode'].includes(node.expression.text)
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
