import { createLogger } from '@/lib/logs/console-logger';

const logger = createLogger('WorkflowUtils');

/**
 * Utility functions for handling node hierarchies and loop operations in the workflow
 */

/**
 * Calculates the depth of a node in the hierarchy tree
 * @param nodeId ID of the node to check
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns Depth level (0 for root nodes, increasing for nested nodes)
 */
export const getNodeDepth = (
  nodeId: string, 
  getNodes: () => any[]
): number => {
  const node = getNodes().find(n => n.id === nodeId);
  if (!node || !node.parentId) return 0;
  return 1 + getNodeDepth(node.parentId, getNodes);
};

/**
 * Gets the full hierarchy path of a node (its parent chain)
 * @param nodeId ID of the node to check
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns Array of node IDs representing the hierarchy path
 */
export const getNodeHierarchy = (
  nodeId: string, 
  getNodes: () => any[]
): string[] => {
  const node = getNodes().find(n => n.id === nodeId);
  if (!node || !node.parentId) return [nodeId];
  return [...getNodeHierarchy(node.parentId, getNodes), nodeId];
};

/**
 * Gets the absolute position of a node (accounting for nested parents)
 * @param nodeId ID of the node to check
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns Absolute position coordinates {x, y}
 */
export const getNodeAbsolutePosition = (
  nodeId: string, 
  getNodes: () => any[]
): { x: number, y: number } => {
  const node = getNodes().find(n => n.id === nodeId);
  if (!node) {
    // Handle case where node doesn't exist anymore by returning origin position
    // This helps prevent errors during cleanup operations
    logger.warn('Attempted to get position of non-existent node', { nodeId });
    return { x: 0, y: 0 };
  }
  
  if (!node.parentId) {
    return node.position;
  }
  
  // Check if parent exists
  const parentNode = getNodes().find(n => n.id === node.parentId);
  if (!parentNode) {
    // Parent reference is invalid, return node's current position
    logger.warn('Node references non-existent parent', { 
      nodeId, 
      invalidParentId: node.parentId 
    });
    return node.position;
  }
  
  // Check for circular reference to prevent infinite recursion
  const visited = new Set<string>();
  let current: any = node;
  while (current && current.parentId) {
    if (visited.has(current.parentId)) {
      // Circular reference detected
      logger.error('Circular parent reference detected', {
        nodeId,
        parentChain: Array.from(visited)
      });
      return node.position;
    }
    visited.add(current.id);
    current = getNodes().find(n => n.id === current.parentId);
  }
  
  // Get parent's absolute position
  const parentPos = getNodeAbsolutePosition(node.parentId, getNodes);
  
  // Calculate this node's absolute position
  return {
    x: parentPos.x + node.position.x,
    y: parentPos.y + node.position.y
  };
};

/**
 * Calculates the relative position of a node to a new parent
 * @param nodeId ID of the node being repositioned
 * @param newParentId ID of the new parent
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns Relative position coordinates {x, y}
 */
export const calculateRelativePosition = (
  nodeId: string, 
  newParentId: string, 
  getNodes: () => any[]
): { x: number, y: number } => {
  // Get absolute position of the node
  const nodeAbsPos = getNodeAbsolutePosition(nodeId, getNodes);
  
  // Get absolute position of the new parent
  const parentAbsPos = getNodeAbsolutePosition(newParentId, getNodes);
  
  // Calculate relative position
  return {
    x: nodeAbsPos.x - parentAbsPos.x,
    y: nodeAbsPos.y - parentAbsPos.y
  };
};

/**
 * Updates a node's parent with proper position calculation
 * @param nodeId ID of the node being reparented
 * @param newParentId ID of the new parent (or null to remove parent)
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @param updateBlockPosition Function to update the position of a block
 * @param updateParentId Function to update the parent ID of a block
 * @param resizeLoopNodes Function to resize loop nodes after parent update
 */
export const updateNodeParent = (
  nodeId: string, 
  newParentId: string | null,
  getNodes: () => any[],
  updateBlockPosition: (id: string, position: { x: number, y: number }) => void,
  updateParentId: (id: string, parentId: string, extent: "parent") => void,
  resizeLoopNodes: () => void
) => {
  // Skip if no change
  const node = getNodes().find(n => n.id === nodeId);
  if (!node) return;
  
  const currentParentId = node.parentId || null;
  if (newParentId === currentParentId) return;
  
  if (newParentId) {
    // Moving to a new parent - calculate relative position
    const relativePosition = calculateRelativePosition(nodeId, newParentId, getNodes);
    
    // Update both position and parent
    updateBlockPosition(nodeId, relativePosition);
    updateParentId(nodeId, newParentId, 'parent');
    
    logger.info('Updated node parent', {
      nodeId,
      newParentId,
      relativePosition
    });
  }
  
  // Resize affected loops
  resizeLoopNodes();
};

/**
 * Checks if a point is inside a loop node
 * @param position Position coordinates to check
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns The smallest loop containing the point, or null if none
 */
export const isPointInLoopNode = (
  position: { x: number, y: number },
  getNodes: () => any[]
): { 
  loopId: string, 
  loopPosition: { x: number, y: number },
  dimensions: { width: number, height: number } 
} | null => {
  // Find loops that contain this position point
  const containingLoops = getNodes()
    .filter(n => n.type === 'loopNode')
    .filter(n => {
      const loopRect = {
        left: n.position.x,
        right: n.position.x + (n.data?.width || 500), 
        top: n.position.y,
        bottom: n.position.y + (n.data?.height || 300)
      };

      return (
        position.x >= loopRect.left &&
        position.x <= loopRect.right &&
        position.y >= loopRect.top &&
        position.y <= loopRect.bottom
      );
    })
    .map(n => ({
      loopId: n.id,
      loopPosition: n.position,
      dimensions: {
        width: n.data?.width || 500,  
        height: n.data?.height || 300
      }
    }));

  // Sort by area (smallest first) in case of nested loops
  if (containingLoops.length > 0) {
    return containingLoops.sort((a, b) => {
      const aArea = a.dimensions.width * a.dimensions.height;
      const bArea = b.dimensions.width * b.dimensions.height;
      return aArea - bArea;
    })[0];
  }

  return null;
};

/**
 * Calculates appropriate dimensions for a loop node based on its children
 * @param loopId ID of the loop node
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns Calculated width and height for the loop
 */
export const calculateLoopDimensions = (
  loopId: string,
  getNodes: () => any[]
): { width: number, height: number } => {
  // Default minimum dimensions
  const minWidth = 500;
  const minHeight = 300;

  // Get all child nodes of this loop
  const childNodes = getNodes().filter(node => node.parentId === loopId);

  if (childNodes.length === 0) {
    return { width: minWidth, height: minHeight };
  }

  // Calculate the bounding box that contains all children
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  childNodes.forEach(node => {
    // Get accurate node dimensions based on node type
    let nodeWidth;
    let nodeHeight;
    
    if (node.type === 'loopNode') {
      // For nested loops, don't add excessive padding to the parent
      // Use actual dimensions without additional padding to prevent cascading expansion
      nodeWidth = node.data?.width || 500;
      nodeHeight = node.data?.height || 300;
    } else if (node.type === 'workflowBlock') {
      // Handle all workflowBlock types appropriately
      const blockType = node.data?.type;
      
      switch (blockType) {
        case 'agent':
        case 'api':
          // Tall blocks
          nodeWidth = 350;
          nodeHeight = 650;
          break;
        case 'condition':
        case 'function':            
          nodeWidth = 250;
          nodeHeight = 200;
          break;
        case 'router':
          nodeWidth = 250;
          nodeHeight = 350;
          break;
        default:
          // Default dimensions for other block types
          nodeWidth = 200;
          nodeHeight = 200;
      }
    } else {
      // Default dimensions for any other node types
      nodeWidth = 200;
      nodeHeight = 200;
    }

    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + nodeWidth);
    maxY = Math.max(maxY, node.position.y + nodeHeight);
  });

  // Add buffer padding to all sides (20px buffer before edges)
  // Add extra padding for nested loops to prevent tight boundaries
  const hasNestedLoops = childNodes.some(node => node.type === 'loopNode');
  
  // More reasonable padding values, especially for nested loops
  // Reduce the excessive padding that was causing parent loops to be too large
  const sidePadding = hasNestedLoops ? 150 : 120; // Reduced padding for loops containing other loops
  
  // Ensure the width and height are never less than the minimums
  // Apply padding to all sides (left/right and top/bottom)
  const width = Math.max(minWidth, maxX + sidePadding);
  const height = Math.max(minHeight, maxY + sidePadding);

  return { width, height };
};

/**
 * Resizes all loop nodes based on their children
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @param updateNodeDimensions Function to update the dimensions of a node
 */
export const resizeLoopNodes = (
  getNodes: () => any[],
  updateNodeDimensions: (id: string, dimensions: { width: number, height: number }) => void
) => {
  // Find all loop nodes and sort by hierarchy depth (parents first)
  const loopNodes = getNodes()
    .filter(node => node.type === 'loopNode')
    .map(node => ({
      ...node,
      depth: getNodeDepth(node.id, getNodes)
    }))
    .sort((a, b) => a.depth - b.depth);

  // Resize each loop node based on its children
  loopNodes.forEach(loopNode => {
    const dimensions = calculateLoopDimensions(loopNode.id, getNodes);

    // Only update if dimensions have changed (to avoid unnecessary updates)
    if (dimensions.width !== loopNode.data?.width || 
        dimensions.height !== loopNode.data?.height) {
      updateNodeDimensions(loopNode.id, dimensions);
    }
  });
}; 