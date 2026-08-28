/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  CODEX_APT,
  CODEX_CLI_VERSION,
  CODEX_CLI_VERSION_ASSERT,
  CODEX_GLOBAL_NPM_PACKAGES,
} from '@/scripts/codex-sandbox-packages'

describe('Codex sandbox package contract', () => {
  it('pins exactly one Codex CLI version and asserts it during image builds', () => {
    expect(CODEX_GLOBAL_NPM_PACKAGES).toContain(`@openai/codex@${CODEX_CLI_VERSION}`)
    expect(CODEX_CLI_VERSION_ASSERT).toContain(CODEX_CLI_VERSION)
    expect(CODEX_GLOBAL_NPM_PACKAGES.some((entry) => entry.endsWith('@latest'))).toBe(false)
  })

  it('includes the repository and inner-sandbox system dependencies', () => {
    expect(CODEX_APT).toEqual(
      expect.arrayContaining(['git', 'gh', 'ripgrep', 'ca-certificates', 'bubblewrap'])
    )
  })
})
