/**
 * The result fields of a set of workflows that may call one another, each typed by the fields of
 * the workflows it calls: a workspace check, an apply and a read all resolve them here, so a
 * `<call.result.data.<field>>` is typed the same way by each.
 */

import type { BlockCatalog } from './catalog/types'
import { type CompileInput, type CompileResult, compileWorkflow } from './compile'
import type { ChildResultFields } from './json-fields'
import { SOURCE_ENTRY_FILE } from './limits'
import type { WorkflowLockV1 } from './lock'
import type { CanonicalWorkflow } from './model'
import { calledWorkflowKeys, childResultFields } from './responds'

/** By child workflow key, the result fields that type a call's `<call.result.data.<field>>`. */
export type ChildResults = ReadonlyMap<string, ChildResultFields>

/** One workflow, as {@link resolveChildResults} reads it. */
export interface ChildResultNode {
  /** The keys of the workflows it calls. */
  calls: readonly string[]
  /** Its result fields, its calls typed by `childResults` (of the workflows it calls). */
  fields(childResults: ChildResults): ChildResultFields | null
}

/**
 * What a workflow source folder compiles from offline, as a check and a parent's call typed by it
 * read it: `entry` (its `workflow.ts`) and its code files against `catalog`, continuing the stored
 * workflow its lock binds (`storedUnread`, so a `stored()` param of a bound block compiles unread).
 */
export function folderCompileInput(
  entry: string,
  files: Readonly<Record<string, string>>,
  lock: WorkflowLockV1 | undefined,
  catalog: BlockCatalog
): CompileInput {
  return {
    entry: { path: SOURCE_ENTRY_FILE, text: entry },
    files: new Map(Object.entries(files).filter(([path]) => path !== SOURCE_ENTRY_FILE)),
    catalog,
    sdkMajor: catalog.sdkMajor,
    knownKeys: new Set(Object.keys(lock?.blocks ?? {})),
    ...(lock ? { storedUnread: lock } : {}),
  }
}

/**
 * The {@link ChildResultNode} of the source `input` compiles (`compiled`, its compile without
 * child results), compiled again with its callees' fields when any types a call it makes.
 */
export function compiledResultNode(
  input: CompileInput,
  compiled: CompileResult = compileWorkflow(input)
): ChildResultNode | null {
  const { workflow } = compiled
  if (!workflow) return null
  const calls = calledWorkflowKeys(workflow)
  return {
    calls,
    fields: (childResults) => {
      const typed = calls.some((key) => childResults.has(key))
        ? compileWorkflow({ ...input, childResults }).workflow
        : workflow
      return typed && childResultFields(typed, input.catalog, childResults)
    },
  }
}

/** The {@link ChildResultNode} of a stored workflow canonicalized as `workflow`. */
export function canonicalResultNode(
  workflow: CanonicalWorkflow,
  catalog: BlockCatalog
): ChildResultNode {
  return {
    calls: calledWorkflowKeys(workflow),
    fields: (childResults) => childResultFields(workflow, catalog, childResults),
  }
}

/**
 * The result fields of each workflow of `nodes` that has any, by key, callees first: each is typed
 * by the fields of the workflows it calls, so a field forwarding a grandchild's is typed through
 * the chain. A call to a workflow `nodes` lacks is untyped, and so is a call within a cycle (to a
 * workflow that calls back to the caller): its fields are not known before its own, so every
 * workflow of a cycle is typed without the others, whichever is read first.
 */
export function resolveChildResults(
  nodes: ReadonlyMap<string, ChildResultNode>
): Map<string, ChildResultFields> {
  const resolved = new Map<string, ChildResultFields>()
  for (const component of stronglyConnected(nodes)) {
    const members = new Set(component)
    for (const key of component) {
      const node = nodes.get(key)
      if (!node) continue
      const childResults = new Map<string, ChildResultFields>()
      for (const call of node.calls) {
        const fields = members.has(call) ? undefined : resolved.get(call)
        if (fields) childResults.set(call, fields)
      }
      const fields = node.fields(childResults)
      if (fields) resolved.set(key, fields)
    }
  }
  return resolved
}

/**
 * The strongly connected components of the call graph `nodes` holds (Tarjan's algorithm), each
 * listed after every component it calls into.
 */
function stronglyConnected(nodes: ReadonlyMap<string, ChildResultNode>): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []
  const visit = (key: string) => {
    index.set(key, index.size)
    low.set(key, index.size - 1)
    stack.push(key)
    onStack.add(key)
    for (const call of nodes.get(key)?.calls ?? []) {
      if (!nodes.has(call)) continue
      if (!index.has(call)) {
        visit(call)
        low.set(key, Math.min(low.get(key) ?? 0, low.get(call) ?? 0))
      } else if (onStack.has(call)) {
        low.set(key, Math.min(low.get(key) ?? 0, index.get(call) ?? 0))
      }
    }
    if (low.get(key) !== index.get(key)) return
    const component: string[] = []
    let member: string | undefined
    do {
      member = stack.pop()
      if (member === undefined) break
      onStack.delete(member)
      component.push(member)
    } while (member !== key)
    components.push(component)
  }
  for (const key of nodes.keys()) if (!index.has(key)) visit(key)
  return components
}
