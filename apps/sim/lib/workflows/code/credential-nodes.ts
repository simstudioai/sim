/**
 * Credential references in a canonical model, which depend on who reads it: canonicalize lifts a
 * credential the reader may see to its key and keeps one they may not see as its stored id (an
 * `unresolved` node), so one stored graph canonicalizes differently per reader. What must not vary
 * by reader (the stored fingerprint) reads the model through {@link withCredentialIds}.
 */
import { isRecordLike } from '@sim/utils/object'
import type { CanonicalWorkflow, ResourceKeyResolver } from '@sim/workflow-code'

/**
 * Calls `visit` on every node object inside `value`. A `literal` node is stored content, never a
 * reference, so it is not entered.
 */
function forEachNode(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) forEachNode(item, visit)
    return
  }
  if (!isRecordLike(value) || value.$sim === 'literal') return
  if (typeof value.$sim === 'string') visit(value)
  for (const member of Object.values(value)) forEachNode(member, visit)
}

const isCredentialNode = (node: Record<string, unknown>, form: 'resource' | 'unresolved') =>
  node.$sim === form && node.kind === 'credential'

/**
 * `workflow` with every credential it names by key named by its stored id instead, as a reader
 * who may not see the credential reads it: the same for every reader, and it shows no reader a
 * key. `resources` is the resolver `workflow` was canonicalized with. Returns `workflow` itself
 * when it names no credential by key.
 */
export function withCredentialIds(
  workflow: CanonicalWorkflow,
  resources: Pick<ResourceKeyResolver, 'toId'>
): CanonicalWorkflow {
  let named = false
  forEachNode(workflow.blocks, (node) => {
    if (isCredentialNode(node, 'resource')) named = true
  })
  if (!named) return workflow
  const copy = structuredClone(workflow)
  forEachNode(copy.blocks, (node) => {
    if (!isCredentialNode(node, 'resource') || typeof node.key !== 'string') return
    const id = resources.toId('credential', node.key)
    if (id === null) return
    node.$sim = 'unresolved'
    node.id = id
    Reflect.deleteProperty(node, 'key')
  })
  return copy
}

/** Calls `visit` on every node of `compiled` with whatever `stored` holds at the same path. */
function forEachNodePair(
  compiled: unknown,
  stored: unknown,
  visit: (node: Record<string, unknown>, storedNode: unknown) => void
): void {
  if (Array.isArray(compiled)) {
    if (!Array.isArray(stored)) return
    compiled.forEach((item, index) => forEachNodePair(item, stored[index], visit))
    return
  }
  if (!isRecordLike(compiled) || !isRecordLike(stored) || compiled.$sim === 'literal') return
  if (typeof compiled.$sim === 'string') visit(compiled, stored)
  for (const [key, member] of Object.entries(compiled)) {
    if (Object.hasOwn(stored, key)) forEachNodePair(member, stored[key], visit)
  }
}

/**
 * A credential key the source names, which the reader cannot resolve, where the stored graph
 * holds by id a credential the reader may not see.
 */
interface KeptCredential {
  key: string
  /** The stored credential's id, kept as stored. */
  id: string
  blockKey: string
}

/**
 * The credentials a source keeps where the stored graph holds one its reader may not see: a
 * teammate who sees it read the source and it names the credential by key. The reader cannot
 * resolve the key, and telling them whether it is that credential's key would confirm a name the
 * credential listing withholds, so any key they cannot resolve standing there keeps the stored
 * credential, right key or not. A key or id paired more than one way names no single credential
 * and is left out (it stays an unknown key). `compiled` and `stored` share block keys (`stored` is
 * the model `compileSource` compiled against, re-keyed by the source's renames); `isUnknown` tells a key the reader cannot resolve.
 */
export function keptCredentials(
  compiled: CanonicalWorkflow,
  stored: CanonicalWorkflow,
  isUnknown: (key: string) => boolean
): KeptCredential[] {
  const sites: KeptCredential[] = []
  for (const [blockKey, block] of Object.entries(compiled.blocks)) {
    if (!Object.hasOwn(stored.blocks, blockKey)) continue
    forEachNodePair(block, stored.blocks[blockKey], (node, storedNode) => {
      if (!isCredentialNode(node, 'resource') || typeof node.key !== 'string') return
      if (!isRecordLike(storedNode) || !isCredentialNode(storedNode, 'unresolved')) return
      if (typeof storedNode.id !== 'string' || !isUnknown(node.key)) return
      sites.push({ key: node.key, id: storedNode.id, blockKey })
    })
  }
  const idsByKey = new Map<string, Set<string>>()
  const keysById = new Map<string, Set<string>>()
  for (const { key, id } of sites) {
    idsByKey.set(key, (idsByKey.get(key) ?? new Set()).add(id))
    keysById.set(id, (keysById.get(id) ?? new Set()).add(key))
  }
  return sites.filter(
    ({ key, id }) => idsByKey.get(key)?.size === 1 && keysById.get(id)?.size === 1
  )
}
