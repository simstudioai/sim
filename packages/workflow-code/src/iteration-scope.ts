/**
 * The iteration-scope rule: a loop's or parallel's iteration fields (`index`, `currentItem`,
 * `items`, …) resolve only inside that container. Outside it the executor refuses a named
 * container's field and finds no scope for the bare `<loop.index>` prefix. Compile reports a
 * violation at its source line; the workflow lint reports it for edits made without source. Both
 * walk the graph through {@link readsIterationOutOfScope}, so they cannot disagree.
 */
import { LOOP_PROPERTIES, PARALLEL_PROPERTIES } from './code-files'

/** The kind of iteration container. */
export type ContainerKind = 'loop' | 'parallel'

/** One block as the rule reads it: its container kind (`null` for any other block) and parent. */
export interface ScopeNode {
  kind: ContainerKind | null
  parent: string | null
}

/**
 * The containers whose iteration fields `site` reads at run time: itself when it is one (a while
 * condition reads `<loop.index>`), then each enclosing one, innermost first.
 */
function iterationScopes(site: string, nodeOf: (key: string) => ScopeNode | undefined): string[] {
  const scopes: string[] = []
  const seen = new Set<string>()
  for (let key: string | null = site; key !== null && !seen.has(key); ) {
    seen.add(key)
    const node = nodeOf(key)
    if (node?.kind) scopes.push(key)
    key = node?.parent ?? null
  }
  return scopes
}

/**
 * Whether block `site` reading iteration field `property` of `container` is out of scope:
 * `container` is a container block's key, or the bare `loop`/`parallel` prefix (`<loop.index>`),
 * which names the innermost enclosing container of that kind. A property no container of the kind
 * has (a container output such as `results`) is not this rule's.
 */
export function readsIterationOutOfScope(
  site: string,
  container: { key: string } | ContainerKind,
  property: string,
  nodeOf: (key: string) => ScopeNode | undefined
): boolean {
  const kind = typeof container === 'string' ? container : nodeOf(container.key)?.kind
  if (!kind) return false
  if (!(kind === 'loop' ? LOOP_PROPERTIES : PARALLEL_PROPERTIES).includes(property)) return false
  const scopes = iterationScopes(site, nodeOf)
  return typeof container === 'string'
    ? !scopes.some((key) => nodeOf(key)?.kind === kind)
    : !scopes.includes(container.key)
}
