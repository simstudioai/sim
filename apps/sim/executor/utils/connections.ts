import type { SerializedConnection } from '@/serializer/types'

/**
 * Utility functions for analyzing connections in workflow execution.
 * Provides reusable helpers for connection filtering and analysis.
 */
export class ConnectionUtils {
  /**
   * Get all incoming connections to a specific node.
   */
  static getIncomingConnections(
    nodeId: string,
    connections: SerializedConnection[]
  ): SerializedConnection[] {
    return connections.filter((conn) => conn.target === nodeId)
  }

  /**
   * Get all outgoing connections from a specific node.
   */
  static getOutgoingConnections(
    nodeId: string,
    connections: SerializedConnection[]
  ): SerializedConnection[] {
    return connections.filter((conn) => conn.source === nodeId)
  }

  /**
   * Get connections from within a specific scope (parallel/loop) to a target node.
   */
  static getInternalConnections(
    nodeId: string,
    scopeNodes: string[],
    connections: SerializedConnection[]
  ): SerializedConnection[] {
    const incomingConnections = ConnectionUtils.getIncomingConnections(nodeId, connections)
    return incomingConnections.filter((conn) => scopeNodes.includes(conn.source))
  }

  /**
   * Check if a block is completely unconnected (has no incoming connections at all).
   */
  static isUnconnectedBlock(nodeId: string, connections: SerializedConnection[]): boolean {
    return ConnectionUtils.getIncomingConnections(nodeId, connections).length === 0
  }

  /**
   * Check if a block has external connections (connections from outside a scope).
   */
  static hasExternalConnections(
    nodeId: string,
    scopeNodes: string[],
    connections: SerializedConnection[]
  ): boolean {
    const incomingConnections = ConnectionUtils.getIncomingConnections(nodeId, connections)
    const internalConnections = incomingConnections.filter((conn) =>
      scopeNodes.includes(conn.source)
    )

    // Has external connections if total incoming > internal connections
    return incomingConnections.length > internalConnections.length
  }

  /**
   * Determine if a block should be considered an entry point for a scope.
   * Entry points are blocks that have no internal connections but do have external connections.
   */
  static isEntryPoint(
    nodeId: string,
    scopeNodes: string[],
    connections: SerializedConnection[]
  ): boolean {
    const hasInternalConnections =
      ConnectionUtils.getInternalConnections(nodeId, scopeNodes, connections).length > 0

    if (hasInternalConnections) {
      return false // Has internal connections, not an entry point
    }

    // Only entry point if it has external connections (not completely unconnected)
    return ConnectionUtils.hasExternalConnections(nodeId, scopeNodes, connections)
  }
}
