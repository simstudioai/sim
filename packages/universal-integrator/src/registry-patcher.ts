/**
 * Registry patcher for Sim.ai integrations.
 *
 * Adds import lines and registry entries to:
 * - apps/sim/tools/registry.ts  → `export const tools: Record<string, ToolConfig>`
 * - apps/sim/blocks/registry.ts → `BLOCK_REGISTRY` and `BLOCK_META_REGISTRY`
 * - apps/sim/triggers/registry.ts → `TRIGGER_REGISTRY`
 *
 * Inserts entries in alphabetical order. Deduplicates imports.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface RegistryEntry {
  registryFile: string;
  importLine: string;
  registryLine: string;
  sortKey: string;
  /** If true, this entry goes into BLOCK_META_REGISTRY (not BLOCK_REGISTRY). */
  isBlockMeta?: boolean;
  /** If true, this entry goes into TRIGGER_REGISTRY. */
  isTrigger?: boolean;
}

export interface RegistryPatcherOptions {
  workspaceRoot: string;
  dryRun: boolean;
}

export class RegistryPatcher {
  private workspaceRoot: string;
  private dryRun: boolean;

  constructor(options: RegistryPatcherOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.dryRun = options.dryRun;
  }

  async applyAll(entries: RegistryEntry[]): Promise<void> {
    const byFile = new Map<string, RegistryEntry[]>();
    for (const entry of entries) {
      const existing = byFile.get(entry.registryFile) ?? [];
      existing.push(entry);
      byFile.set(entry.registryFile, existing);
    }

    for (const [file, fileEntries] of byFile) {
      await this.patchRegistry(file, fileEntries);
    }
  }

  private async patchRegistry(relativePath: string, entries: RegistryEntry[]): Promise<void> {
    const absPath = join(this.workspaceRoot, relativePath);
    const content = await readFile(absPath, "utf-8");

    // Deduplicate: skip entries already present
    const newEntries = entries.filter((e) => {
      const hasImport = content.includes(e.importLine.trim());
      const hasEntry = content.includes(e.registryLine.trim());
      return !(hasImport && hasEntry);
    });

    if (newEntries.length === 0) {
      console.log(`   Registry ${relativePath}: already up to date`);
      return;
    }

    let result = content;

    // Step 1: Insert unique import lines (deduplicated)
    const uniqueImports = [...new Set(newEntries.map((e) => e.importLine))];
    for (const importLine of uniqueImports.sort()) {
      if (result.includes(importLine.trim())) continue;

      // Find insertion point: after the last import line
      const lines = result.split("\n");
      let lastImportIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("import ")) lastImportIdx = i;
      }
      // Insert after last import, before the blank line that follows
      const before = lines.slice(0, lastImportIdx + 1);
      const after = lines.slice(lastImportIdx + 1);
      result = [...before, importLine, ...after].join("\n");
    }

    // Step 2: Insert registry map entries (alphabetically)
    result = this.insertRegistryEntries(result, newEntries);

    if (this.dryRun) {
      console.log(`   [DRY RUN] Would patch ${relativePath}`);
      return;
    }

    await writeFile(absPath, result, "utf-8");
    console.log(`   ✓ Patched ${relativePath}`);
  }

  private insertRegistryEntries(content: string, entries: RegistryEntry[]): string {
    // Determine which map to target based on entry flags
    const maps: Array<{ startMarker: string; entries: RegistryEntry[] }> = [];

    const toolEntries = entries.filter((e) => !e.isBlockMeta && !e.isTrigger);
    const blockEntries = entries.filter(
      (e) => !e.isBlockMeta && !e.isTrigger && e.registryFile.includes("blocks"),
    );
    const metaEntries = entries.filter((e) => e.isBlockMeta);
    const triggerEntries = entries.filter((e) => e.isTrigger);

    // We need to handle each map separately
    let result = content;

    // Tools: `export const tools: Record<string, ToolConfig> = {`
    if (
      toolEntries.length > 0 &&
      !toolEntries[0].registryFile.includes("blocks") &&
      !toolEntries[0].registryFile.includes("triggers")
    ) {
      result = this.insertIntoMap(result, "export const tools:", toolEntries);
    }

    // Blocks: `const BLOCK_REGISTRY: Record<string, BlockConfig> = {`
    if (blockEntries.length > 0) {
      result = this.insertIntoMap(
        result,
        "BLOCK_REGISTRY: Record<string, BlockConfig>",
        blockEntries,
      );
    }

    // BlockMeta: `const BLOCK_META_REGISTRY: Record<string, BlockMeta> = {`
    if (metaEntries.length > 0) {
      result = this.insertIntoMap(
        result,
        "BLOCK_META_REGISTRY: Record<string, BlockMeta>",
        metaEntries,
      );
    }

    // Triggers: `TRIGGER_REGISTRY: TriggerRegistry = {`
    if (triggerEntries.length > 0) {
      result = this.insertIntoMap(result, "TRIGGER_REGISTRY: TriggerRegistry", triggerEntries);
    }

    return result;
  }

  private insertIntoMap(content: string, marker: string, entries: RegistryEntry[]): string {
    const lines = content.split("\n");

    // Find the map
    let mapStart = -1;
    let mapEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(marker) && (lines[i].includes("= {") || lines[i].includes(": {"))) {
        mapStart = i + 1;
        // Find closing brace
        let depth = 1;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() === "};" || (lines[j].trim() === "}" && depth === 1)) {
            mapEnd = j;
            break;
          }
          if (lines[j].includes("{")) depth++;
          if (lines[j].includes("}")) depth--;
        }
        break;
      }
    }

    if (mapStart < 0 || mapEnd < 0) {
      console.warn(`   ⚠ Could not find map for "${marker}"`);
      return content;
    }

    // Insert entries alphabetically at the end of the map (before closing brace)
    const sorted = [...entries].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    for (const entry of sorted) {
      // Find alphabetical position
      let insertAt = mapEnd;
      for (let i = mapStart; i < mapEnd; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith("//") || line.startsWith("/*")) continue;
        const keyMatch = line.match(/^\s*(\w+):/);
        if (keyMatch) {
          if (entry.sortKey.localeCompare(keyMatch[1]) < 0) {
            insertAt = i;
            break;
          }
        }
      }
      lines.splice(insertAt, 0, `  ${entry.registryLine}`);
      mapEnd++; // Adjust end since we inserted
    }

    return lines.join("\n");
  }
}
