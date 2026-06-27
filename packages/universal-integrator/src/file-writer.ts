/**
 * File writer for generated integration files.
 *
 * Writes generated code to the correct locations under apps/sim/.
 * Creates directories as needed. Supports dry-run mode.
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface FileToWrite {
  /** Relative path under the workspace, e.g. 'apps/sim/tools/stripe/stripe_customers.ts' */
  path: string;
  content: string;
}

export interface WriteResult {
  path: string;
  action: "created" | "updated" | "skipped" | "error";
  error?: string;
}

export interface FileWriterOptions {
  /** Workspace root — absolute path to the sim repo. */
  workspaceRoot: string;
  /** If true, don't actually write, just report what would be done. */
  dryRun: boolean;
}

export class FileWriter {
  private workspaceRoot: string;
  private dryRun: boolean;
  results: WriteResult[] = [];

  constructor(options: FileWriterOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.dryRun = options.dryRun;
  }

  /**
   * Write multiple files to disk.
   */
  async writeAll(files: FileToWrite[]): Promise<WriteResult[]> {
    for (const file of files) {
      const result = await this.writeOne(file);
      this.results.push(result);
    }
    return this.results;
  }

  /**
   * Write a single file.
   */
  private async writeOne(file: FileToWrite): Promise<WriteResult> {
    const absPath = join(this.workspaceRoot, file.path);
    const dir = dirname(absPath);

    try {
      // Create directory if needed
      if (!existsSync(dir)) {
        if (!this.dryRun) {
          await mkdir(dir, { recursive: true });
        }
      }

      // Check if file already exists
      const exists = existsSync(absPath);
      const action = exists ? "updated" : "created";

      if (this.dryRun) {
        return { path: file.path, action };
      }

      await writeFile(absPath, file.content, "utf-8");
      return { path: file.path, action };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { path: file.path, action: "error", error };
    }
  }

  /**
   * Print a summary of what was written.
   */
  printSummary(): void {
    const created = this.results.filter((r) => r.action === "created");
    const updated = this.results.filter((r) => r.action === "updated");
    const errors = this.results.filter((r) => r.action === "error");
    const skipped = this.results.filter((r) => r.action === "skipped");

    console.log(`\n📁 Files written:`);
    console.log(`   Created: ${created.length}`);
    console.log(`   Updated: ${updated.length}`);
    console.log(`   Skipped: ${skipped.length}`);
    console.log(`   Errors:  ${errors.length}`);

    if (errors.length > 0) {
      console.log(`\n❌ Errors:`);
      errors.forEach((e) => console.log(`   ${e.path}: ${e.error}`));
    }

    if (created.length > 0) {
      console.log(`\n✨ New files:`);
      created.forEach((c) => console.log(`   + ${c.path}`));
    }
  }
}
