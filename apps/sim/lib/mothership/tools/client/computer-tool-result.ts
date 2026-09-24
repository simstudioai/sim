import type { ComputerUseResult, ComputerUseSnapshot } from '@sim/desktop-bridge/computer-use'
import { truncateAtCodePoint } from '@sim/utils/string'

const MAX_STATE_BYTES = 44 * 1024
const encoder = new TextEncoder()

/** Screenshots are image observations; a bounded readable tree keeps actionable references inline. */
export function computerToolResultForModel(result: ComputerUseResult) {
  if (result.kind === 'state') return snapshotForModel(result)
  if (result.kind !== 'action' || !result.observation) return result
  const { observation: raw, ...action } = result
  const { observations, ...observation } = snapshotForModel(
    raw,
    jsonBytes({ ...action, observation: null })
  )
  return { ...action, observation, ...(observations ? { observations } : {}) }
}

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length
}

function nodeRow(node: ComputerUseSnapshot['nodes'][number]): string {
  const fields = [node.elementId, node.role]
  if (node.parentId) fields.push(`parent=${node.parentId}`)
  if (node.label) fields.push(`label=${JSON.stringify(truncateAtCodePoint(node.label, 512, ''))}`)
  if (node.value) fields.push(`value=${JSON.stringify(truncateAtCodePoint(node.value, 512, ''))}`)
  if (node.placeholder)
    fields.push(`placeholder=${JSON.stringify(truncateAtCodePoint(node.placeholder, 256, ''))}`)
  if (node.focused) fields.push('focused')
  if (node.editable) fields.push('editable')
  if (node.enabled === false) fields.push('disabled')
  if (node.actions.length) fields.push(`actions=${JSON.stringify(node.actions.slice(0, 16))}`)
  if (node.windowId) fields.push(`window=${node.windowId}`)
  if (
    node.x !== undefined &&
    node.y !== undefined &&
    node.width !== undefined &&
    node.height !== undefined
  )
    fields.push(`screenRect=${JSON.stringify([node.x, node.y, node.width, node.height])}`)
  return fields.join(' ')
}

function snapshotForModel(result: ComputerUseSnapshot, envelopeBytes = 0) {
  const { screenshot, nodes, windows: allWindows, ...state } = result
  const selectedWindow = allWindows.find((candidate) => candidate.windowId === state.windowId)
  const windows = [
    ...(selectedWindow ? [selectedWindow] : []),
    ...allWindows.filter((candidate) => candidate.windowId !== state.windowId).slice(0, 19),
  ].map((window) => ({ ...window, title: truncateAtCodePoint(window.title, 256, '') }))
  const model = {
    ...state,
    windows,
    omittedWindowCount: allWindows.length - windows.length,
    accessibilityTree: '',
    omittedNodeCount: nodes.length,
    nodeTextLimit: 512,
    ...(screenshot
      ? {
          screenshotSize: { width: screenshot.width, height: screenshot.height },
          content: selectedWindow
            ? `Screenshot of window ${state.windowId}. Coordinate actions use window-local macOS points. Convert encoded image coordinates: x = imageX * ${selectedWindow.width} / ${screenshot.width}; y = imageY * ${selectedWindow.height} / ${screenshot.height}. Accessibility screenRect coordinates are global points; subtract window origin (${selectedWindow.x}, ${selectedWindow.y}). Prefer element IDs.`
            : 'Screenshot coordinate mapping is unavailable. Use accessibility element IDs or take a fresh state before acting.',
        }
      : {}),
  }
  while (model.windows.length > 1 && jsonBytes(model) + envelopeBytes > MAX_STATE_BYTES / 2) {
    model.windows.pop()
    model.omittedWindowCount += 1
  }
  const byId = new Map(nodes.map((node) => [node.elementId, node]))
  const rows = new Map(nodes.map((node) => [node.elementId, nodeRow(node)]))
  const priority = (node: ComputerUseSnapshot['nodes'][number]) => {
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
    return (
      (node.focused
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
    const cost = additional.reduce((total, id) => total + jsonBytes(rows.get(id)) - 2 + 2, 0)
    if (bytes + cost > MAX_STATE_BYTES) return false
    for (const id of additional) selected.add(id)
    bytes += cost
    return true
  }
  for (const node of [...nodes].sort((left, right) => priority(right) - priority(left))) {
    const ancestry = [node.elementId]
    const seen = new Set(ancestry)
    let parent = node.parentId
    while (parent && byId.has(parent) && !seen.has(parent)) {
      ancestry.push(parent)
      seen.add(parent)
      parent = byId.get(parent)?.parentId
    }
    /** Keep the editor itself even if an unusually deep ancestry cannot fit. */
    if (!add(ancestry.reverse())) add([node.elementId])
  }
  const clipped =
    nodes.some(
      (node) =>
        (node.label?.length ?? 0) > 512 ||
        (node.value?.length ?? 0) > 512 ||
        (node.placeholder?.length ?? 0) > 256 ||
        node.actions.length > 16
    ) || allWindows.some((window) => window.title.length > 256)
  return {
    ...model,
    accessibilityTree: nodes
      .filter((node) => selected.has(node.elementId))
      .map((node) => rows.get(node.elementId))
      .join('\n'),
    omittedNodeCount: nodes.length - selected.size,
    truncated:
      state.truncated ||
      selected.size < nodes.length ||
      windows.length < allWindows.length ||
      clipped,
    observations: screenshot
      ? [{ name: 'Computer screenshot', mediaType: screenshot.mimeType, data: screenshot.base64 }]
      : undefined,
  }
}
