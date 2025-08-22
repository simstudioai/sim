import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot-new/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { getBlocksAndToolsServerTool } from '@/lib/copilot-new/tools/server/blocks/get-blocks-and-tools'
import { getBlocksMetadataServerTool } from '@/lib/copilot-new/tools/server/blocks/get-blocks-metadata-tool'
import { buildWorkflowServerTool } from '@/lib/copilot-new/tools/server/workflow/build-workflow'
import { getWorkflowConsoleServerTool } from '@/lib/copilot-new/tools/server/workflow/get-workflow-console'
import { searchDocumentationServerTool } from '@/lib/copilot-new/tools/server/docs/search-documentation'
import { searchOnlineServerTool } from '@/lib/copilot-new/tools/server/other/search-online'
import { getEnvironmentVariablesServerTool } from '@/lib/copilot-new/tools/server/user/get-environment-variables'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot-new/tools/server/user/set-environment-variables'
import { listGDriveFilesServerTool } from '@/lib/copilot-new/tools/server/gdrive/list-files'
import { readGDriveFileServerTool } from '@/lib/copilot-new/tools/server/gdrive/read-file'
import { getOAuthCredentialsServerTool } from '@/lib/copilot-new/tools/server/user/get-oauth-credentials'
import { makeApiRequestServerTool } from '@/lib/copilot-new/tools/server/other/make-api-request'
import { editWorkflowServerTool } from '@/lib/copilot-new/tools/server/workflow/edit-workflow'
import { ExecuteResponseSuccessSchema, GetBlocksAndToolsInput, GetBlocksAndToolsResult, GetBlocksMetadataInput, GetBlocksMetadataResult, BuildWorkflowInput, BuildWorkflowResult } from '@/lib/copilot-new/tools/shared/schemas'

// Generic execute response schemas (success path only for this route; errors handled via HTTP status)
export { ExecuteResponseSuccessSchema }
export type ExecuteResponseSuccess = typeof ExecuteResponseSuccessSchema['_type']

// Define server tool registry for the new copilot runtime
const serverToolRegistry: Record<string, BaseServerTool<any, any>> = {}
const logger = createLogger('ServerToolRouter')

// Register tools
serverToolRegistry[getBlocksAndToolsServerTool.name] = getBlocksAndToolsServerTool
serverToolRegistry[getBlocksMetadataServerTool.name] = getBlocksMetadataServerTool
serverToolRegistry[buildWorkflowServerTool.name] = buildWorkflowServerTool
serverToolRegistry[editWorkflowServerTool.name] = editWorkflowServerTool
serverToolRegistry[getWorkflowConsoleServerTool.name] = getWorkflowConsoleServerTool
serverToolRegistry[searchDocumentationServerTool.name] = searchDocumentationServerTool
serverToolRegistry[searchOnlineServerTool.name] = searchOnlineServerTool
serverToolRegistry[getEnvironmentVariablesServerTool.name] = getEnvironmentVariablesServerTool
serverToolRegistry[setEnvironmentVariablesServerTool.name] = setEnvironmentVariablesServerTool
serverToolRegistry[listGDriveFilesServerTool.name] = listGDriveFilesServerTool
serverToolRegistry[readGDriveFileServerTool.name] = readGDriveFileServerTool
serverToolRegistry[getOAuthCredentialsServerTool.name] = getOAuthCredentialsServerTool
serverToolRegistry[makeApiRequestServerTool.name] = makeApiRequestServerTool

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
	if (toolName === 'build_workflow') {
		args = BuildWorkflowInput.parse(args)
	}

	const result = await tool.execute(args)

	if (toolName === 'get_blocks_and_tools') {
		return GetBlocksAndToolsResult.parse(result)
	}
	if (toolName === 'get_blocks_metadata') {
		return GetBlocksMetadataResult.parse(result)
	}
	if (toolName === 'build_workflow') {
		return BuildWorkflowResult.parse(result)
	}

	return result
}
