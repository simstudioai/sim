/**
 * REAL COMPREHENSIVE i18n: Process ENTIRE CODEBASE
 *
 * Scan ALL directories:
 * - /apps (sim, docs, pii, realtime)
 * - /packages (all 20+ packages)
 * - /docker
 * - /helm
 * - /blocks, /tools, /triggers, /connectors
 * - EVERYTHING with hardcoded strings
 *
 * Extract ALL strings, translate ALL, update ALL.
 */

import { execSync } from "child_process";
import { join } from "node:path";

const ROOT = process.cwd();

async function scanAllFiles() {
  console.log("🚀 FULL CODEBASE i18n SCAN - NO FILES LEFT BEHIND\n");

  // Find ALL .ts/.tsx/.py files (except node_modules, .next, .git)
  const findCmd = `find . \\
    -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.py" \\) \\
    ! -path "./node_modules/*" \\
    ! -path "./.next/*" \\
    ! -path "./.git/*" \\
    ! -path "*/.turbo/*" \\
    ! -path "*/dist/*" \\
    ! -path "*/build/*" \\
    | wc -l`;

  try {
    const count = execSync(findCmd, { cwd: ROOT, encoding: "utf-8" });
    console.log(`📊 Total files to scan: ${count.trim()}`);

    // Show breakdown by directory
    const dirs = [
      "apps/sim",
      "apps/docs",
      "apps/pii",
      "apps/realtime",
      "packages",
      "docker",
      "helm",
    ];

    console.log("\n📂 Breakdown by directory:");
    for (const dir of dirs) {
      try {
        const dirCount = execSync(
          `find ${dir} -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.py" \\) 2>/dev/null | wc -l`,
          { cwd: ROOT, encoding: "utf-8" }
        );
        console.log(`   ${dir}: ${dirCount.trim()} files`);
      } catch {
        console.log(`   ${dir}: (not found or empty)`);
      }
    }
  } catch (error) {
    console.error("Error scanning:", error);
  }

  console.log(`\n⚠️  CRITICAL: Need to process THOUSANDS of files!`);
  console.log(`   Current comprehensive refactor only processed: 50 files (from first batch of apps/sim)`);
  console.log(`   This script MUST scan: /apps, /packages, /docker, /helm, AND ALL SUBDIRS\n`);

  console.log(`🔧 NEXT STEPS:`);
  console.log(`   1. Create PARALLEL translation pipeline for 1000s of files`);
  console.log(`   2. Batch translations by directory for efficiency`);
  console.log(`   3. Update components to use useTranslations() or equivalent`);
  console.log(`   4. Verify NO hardcoded strings remain`);
}

scanAllFiles().catch(console.error);
