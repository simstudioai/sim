import { SerializedBlock, SerializedConnection, SerializedLoop } from '@/serializer/types'
import { ExecutionContext } from './types'

/**
 * Manages loop detection, iteration limits, and state resets.
 */
export class LoopManager {
  private workflowVariables: Record<string, any>;
  
  constructor(
    private loops: Record<string, SerializedLoop>,
    private defaultIterations: number = 5,
    workflowVariables: Record<string, any> = {}
  ) {
    this.workflowVariables = workflowVariables;
  }

  /**
   * Processes all loops and checks if any need to be iterated.
   * Resets blocks in loops that should iterate again.
   *
   * @param context - Current execution context
   * @returns Whether any loop has reached its maximum iterations
   */
  async processLoopIterations(context: ExecutionContext): Promise<boolean> {
    let hasLoopReachedMaxIterations = false

    // Nothing to do if no loops
    if (Object.keys(this.loops).length === 0) return hasLoopReachedMaxIterations

    // Check each loop to see if it should iterate
    for (const [loopId, loop] of Object.entries(this.loops)) {
      // Get the loop type (default to 'for')
      const loopType = loop.loopType || 'for'

      // Handle forEach loop
      if (loopType === 'forEach') {
        // Get the items to iterate over if we haven't already processed them into an array/object
        if (!loop.forEachItems || typeof loop.forEachItems === 'string' || 
            !(Array.isArray(loop.forEachItems) || typeof loop.forEachItems === 'object')) {
          // Evaluate the forEach items expression
          const items = await this.evalForEachItems(loopId, loop, context);
          
          // Store the evaluated items for future iterations
          if (Array.isArray(items) || (typeof items === 'object' && items !== null)) {
            loop.forEachItems = items;
          } else {
            // Default to empty array if we couldn't get any valid items
            loop.forEachItems = [];
          }
        }

        // Get current iteration count
        const currentIteration = context.loopIterations.get(loopId) || 0

        // For forEach, convert to array if it's an object
        const items = Array.isArray(loop.forEachItems) 
          ? loop.forEachItems 
          : Object.entries(loop.forEachItems as Record<string, any>)
        
        // If we've processed all items or hit max iterations, skip this loop
        if (currentIteration >= items.length || currentIteration >= loop.iterations) {
          if (currentIteration >= items.length) {
            hasLoopReachedMaxIterations = true
          }
          continue
        }

        // Check if all blocks in the loop have been executed
        const allExecuted = this.allBlocksExecuted(loop.nodes, context)
        
        if (allExecuted) {
          // Get current item to process in this iteration
          const currentItem = items[currentIteration]
          
          // Store the current item in the context for blocks to access via <loop.currentItem>
          context.loopItems.set(loopId, currentItem)
          
          // IMPORTANT: We're incrementing the iteration counter AFTER storing the current item
          // But BEFORE resetting the blocks for next iteration
          // This ensures that when blocks execute in the new iteration, they'll get the correct index
          context.loopIterations.set(loopId, currentIteration + 1)

          // Check if we've now reached iterations limit after incrementing
          if (currentIteration + 1 >= items.length || currentIteration + 1 >= loop.iterations) {
            hasLoopReachedMaxIterations = true
          }

          // Reset ALL blocks in the loop for the next iteration
          for (const nodeId of loop.nodes) {
            // Remove from executed blocks
            context.executedBlocks.delete(nodeId)

            // Make sure it's in the active execution path
            context.activeExecutionPath.add(nodeId)
          }

          // Make sure the first block in the loop is marked as executable
          const entryBlock = this.findEntryBlock(loop.nodes, context)
          if (loop.nodes.length > 0 && entryBlock) {
            context.activeExecutionPath.add(entryBlock)
          }
        }
      } else {
        // Original logic for 'for' loops
        // Get current iteration count
        const currentIteration = context.loopIterations.get(loopId) || 0

        // If we've hit the iterations count, skip this loop and mark flag
        if (currentIteration >= loop.iterations) {
          hasLoopReachedMaxIterations = true
          continue
        }

        // Check if all blocks in the loop have been executed
        const allExecuted = this.allBlocksExecuted(loop.nodes, context)
        
        if (allExecuted) {
          // IMPORTANT: Increment the counter BEFORE resetting blocks for the next iteration
          // This ensures the next iteration will show the correct index value
          context.loopIterations.set(loopId, currentIteration + 1)

          // Check if we've now reached iterations limit after incrementing
          if (currentIteration + 1 >= loop.iterations) {
            hasLoopReachedMaxIterations = true
          }

          // Reset ALL blocks in the loop, not just blocks after the entry
          for (const nodeId of loop.nodes) {
            // Remove from executed blocks
            context.executedBlocks.delete(nodeId)

            // Make sure it's in the active execution path
            context.activeExecutionPath.add(nodeId)
          }

          // Important: Make sure the first block in the loop is marked as executable
          const entryBlock = this.findEntryBlock(loop.nodes, context)
          if (loop.nodes.length > 0 && entryBlock) {
            // Make sure it's in the active path
            context.activeExecutionPath.add(entryBlock)
          }
        }
      }
    }

    return hasLoopReachedMaxIterations
  }

  /**
   * Gets the correct loop index based on the current block being executed.
   * Accounts for position within the loop cycle to provide accurate index.
   * 
   * @param loopId - ID of the loop
   * @param blockId - ID of the block requesting the index
   * @param context - Current execution context
   * @returns The correct loop index for this block
   */
  getLoopIndex(loopId: string, blockId: string, context: ExecutionContext): number {
    const loop = this.loops[loopId]
    if (!loop) return 0
    
    // Get the current iteration counter from context
    const iterationCounter = context.loopIterations.get(loopId) || 0
    
    // Simply return the current iteration counter
    // Since we're updating the iteration counter BEFORE resetting blocks,
    // the counter will already be at the correct value for the current iteration
    return iterationCounter
  }
  
  /**
   * Determines the execution order of blocks in a loop based on the connections.
   * This is needed to figure out which blocks should be assigned which iteration.
   * 
   * @param nodeIds - IDs of nodes in the loop
   * @param context - Current execution context
   * @returns Array of block IDs in execution order
   */
  private determineBlockExecutionOrder(nodeIds: string[], context: ExecutionContext): string[] {
    // Start with the entry block
    const entryBlock = this.findEntryBlock(nodeIds, context)
    if (!entryBlock) return nodeIds
    
    const result: string[] = [entryBlock]
    const visited = new Set<string>([entryBlock])
    
    // Perform a depth-first traversal to determine execution order
    const traverse = (nodeId: string) => {
      // Find all outgoing connections from this node
      const connections = context.workflow?.connections.filter(
        conn => conn.source === nodeId && 
               nodeIds.includes(conn.target) && 
               conn.sourceHandle !== 'error'
      ) || []
      
      // Sort by target node to ensure deterministic order
      connections.sort((a, b) => a.target.localeCompare(b.target))
      
      // Visit each target node
      for (const conn of connections) {
        if (!visited.has(conn.target)) {
          visited.add(conn.target)
          result.push(conn.target)
          traverse(conn.target)
        }
      }
    }
    
    // Start traversal from the entry block
    traverse(entryBlock)
    
    // If there are nodes we didn't visit, add them at the end
    for (const nodeId of nodeIds) {
      if (!visited.has(nodeId)) {
        result.push(nodeId)
      }
    }
    
    return result
  }

  /**
   * Evaluates the forEach items string or retrieves items for a forEach loop.
   * 
   * @param loopId - ID of the loop
   * @param loop - Loop configuration
   * @param context - Current execution context
   * @returns Items to iterate over (array or object)
   */
  private async evalForEachItems(
    loopId: string, 
    loop: SerializedLoop, 
    context: ExecutionContext
  ): Promise<any[] | Record<string, any> | undefined> {
    // If forEachItems is not set, return empty array
    if (!loop.forEachItems) {
      return [];
    }
    
    // If we already have items as an array or object, return them directly
    if (Array.isArray(loop.forEachItems) || (typeof loop.forEachItems === 'object' && loop.forEachItems !== null)) {
      return loop.forEachItems as any[] | Record<string, any>;
    }

    // If we have forEachItems as a string, try to evaluate it as an expression
    if (typeof loop.forEachItems === 'string') {
      try {
        // Skip comments or empty expressions
        const trimmedExpression = loop.forEachItems.trim();
        if (trimmedExpression.startsWith('//') || trimmedExpression === '') {
          return [];
        }
        
        // Import the resolver to handle variable and block references
        let InputResolver;
        try {
          InputResolver = (await import('./resolver')).InputResolver;
        } catch (importError) {
          console.error(`Failed to import InputResolver: ${importError}`);
          return [];
        }
        
        // Create a temporary block for the resolver to use
        const dummyBlock = {
          id: `temp-${loopId}`,
          position: { x: 0, y: 0 },
          config: {
            tool: 'loop',
            params: { 
              items: trimmedExpression 
            }
          },
          inputs: {},
          outputs: {},
          enabled: true
        };
        
        // Create a resolver instance
        const resolver = new InputResolver(
          context.workflow || { version: '1.0', blocks: [], connections: [], loops: {} },
          context.environmentVariables,
          this.workflowVariables,
          this
        );
        
        // Special handling for tag references (single variable tag enclosed in < >)
        if (/^<[^>]+>$/.test(trimmedExpression)) {
          // For a single tag reference, try to resolve it directly
          const resolved = resolver.resolveBlockReferences(
            trimmedExpression, 
            context, 
            dummyBlock as any
          );
          
          // If the resolved value has changed, it was successfully resolved
          if (resolved !== trimmedExpression) {
            try {
              // Try to parse as JSON if it looks like JSON
              if ((resolved.startsWith('[') && resolved.endsWith(']')) || 
                  (resolved.startsWith('{') && resolved.endsWith('}'))) {
                return JSON.parse(resolved);
              } else if (resolved.trim() !== '') {
                // If it's not JSON but has content, return as a single-item array
                return [resolved];
              }
            } catch (jsonError) {
              // If JSON parsing fails, just return as a single item
              return [resolved];
            }
          }
        }
        
        // Check if the string contains variables tags (with < and >)
        const containsVariableTags = trimmedExpression.includes('<') && trimmedExpression.includes('>');
        
        // Handle arrays with variable references: [<var1>, <var2>, 3, "text"]
        if (containsVariableTags && trimmedExpression.startsWith('[') && trimmedExpression.endsWith(']')) {
          try {
            // Extract the items but preserve the array structure
            const itemsStr = trimmedExpression.substring(1, trimmedExpression.length - 1);
            
            // Use a simple but effective split that respects JSON structure
            const items = this.splitArrayItems(itemsStr);
            
            // Process each item
            const result = [];
            for (const item of items) {
              const trimmedItem = item.trim();
              
              // If it's a variable tag, resolve it
              if (trimmedItem.includes('<') && trimmedItem.includes('>')) {
                // Resolve any variable/block references in this item
                const resolvedItem = resolver.resolveBlockReferences(
                  trimmedItem, 
                  context, 
                  dummyBlock as any
                );
                
                // If it's still the same as the original, it wasn't resolved
                if (resolvedItem === trimmedItem) {
                  // Keep as is for now - it may be resolvable during iteration
                  result.push(trimmedItem);
                } else {
                  // Successfully resolved - parse as JSON if possible
                  try {
                    if ((resolvedItem.startsWith('[') && resolvedItem.endsWith(']')) || 
                        (resolvedItem.startsWith('{') && resolvedItem.endsWith('}'))) {
                      result.push(JSON.parse(resolvedItem));
                    } else {
                      // Not JSON, use the primitive value
                      // Try to convert to appropriate type
                      if (resolvedItem === 'true') result.push(true);
                      else if (resolvedItem === 'false') result.push(false);
                      else if (resolvedItem === 'null') result.push(null);
                      else if (!isNaN(Number(resolvedItem))) result.push(Number(resolvedItem));
                      else result.push(resolvedItem);
                    }
                  } catch (jsonError) {
                    // Not valid JSON, use as is
                    result.push(resolvedItem);
                  }
                }
              } else {
                // For non-variable items, parse as JSON
                try {
                  result.push(JSON.parse(trimmedItem));
                } catch (jsonError) {
                  // If not valid JSON, add as a string
                  result.push(trimmedItem);
                }
              }
            }
            
            return result;
          } catch (e) {
            console.error(`Error processing array with variables for loop ${loopId}:`, e);
            // Fall back to treating the whole thing as a string array
            return [trimmedExpression];
          }
        }
        
        // Handle objects with variable references: {"key": <var>, "key2": "value"}
        if (containsVariableTags && trimmedExpression.startsWith('{') && trimmedExpression.endsWith('}')) {
          try {
            // For objects, try a different approach - first resolve all variables in the string
            const fullyResolvedStr = resolver.resolveBlockReferences(
              trimmedExpression, 
              context, 
              dummyBlock as any
            );
            
            // Try to parse the fully resolved string as JSON
            try {
              return JSON.parse(fullyResolvedStr);
            } catch (jsonError) {
              console.error(`Error parsing resolved object for loop ${loopId}:`, jsonError);
              // If that fails, return as a string
              return [fullyResolvedStr];
            }
          } catch (e) {
            console.error(`Error processing object with variables for loop ${loopId}:`, e);
            return [trimmedExpression];
          }
        }
        
        // If it doesn't contain variable tags, or isn't an array/object with tags,
        // continue with standard JSON parsing
        if (!containsVariableTags && (trimmedExpression.startsWith('[') || trimmedExpression.startsWith('{'))) {
          try {
            // Try to parse as JSON first
            return JSON.parse(trimmedExpression);
          } catch (jsonError) {
            console.error(`Error parsing JSON for loop ${loopId}:`, jsonError);
            // If JSON parsing fails, continue with expression evaluation
          }
        }
        
        // If not valid JSON or JSON parsing failed, try to evaluate as an expression
        try {
          const result = new Function('context', `return ${loop.forEachItems}`)(context);
          
          // If the result is an array or object, return it
          if (Array.isArray(result) || (typeof result === 'object' && result !== null)) {
            return result;
          }
          
          // If it's a primitive, wrap it in an array
          if (result !== undefined) {
            return [result];
          }
        } catch (evalError) {
          console.error(`Error evaluating expression for loop ${loopId}:`, evalError);
        }
        
        return [];
      } catch (e) {
        console.error(`Error evaluating forEach items for loop ${loopId}:`, e);
        return [];
      }
    }

    // As a fallback, try to find the first non-empty array or object in the context
    for (const [blockId, blockState] of context.blockStates.entries()) {
      const output = blockState.output?.response;
      if (output) {
        // Look for arrays or objects in the response that could be iterated over
        for (const [key, value] of Object.entries(output)) {
          if (Array.isArray(value) && value.length > 0) {
            return value;
          } else if (typeof value === 'object' && value !== null && Object.keys(value).length > 0) {
            return value;
          }
        }
      }
    }

    return [];
  }

  /**
   * Splits array items respecting nested structures like objects and arrays.
   * This is a more robust way to split array items than simply splitting by commas.
   * 
   * @param str - The string containing array items (without the outer brackets)
   * @returns Array of item strings
   */
  private splitArrayItems(str: string): string[] {
    const result: string[] = [];
    let currentItem = '';
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      
      // Handle escape sequences in strings
      if (inString && char === '\\' && !escapeNext) {
        escapeNext = true;
        currentItem += char;
        continue;
      }
      
      // If we just processed an escape, reset the flag
      if (escapeNext) {
        escapeNext = false;
        currentItem += char;
        continue;
      }
      
      // Handle string boundaries
      if (char === '"' || char === "'") {
        inString = !inString;
        currentItem += char;
        continue;
      }
      
      // Skip processing special characters if we're in a string
      if (inString) {
        currentItem += char;
        continue;
      }
      
      // Handle nested structures
      if (char === '[' || char === '{') {
        depth++;
        currentItem += char;
      } else if (char === ']' || char === '}') {
        depth--;
        currentItem += char;
      } else if (char === ',' && depth === 0) {
        // Only split on commas at the top level
        result.push(currentItem);
        currentItem = '';
      } else {
        currentItem += char;
      }
    }
    
    // Add the last item if there is one
    if (currentItem.trim()) {
      result.push(currentItem);
    }
    
    return result;
  }

  /**
   * Finds the entry block for a loop (the one that should be executed first).
   * Typically the block with the fewest incoming connections.
   *
   * @param nodeIds - IDs of nodes in the loop
   * @param context - Current execution context
   * @returns ID of the entry block
   */
  private findEntryBlock(nodeIds: string[], context: ExecutionContext): string | undefined {
    const blockConnectionCounts = new Map<string, number>()

    for (const nodeId of nodeIds) {
      const incomingCount = context.workflow!.connections.filter(
        (conn) => conn.target === nodeId
      ).length
      blockConnectionCounts.set(nodeId, incomingCount)
    }

    const sortedBlocks = [...nodeIds].sort(
      (a, b) => (blockConnectionCounts.get(a) || 0) - (blockConnectionCounts.get(b) || 0)
    )

    return sortedBlocks[0]
  }

  /**
   * Checks if all blocks in a list have been executed.
   *
   * @param nodeIds - IDs of nodes to check
   * @param context - Current execution context
   * @returns Whether all blocks have been executed
   */
  private allBlocksExecuted(nodeIds: string[], context: ExecutionContext): boolean {
    return nodeIds.every((nodeId) => context.executedBlocks.has(nodeId))
  }

  /**
   * Checks if a connection forms a feedback path in a loop.
   * A feedback path points to an earlier block in the loop.
   *
   * @param connection - Connection to check
   * @param blocks - All blocks in the workflow
   * @returns Whether the connection forms a feedback path
   */
  isFeedbackPath(connection: SerializedConnection, blocks: SerializedBlock[]): boolean {
    for (const [loopId, loop] of Object.entries(this.loops)) {
      if (loop.nodes.includes(connection.source) && loop.nodes.includes(connection.target)) {
        const sourceIndex = loop.nodes.indexOf(connection.source)
        const targetIndex = loop.nodes.indexOf(connection.target)

        if (targetIndex < sourceIndex) {
          const sourceBlock = blocks.find((b) => b.id === connection.source)
          const isCondition = sourceBlock?.metadata?.id === 'condition'

          return isCondition && connection.sourceHandle?.startsWith('condition-') === true
        }
      }
    }

    return false
  }

  /**
   * Gets the iterations for a loop.
   *
   * @param loopId - ID of the loop
   * @returns Iterations for the loop
   */
  getIterations(loopId: string): number {
    return this.loops[loopId]?.iterations || this.defaultIterations
  }

  /**
   * Gets the current item for a forEach loop.
   *
   * @param loopId - ID of the loop
   * @param context - Current execution context
   * @returns Current item in the loop iteration
   */
  getCurrentItem(loopId: string, context: ExecutionContext): any {
    return context.loopItems.get(loopId)
  }
}
