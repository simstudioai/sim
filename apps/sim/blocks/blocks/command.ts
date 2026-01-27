import { Terminal } from "lucide-react";
import type { BlockConfig } from "@/blocks/types";

export const commandBlock: BlockConfig = {
	type: "command",
	name: "Command",
	description: "Execute bash commands in a specified working directory with optional timeout and shell configuration.",
	category: "tools",
	bgColor: "#10B981",
	icon: Terminal,
	subBlocks: [
		{
			id: "command",
			title: "Command",
			type: "long-input",
			placeholder: 'echo "Hello World"',
			required: true,
		},
		{
			id: "workingDirectory",
			title: "Working Directory",
			type: "short-input",
			placeholder: "/path/to/directory (optional)",
			required: false,
		},
		{
			id: "timeout",
			title: "Timeout (ms)",
			type: "short-input",
			placeholder: "30000",
			value: () => "30000",
			required: false,
		},
		{
			id: "shell",
			title: "Shell",
			type: "short-input",
			placeholder: "/bin/bash",
			value: () => "/bin/bash",
			required: false,
		},
	],
	tools: {
		access: ["command_exec"],
		config: {
			tool: () => "command_exec",
			params: (params: Record<string, any>) => {
				const transformed: Record<string, any> = {
					command: params.command,
				};

				if (params.workingDirectory) {
					transformed.workingDirectory = params.workingDirectory;
				}

				if (params.timeout) {
					const timeoutNum = Number.parseInt(params.timeout as string, 10);
					if (!Number.isNaN(timeoutNum)) {
						transformed.timeout = timeoutNum;
					}
				}

				if (params.shell) {
					transformed.shell = params.shell;
				}

				return transformed;
			},
		},
	},
	inputs: {
		command: { type: "string", description: "The bash command to execute" },
		workingDirectory: { type: "string", description: "Directory where the command will be executed" },
		timeout: { type: "number", description: "Maximum execution time in milliseconds" },
		shell: { type: "string", description: "Shell to use for execution" },
	},
	outputs: {
		stdout: { type: "string", description: "Standard output from the command" },
		stderr: { type: "string", description: "Standard error from the command" },
		exitCode: { type: "number", description: "Command exit code (0 = success)" },
		duration: { type: "number", description: "Execution time in milliseconds" },
		command: { type: "string", description: "The executed command" },
		workingDirectory: { type: "string", description: "The directory where command was executed" },
		timedOut: { type: "boolean", description: "Whether the command exceeded the timeout" },
	},
};
