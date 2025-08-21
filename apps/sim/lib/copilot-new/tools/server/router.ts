import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot-new/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { getBlocksAndToolsServerTool } from '@/lib/copilot-new/tools/server/blocks/get-blocks-and-tools'
import { getBlocksMetadataServerTool } from '@/lib/copilot-new/tools/server/blocks/get-blocks-metadata-tool'
import { ExecuteResponseSuccessSchema, GetBlocksAndToolsInput, GetBlocksAndToolsResult, GetBlocksMetadataInput, GetBlocksMetadataResult } from '@/lib/copilot-new/tools/shared/schemas'

// Generic execute response schemas (success path only for this route; errors handled via HTTP status)
export { ExecuteResponseSuccessSchema }
export type ExecuteResponseSuccess = typeof ExecuteResponseSuccessSchema['_type']

// Define server tool registry for the new copilot runtime
const serverToolRegistry: Record<string, BaseServerTool<any, any>> = {}
const logger = createLogger('ServerToolRouter')

// Register tools
serverToolRegistry[getBlocksAndToolsServerTool.name] = getBlocksAndToolsServerTool
serverToolRegistry[getBlocksMetadataServerTool.name] = getBlocksMetadataServerTool

// Main router function
export async function routeExecution(toolName: string, payload: unknown): Promise<any> {
	const tool = serverToolRegistry[toolName]
	if (!tool) {
		throw new Error(`Unknown server tool: ${toolName}`)
	}
	logger.debug('Routing to tool', {
		toolName,
		payloadPreview: (() => { try { return JSON.stringify(payload).slice(0, 200) } catch { return undefined } })(),
	})

	let args: any = payload || {}
	if (toolName === 'get_blocks_and_tools') {
		args = GetBlocksAndToolsInput.parse(args)
	}
	if (toolName === 'get_blocks_metadata') {
		args = GetBlocksMetadataInput.parse(args)
	}

	const result = await tool.execute(args)

	if (toolName === 'get_blocks_and_tools') {
		return GetBlocksAndToolsResult.parse(result)
	}
	if (toolName === 'get_blocks_metadata') {
		return GetBlocksMetadataResult.parse(result)
	}

	return result
}
