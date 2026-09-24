import type { ComputerUseResult } from '@sim/desktop-bridge/computer-use'

/** Screenshots become model image observations; base64 is never duplicated inside textual output. */
export function computerToolResultForModel(result: ComputerUseResult) {
  if (result.kind !== 'state' || !result.screenshot) return result
  const { screenshot, ...state } = result
  const window = state.windows.find((candidate) => candidate.windowId === state.windowId)
  return {
    ...state,
    screenshotSize: { width: screenshot.width, height: screenshot.height },
    content: window
      ? `Screenshot of window ${state.windowId}. Coordinate actions use window-local macOS points. Convert encoded image coordinates: x = imageX * ${window.width} / ${screenshot.width}; y = imageY * ${window.height} / ${screenshot.height}. Accessibility node x/y are global screen points; subtract window origin (${window.x}, ${window.y}) before a coordinate action. Use element IDs when available.`
      : 'Screenshot coordinate mapping is unavailable. Use accessibility element IDs or take a fresh state before acting.',
    observations: [
      { name: 'Computer screenshot', mediaType: screenshot.mimeType, data: screenshot.base64 },
    ],
  }
}
