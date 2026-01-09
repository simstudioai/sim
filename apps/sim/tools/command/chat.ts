import type { CommandInput, CommandOutput } from '@/tools/command/types'
import type { ToolConfig } from '@/tools/types'

export const commandExecTool: ToolConfig<CommandInput, CommandOutput> = {
	id: 'command_exec',
	name: 'Command',
	description: 'Execute bash commands with custom environment variables',
	version: '1.0.0',

	params: {
		command: {
			type: 'string',
			required: true,
			visibility: 'user-or-llm',
			description: 'The bash command to execute',
		},
		workingDirectory: {
			type: 'string',
			required: false,
			visibility: 'user-only',
			description: 'Directory where the command will be executed',
		},
		timeout: {
			type: 'number',
			required: false,
			visibility: 'user-only',
			description: 'Maximum execution time in milliseconds',
		},
		shell: {
			type: 'string',
			required: false,
			visibility: 'user-only',
			description: 'Shell to use for execution',
		},
	},

	request: {
		url: '/api/tools/command/exec',
		method: 'POST',
		headers: () => ({
			'Content-Type': 'application/json',
		}),
		body: (params) => ({
			command: params.command,
			workingDirectory: params.workingDirectory,
			timeout: params.timeout || 30000,
			shell: params.shell || '/bin/bash',
		}),
	},
};
