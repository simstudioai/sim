/**
 * LangChain tools for universal integrator
 */

import { Tool } from "@langchain/core/tools";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export class BashTool extends Tool {
  name = "bash";
  description = "Execute bash commands in the repository";
  private simRepo: string;
  private verbose: boolean;

  constructor(simRepo: string, verbose: boolean) {
    super();
    this.simRepo = simRepo;
    this.verbose = verbose;
  }

  async _call(input: string): Promise<string> {
    try {
      if (this.verbose) console.log(`[bash] ${input}`);
      const result = execSync(input, {
        cwd: this.simRepo,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return result;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

export class WebFetchTool extends Tool {
  name = "web_fetch";
  description = "Fetch content from URLs";
  private verbose: boolean;

  constructor(verbose: boolean) {
    super();
    this.verbose = verbose;
  }

  async _call(input: string): Promise<string> {
    try {
      if (this.verbose) console.log(`[fetch] ${input}`);
      const response = await fetch(input);
      return await response.text();
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

export class ReadTool extends Tool {
  name = "read";
  description = "Read file contents";
  private simRepo: string;
  private verbose: boolean;

  constructor(simRepo: string, verbose: boolean) {
    super();
    this.simRepo = simRepo;
    this.verbose = verbose;
  }

  async _call(input: string): Promise<string> {
    try {
      if (this.verbose) console.log(`[read] ${input}`);
      const filePath = path.resolve(this.simRepo, input);
      return fs.readFileSync(filePath, "utf-8");
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

export class WriteTool extends Tool {
  name = "write";
  description = "Write content to files";
  private simRepo: string;
  private verbose: boolean;
  private dryRun: boolean;
  private outDir: string;

  constructor(simRepo: string, verbose: boolean, dryRun: boolean, outDir: string) {
    super();
    this.simRepo = simRepo;
    this.verbose = verbose;
    this.dryRun = dryRun;
    this.outDir = outDir;
  }

  async _call(input: string): Promise<string> {
    try {
      const [filePath, ...contentParts] = input.split("\n");
      const content = contentParts.join("\n");

      if (this.verbose) console.log(`[write] ${filePath}`);

      const targetPath = this.dryRun
        ? path.resolve(this.outDir, filePath)
        : path.resolve(this.simRepo, filePath);

      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(targetPath, content, "utf-8");
      return `Written to ${targetPath}`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

export class EditTool extends Tool {
  name = "edit";
  description = "Edit file contents (find and replace)";
  private simRepo: string;
  private verbose: boolean;

  constructor(simRepo: string, verbose: boolean) {
    super();
    this.simRepo = simRepo;
    this.verbose = verbose;
  }

  async _call(input: string): Promise<string> {
    try {
      const [filePath, oldString, newString] = input.split("\n||||\n");
      if (this.verbose) console.log(`[edit] ${filePath}`);

      const targetPath = path.resolve(this.simRepo, filePath);
      let content = fs.readFileSync(targetPath, "utf-8");
      content = content.replace(oldString, newString);
      fs.writeFileSync(targetPath, content, "utf-8");
      return `Edited ${filePath}`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

export class GlobTool extends Tool {
  name = "glob";
  description = "Find files matching a pattern";
  private simRepo: string;
  private verbose: boolean;

  constructor(simRepo: string, verbose: boolean) {
    super();
    this.simRepo = simRepo;
    this.verbose = verbose;
  }

  async _call(input: string): Promise<string> {
    try {
      if (this.verbose) console.log(`[glob] ${input}`);
      const result = execSync(`find ${this.simRepo} -name "${input}"`, {
        encoding: "utf-8",
      });
      return result;
    } catch (error) {
      return "No matches found";
    }
  }
}

export class GrepTool extends Tool {
  name = "grep";
  description = "Search for text in files";
  private simRepo: string;
  private verbose: boolean;

  constructor(simRepo: string, verbose: boolean) {
    super();
    this.simRepo = simRepo;
    this.verbose = verbose;
  }

  async _call(input: string): Promise<string> {
    try {
      if (this.verbose) console.log(`[grep] ${input}`);
      const result = execSync(`grep -r "${input}" ${this.simRepo}`, {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return result;
    } catch (error) {
      return "No matches found";
    }
  }
}

export class WebSearchTool extends Tool {
  name = "web_search";
  description = "Search the web for information";
  private verbose: boolean;

  constructor(verbose: boolean) {
    super();
    this.verbose = verbose;
  }

  async _call(input: string): Promise<string> {
    if (this.verbose) console.log(`[search] ${input}`);
    // Note: Real implementation would use a search API
    return `Search results for: ${input}`;
  }
}
