export interface CommandInput {
	command: string; // The bash command to execute
	workingDirectory?: string; // Optional working directory (defaults to workspace root)
	timeout?: number; // Optional timeout in milliseconds (default: 30000)
	shell?: string; // Optional shell to use (default: /bin/bash)
}

export interface CommandOutput {
	stdout: string; // Standard output from the command
	stderr: string; // Standard error from the command
	exitCode: number; // Exit code of the command
	duration: number; // Execution duration in milliseconds
	command: string; // The executed command
	workingDirectory: string; // The directory where command was executed
	timedOut: boolean; // Whether the command timed out
}
