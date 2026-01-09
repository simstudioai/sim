import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import type { CommandInput, CommandOutput } from "@/tools/command/types";

export async function POST(request: NextRequest) {
	try {
		const params: CommandInput = await request.json();

		// Validate input
		if (!params.command) {
			return NextResponse.json(
				{ error: "Command is required" },
				{ status: 400 },
			);
		}

		// Set default values
		const workingDirectory = params.workingDirectory || process.cwd();
		const timeout = params.timeout || 30000;
		const shell = params.shell || "/bin/bash";

		// Execute command
		const startTime = Date.now();
		const result = await executeCommand(
			params.command,
			workingDirectory,
			timeout,
			shell,
		);
		const duration = Date.now() - startTime;

		const output: CommandOutput = {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode,
			duration,
			command: params.command,
			workingDirectory,
			timedOut: result.timedOut,
		};

		return NextResponse.json(output);
	} catch (error) {
		console.error("Command execution error:", error);
		return NextResponse.json(
			{
				error: error instanceof Error ? error.message : "Unknown error occurred",
			},
			{ status: 500 },
		);
	}
}

interface ExecutionResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
}

function executeCommand(
	command: string,
	workingDirectory: string,
	timeout: number,
	shell: string,
): Promise<ExecutionResult> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		// Merge environment variables
		const env = {
			...process.env,
		};

		// Spawn the process
		const proc = spawn(shell, ["-c", command], {
			cwd: workingDirectory,
			env,
			timeout,
		});

		// Set up timeout
		const timeoutId = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGTERM");

			// Force kill after 5 seconds if still running
			setTimeout(() => {
				if (!proc.killed) {
					proc.kill("SIGKILL");
				}
			}, 5000);
		}, timeout);

		// Capture stdout
		proc.stdout?.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		// Capture stderr
		proc.stderr?.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		// Handle process completion
		proc.on("close", (code: number | null) => {
			clearTimeout(timeoutId);
			resolve({
				stdout,
				stderr,
				exitCode: code ?? -1,
				timedOut,
			});
		});

		// Handle process errors
		proc.on("error", (error: Error) => {
			clearTimeout(timeoutId);
			resolve({
				stdout,
				stderr: stderr + `\nProcess error: ${error.message}`,
				exitCode: -1,
				timedOut,
			});
		});
	});
}
