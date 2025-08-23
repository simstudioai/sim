import { Loader2, Network, XCircle } from 'lucide-react'
import { BaseClientTool, ClientToolCallState, type BaseClientToolMetadata } from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

interface MakeApiRequestArgs {
	url: string
	method: 'GET' | 'POST' | 'PUT'
	queryParams?: Record<string, string | number | boolean>
	headers?: Record<string, string>
	body?: any
}

export class MakeApiRequestClientTool extends BaseClientTool {
	static readonly id = 'make_api_request'

	constructor(toolCallId: string) {
		super(toolCallId, MakeApiRequestClientTool.id, MakeApiRequestClientTool.metadata)
	}

	static readonly metadata: BaseClientToolMetadata = {
		displayNames: {
			[ClientToolCallState.generating]: { text: 'Preparing API request', icon: Loader2 },
			[ClientToolCallState.pending]: { text: 'Execute API request?', icon: Network },
			[ClientToolCallState.executing]: { text: 'Executing API request', icon: Loader2 },
			[ClientToolCallState.success]: { text: 'Executed API request', icon: Network },
			[ClientToolCallState.error]: { text: 'Failed to execute API request', icon: XCircle },
		},
		interrupt: {
			accept: { text: 'Execute', icon: Network },
			reject: { text: 'Skip', icon: XCircle },
		},
	}

    async handleReject(): Promise<void> {
        await super.handleReject()
        this.setState(ClientToolCallState.rejected)
    }

    async handleAccept(args?: MakeApiRequestArgs): Promise<void> {
        const logger = createLogger('MakeApiRequestClientTool')
		try {
			this.setState(ClientToolCallState.executing)
			const res = await fetch('/api/copilot/execute-copilot-server-tool', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ toolName: 'make_api_request', payload: args || {} }),
			})
			if (!res.ok) {
				const txt = await res.text().catch(() => '')
				throw new Error(txt || `Server error (${res.status})`)
			}
			const json = await res.json()
			const parsed = ExecuteResponseSuccessSchema.parse(json)
			this.setState(ClientToolCallState.success)
			await this.markToolComplete(200, 'API request executed', parsed.result)
			this.setState(ClientToolCallState.success)
		} catch (e: any) {
			logger.error('execute failed', { message: e?.message })
			this.setState(ClientToolCallState.error)
			await this.markToolComplete(500, e?.message || 'API request failed')
		}
    }

	async execute(args?: MakeApiRequestArgs): Promise<void> {
        await this.handleAccept(args)
	}
} 