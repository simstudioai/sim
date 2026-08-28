/** Single source of truth for both Codex coding-agent sandbox images. */

import { CODEX_CLI_VERSION } from '@/providers/codex'
import {
  PI_BUN_VERSION,
  PI_SANDBOX_CPU_COUNT,
  PI_SANDBOX_MEMORY_GB,
  PI_SANDBOX_MEMORY_MB,
} from '@/scripts/pi-sandbox-packages'

export { CODEX_CLI_VERSION } from '@/providers/codex'
export const CODEX_BUN_VERSION = PI_BUN_VERSION
export const CODEX_NODE_MAJOR = 22

export const CODEX_GLOBAL_NPM_PACKAGES = [
  `bun@${CODEX_BUN_VERSION}`,
  `@openai/codex@${CODEX_CLI_VERSION}`,
] as const

export const CODEX_APT = [
  'git',
  'gh',
  'openssh-client',
  'ca-certificates',
  'ripgrep',
  'fd-find',
  'bubblewrap',
] as const

export const CODEX_NODE_VERSION_ASSERT =
  'node -e "const major = Number(process.versions.node.split(\'.\')[0]); if (major < 22) process.exit(1)"'
export const CODEX_BUN_VERSION_ASSERT = `test "$(bun --version)" = "${CODEX_BUN_VERSION}"`
export const CODEX_CLI_VERSION_ASSERT = `test "$(codex --version)" = "codex-cli ${CODEX_CLI_VERSION}"`

export const CODEX_SANDBOX_CPU_COUNT = PI_SANDBOX_CPU_COUNT
export const CODEX_SANDBOX_MEMORY_GB = PI_SANDBOX_MEMORY_GB
export const CODEX_SANDBOX_MEMORY_MB = PI_SANDBOX_MEMORY_MB
