import type { ComputerUseResult, ComputerUseSnapshot } from '@sim/desktop-bridge/computer-use'
import { truncateAtCodePoint } from '@sim/utils/string'
import { LRUCache } from 'lru-cache'

// Keep encoded pixels below the 10 MiB completion body cap, with room for state and its envelope.
const MAX_SCREENSHOT_BASE64_BYTES = 9 * 1024 * 1024
// Mothership stores a computer result over 24,000 characters and shows the model a preview cut
// through the middle of the tree; staying under it keeps the prioritized rows the model needs.
const MAX_STATE_BYTES = 22 * 1024
const encoder = new TextEncoder()

/** Change-only observations in a row before a full tree again, so a condensed context recovers. */
const MAX_CHAINED_CHANGES = 4

/** What the model has been shown of a snapshot: its rows, folding in any change lists before it. */
interface KnownTree {
  snapshotId: string
  bundleId: string
  windowId: string
  rows: Map<string, string>
  changesSinceFull: number
}

const knownTrees = new LRUCache<string, KnownTree>({ max: 64 })

export interface ComputerToolResultContext {
  /** The snapshot the action consumed; its observation then lists only rows that changed since it. */
  baseSnapshotId?: string
  /** Whether the desktop keeps an element's id across observations; positional ids get whole trees. */
  stableElementIds?: boolean
}

/** Screenshots are image observations; a bounded readable tree keeps actionable references inline. */
export function computerToolResultForModel(
  result: ComputerUseResult,
  context: ComputerToolResultContext = {}
) {
  if (result.kind === 'state') return remember(snapshotForModel(result))
  if (result.kind !== 'action' || !result.observation) return result
  const { observation: raw, ...action } = result
  const base =
    context.stableElementIds && context.baseSnapshotId
      ? knownTrees.get(context.baseSnapshotId)
      : undefined
  const { observations, ...observation } = remember(
    snapshotForModel(raw, jsonBytes({ ...action, observation: null }), base)
  )
  return { ...action, observation, ...(observations ? { observations } : {}) }
}

/** Records what the model now knows of this snapshot and returns only what it sees. */
function remember<T extends { snapshotId: string }>({
  known,
  ...projected
}: T & { known: KnownTree }) {
  knownTrees.set(projected.snapshotId, known)
  return projected
}

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length
}

type SnapshotNode = ComputerUseSnapshot['nodes'][number]

/** Layout wrappers that carry no text, state (including disabled) or action; their children are shown under the nearest meaningful ancestor. */
const WRAPPER_ROLES = new Set([
  'AXGroup',
  'AXSplitGroup',
  'AXLayoutArea',
  'AXLayoutItem',
  'AXUnknown',
])

function isWrapper(node: SnapshotNode): boolean {
  return (
    WRAPPER_ROLES.has(node.role) &&
    !node.label &&
    !node.value &&
    !node.placeholder &&
    !node.focused &&
    !node.editable &&
    node.enabled !== false &&
    node.actions.length === 0
  )
}

function nodeRow(
  node: SnapshotNode,
  parentId: string | undefined,
  selectedWindowId: string,
  selected?: ReadonlySet<string>
): string {
  const fields = [node.elementId, node.role]
  if (parentId && (!selected || selected.has(parentId))) fields.push(`parent=${parentId}`)
  if (node.label) fields.push(`label=${JSON.stringify(truncateAtCodePoint(node.label, 512, ''))}`)
  if (node.value) fields.push(`value=${JSON.stringify(truncateAtCodePoint(node.value, 512, ''))}`)
  if (node.placeholder)
    fields.push(`placeholder=${JSON.stringify(truncateAtCodePoint(node.placeholder, 256, ''))}`)
  if (node.focused) fields.push('focused')
  if (node.editable) fields.push('editable')
  if (node.enabled === false) fields.push('disabled')
  if (node.actions.length) fields.push(`actions=${JSON.stringify(node.actions.slice(0, 16))}`)
  if (node.windowId && node.windowId !== selectedWindowId) fields.push(`window=${node.windowId}`)
  if (
    node.x !== undefined &&
    node.y !== undefined &&
    node.width !== undefined &&
    node.height !== undefined
  )
    fields.push(
      `screenRect=${[node.x, node.y, node.width, node.height].map((value) => Math.round(value)).join(',')}`
    )
  return fields.join(' ')
}

function snapshotForModel(result: ComputerUseSnapshot, envelopeBytes = 0, base?: KnownTree) {
  const { screenshot, nodes, windows: allWindows, ...state } = result
  const image =
    screenshot && screenshot.base64.length <= MAX_SCREENSHOT_BASE64_BYTES ? screenshot : undefined
  const screenshotOmitted = Boolean(screenshot && !image)
  const selectedWindow = allWindows.find((candidate) => candidate.windowId === state.windowId)
  const windows = [
    ...(selectedWindow ? [selectedWindow] : []),
    ...allWindows.filter((candidate) => candidate.windowId !== state.windowId).slice(0, 19),
  ].map((window) => ({ ...window, title: truncateAtCodePoint(window.title, 256, '') }))
  const model = {
    ...state,
    ...(screenshotOmitted
      ? {
          screenshotError:
            'Screenshot omitted because its encoded size exceeds completion limits. Accessibility state is still available.',
        }
      : {}),
    windows,
    omittedWindowCount: allWindows.length - windows.length,
    treeFormat:
      'Rows: elementId role [parent=id, omitted when the parent is not shown] [label=] [value=] [placeholder=] (JSON strings) [focused] [editable] [disabled] [actions=JSON array of exact names] [window=id, omitted for windowId] [screenRect=x,y,w,h in global points]. Empty layout groups are folded into their parent.',
    accessibilityTree: '',
    omittedNodeCount: nodes.filter((node) => !isWrapper(node)).length,
    nodeTextLimit: 512,
    ...(image
      ? {
          screenshotSize: { width: image.width, height: image.height },
          content: selectedWindow
            ? `Screenshot of window ${state.windowId}. Coordinate actions use window-local macOS points. Convert encoded image coordinates: x = imageX * ${selectedWindow.width} / ${image.width}; y = imageY * ${selectedWindow.height} / ${image.height}. Accessibility screenRect coordinates are global points; subtract window origin (${selectedWindow.x}, ${selectedWindow.y}). Prefer element IDs.`
            : 'Screenshot coordinate mapping is unavailable. Use accessibility element IDs or take a fresh state before acting.',
        }
      : {}),
  }
  while (model.windows.length > 1 && jsonBytes(model) + envelopeBytes > MAX_STATE_BYTES / 2) {
    model.windows.pop()
    model.omittedWindowCount += 1
  }
  const byId = new Map(nodes.map((node) => [node.elementId, node]))
  const shown = nodes.filter((node) => !isWrapper(node))
  /** Each shown node's nearest shown ancestor, skipping wrappers (and stopping on a parent cycle). */
  const shownParent = new Map<string, string | undefined>()
  for (const node of shown) {
    const seen = new Set([node.elementId])
    let parent = node.parentId ? byId.get(node.parentId) : undefined
    while (parent && isWrapper(parent) && !seen.has(parent.elementId)) {
      seen.add(parent.elementId)
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    }
    shownParent.set(
      node.elementId,
      parent && !isWrapper(parent) && parent.elementId !== node.elementId
        ? parent.elementId
        : undefined
    )
  }
  const rows = new Map(
    shown.map((node) => [
      node.elementId,
      nodeRow(node, shownParent.get(node.elementId), state.windowId),
    ])
  )
  const clipped =
    nodes.some(
      (node) =>
        (node.label?.length ?? 0) > 512 ||
        (node.value?.length ?? 0) > 512 ||
        (node.placeholder?.length ?? 0) > 256 ||
        node.actions.length > 16
    ) || allWindows.some((window) => window.title.length > 256)
  const changes = base && changesSince(base, result, shown, rows)
  if (changes) {
    const changed = {
      ...model,
      treeFormat: `${model.treeFormat} Only rows added or changed since snapshot ${base.snapshotId} are listed: every other row of that snapshot is unchanged and keeps its elementId, and removedElementIds no longer exist. Use get_app_state for the whole tree.`,
      changedSince: base.snapshotId,
      accessibilityTree: changes.ids.map((id) => rows.get(id)).join('\n'),
      removedElementIds: changes.removed,
      omittedNodeCount: 0,
    }
    if (jsonBytes(changed) + envelopeBytes <= MAX_STATE_BYTES) {
      const known = new Map(base.rows)
      for (const id of changes.removed) known.delete(id)
      for (const id of changes.ids) known.set(id, rows.get(id) ?? '')
      return {
        ...changed,
        truncated:
          state.truncated || windows.length < allWindows.length || clipped || screenshotOmitted,
        ...(image
          ? {
              observations: [
                { name: 'Computer screenshot', mediaType: image.mimeType, data: image.base64 },
              ],
            }
          : {}),
        known: {
          snapshotId: state.snapshotId,
          bundleId: state.bundleId,
          windowId: state.windowId,
          rows: known,
          changesSinceFull: base.changesSinceFull + 1,
        },
      }
    }
  }
  const priority = (node: SnapshotNode) => {
    const visible =
      selectedWindow &&
      node.windowId === selectedWindow.windowId &&
      node.x !== undefined &&
      node.y !== undefined &&
      node.width !== undefined &&
      node.height !== undefined &&
      node.x + node.width > selectedWindow.x &&
      node.x < selectedWindow.x + selectedWindow.width &&
      node.y + node.height > selectedWindow.y &&
      node.y < selectedWindow.y + selectedWindow.height
    const control =
      /^(AXButton|AXCheckBox|AXRadioButton|AXPopUpButton|AXComboBox|AXSlider|AXLink|AXTextField|AXTextArea|AXTab|AXMenuItem|AXIncrementor|AXSwitch)$/.test(
        node.role
      )
    const primaryAction = node.actions.some(
      (action) => action === 'AXPress' || action === 'AXConfirm' || action === 'AXPick'
    )
    /** Items of an open menu have an on-screen frame; closed menus report none. */
    const openMenuItem = node.role === 'AXMenuItem' && (node.height ?? 0) > 0
    return (
      (node.focused || openMenuItem
        ? 100
        : node.editable
          ? 80
          : control
            ? 70
            : primaryAction
              ? 60
              : node.label || node.value
                ? 20
                : 0) + (visible ? 15 : 0)
    )
  }
  const selected = new Set<string>()
  let bytes = jsonBytes(model) + envelopeBytes
  const add = (ids: string[]) => {
    const additional = ids.filter((id) => !selected.has(id))
    /** A row's JSON length: its two quotes come off, and the escaped joining newline (`\\n`) adds two bytes back. */
    const cost = additional.reduce((total, id) => total + jsonBytes(rows.get(id)), 0)
    if (bytes + cost > MAX_STATE_BYTES) return false
    for (const id of additional) selected.add(id)
    bytes += cost
    return true
  }
  for (const node of [...shown].sort((left, right) => priority(right) - priority(left))) {
    const ancestry = [node.elementId]
    const seen = new Set(ancestry)
    let parent = shownParent.get(node.elementId)
    while (parent && !seen.has(parent)) {
      ancestry.push(parent)
      seen.add(parent)
      parent = shownParent.get(parent)
    }
    /** Keep the editor itself even if an unusually deep ancestry cannot fit. */
    if (!add(ancestry.reverse())) add([node.elementId])
  }
  return {
    ...model,
    accessibilityTree: shown
      .filter((node) => selected.has(node.elementId))
      .map((node) => nodeRow(node, shownParent.get(node.elementId), state.windowId, selected))
      .join('\n'),
    omittedNodeCount: shown.length - selected.size,
    truncated:
      state.truncated ||
      selected.size < shown.length ||
      windows.length < allWindows.length ||
      clipped ||
      screenshotOmitted,
    ...(image
      ? {
          observations: [
            { name: 'Computer screenshot', mediaType: image.mimeType, data: image.base64 },
          ],
        }
      : {}),
    known: {
      snapshotId: state.snapshotId,
      bundleId: state.bundleId,
      windowId: state.windowId,
      rows: new Map([...selected].map((id) => [id, rows.get(id) ?? ''])),
      changesSinceFull: 0,
    },
  }
}

/**
 * The rows that differ from what the model was shown of `base`, or undefined when a whole tree is
 * clearer: another app or window, a long chain of change lists, or most of the tree changing.
 */
function changesSince(
  base: KnownTree,
  result: ComputerUseSnapshot,
  shown: SnapshotNode[],
  rows: Map<string, string>
): { ids: string[]; removed: string[] } | undefined {
  if (
    base.bundleId !== result.bundleId ||
    base.windowId !== result.windowId ||
    base.changesSinceFull >= MAX_CHAINED_CHANGES
  )
    return undefined
  const ids = shown.map((node) => node.elementId).filter((id) => rows.get(id) !== base.rows.get(id))
  if (ids.length * 2 > shown.length) return undefined
  const present = new Set(result.nodes.map((node) => node.elementId))
  const removed = [...base.rows.keys()].filter((id) => !present.has(id))
  return { ids, removed }
}
