import { Edge } from 'reactflow'
import { Loop } from './types';
import { BlockState } from './types';

/**
 * Performs a depth-first search to detect all cycles in the graph
 * @param edges - List of all edges in the graph
 * @param startNode - Starting node for cycle detection
 * @returns Array of all unique cycles found in the graph
 */
export function detectCycle(
  edges: Edge[],
  startNode: string
): { hasCycle: boolean; paths: string[][] } {
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  const allCycles: string[][] = []
  const currentPath: string[] = []

  function dfs(node: string) {
    visited.add(node)
    recursionStack.add(node)
    currentPath.push(node)

    // Get all neighbors of current node
    const neighbors = edges.filter((edge) => edge.source === node).map((edge) => edge.target)

    for (const neighbor of neighbors) {
      // Check for self-loops (node connecting to itself)
      if (neighbor === node) {
        allCycles.push([node])
        continue
      }

      if (!recursionStack.has(neighbor)) {
        if (!visited.has(neighbor)) {
          dfs(neighbor)
        }
      } else {
        // Found a cycle
        const cycleStartIndex = currentPath.indexOf(neighbor)
        if (cycleStartIndex !== -1) {
          const cycle = currentPath.slice(cycleStartIndex)
          // Include all cycles, even single-node ones
          allCycles.push([...cycle])
        }
      }
    }

    currentPath.pop()
    recursionStack.delete(node)
  }

  dfs(startNode)

  return {
    hasCycle: allCycles.length > 0,
    paths: allCycles,
  }
}

/**
 * Convert UI loop block to executor Loop format
 * 
 * @param loopBlockId - ID of the loop block to convert
 * @param blocks - Record of all blocks in the workflow
 * @returns Loop object for execution engine or undefined if not a valid loop
 */
export function convertLoopBlockToLoop(
  loopBlockId: string,
  blocks: Record<string, BlockState>
): Loop | undefined {
  const loopBlock = blocks[loopBlockId];
  if (!loopBlock || loopBlock.type !== 'loop') return undefined;
  
  return {
    id: loopBlockId,
    nodes: findChildNodes(loopBlockId, blocks),
    iterations: loopBlock.data?.count || 5,
    loopType: loopBlock.data?.loopType || 'for',
    forEachItems: loopBlock.data?.collection || '',
  };
}

/**
 * Find all nodes that are children of this loop
 * 
 * @param loopId - ID of the loop to find children for
 * @param blocks - Record of all blocks in the workflow
 * @returns Array of node IDs that are direct children of this loop
 */
export function findChildNodes(loopId: string, blocks: Record<string, BlockState>): string[] {
  return Object.values(blocks)
    .filter(block => block.data?.parentId === loopId)
    .map(block => block.id);
}

/**
 * Find all descendant nodes, including children, grandchildren, etc.
 * 
 * @param loopId - ID of the loop to find descendants for
 * @param blocks - Record of all blocks in the workflow
 * @returns Array of node IDs that are descendants of this loop
 */
export function findAllDescendantNodes(loopId: string, blocks: Record<string, BlockState>): string[] {
  const descendants: string[] = [];
  const findDescendants = (parentId: string) => {
    const children = Object.values(blocks)
      .filter(block => block.data?.parentId === parentId)
      .map(block => block.id);
    
    children.forEach(childId => {
      descendants.push(childId);
      findDescendants(childId);
    });
  };
  
  findDescendants(loopId);
  return descendants;
}

/**
 * Builds a complete collection of loops from the UI blocks
 * 
 * @param blocks - Record of all blocks in the workflow
 * @returns Record of Loop objects for execution engine
 */
export function generateLoopBlocks(blocks: Record<string, BlockState>): Record<string, Loop> {
  const loops: Record<string, Loop> = {};
  
  // Find all loop nodes
  Object.entries(blocks)
    .filter(([_, block]) => block.type === 'loop')
    .forEach(([id, block]) => {
      const loop = convertLoopBlockToLoop(id, blocks);
      if (loop) {
        loops[id] = loop;
      }
    });
  
  return loops;
}
