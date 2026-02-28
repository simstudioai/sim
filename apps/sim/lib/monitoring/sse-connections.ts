/**
 * Tracks active SSE connections by route for memory leak diagnostics.
 * Logged alongside periodic memory telemetry to correlate connection
 * counts with heap growth.
 */

const connections = new Map<string, number>()

export function incrementSSEConnections(route: string) {
  connections.set(route, (connections.get(route) ?? 0) + 1)
}

export function decrementSSEConnections(route: string) {
  const count = (connections.get(route) ?? 0) - 1
  if (count <= 0) connections.delete(route)
  else connections.set(route, count)
}

export function getActiveSSEConnectionCount(): number {
  let total = 0
  for (const count of connections.values()) total += count
  return total
}

export function getActiveSSEConnectionsByRoute(): Record<string, number> {
  return Object.fromEntries(connections)
}
