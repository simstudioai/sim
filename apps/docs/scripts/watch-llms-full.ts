import { watch } from 'node:fs'
import { createLogger } from '@sim/logger'
import { spawn } from 'bun'
import { OPENAPI_SPEC_FILES } from '@/lib/openapi-specs'

const logger = createLogger('DocsLlmsFullWatcher')
const WATCHED_ROOT_FILES = new Set(['source.config.ts', ...OPENAPI_SPEC_FILES])

let debounceTimer: ReturnType<typeof setTimeout> | undefined
let pending = false
let running = false

async function regenerate(): Promise<void> {
  running = true
  try {
    while (pending) {
      pending = false
      const child = spawn(['bun', 'run', 'llms-full:generate'], {
        stdin: 'ignore',
        stdout: 'inherit',
        stderr: 'inherit',
      })
      const exitCode = await child.exited
      if (exitCode !== 0) {
        logger.warn('Documentation asset generation failed; retaining the previous asset', {
          exitCode,
        })
      }
    }
  } finally {
    running = false
  }
}

function scheduleGeneration(): void {
  pending = true
  if (running) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined
    void regenerate()
  }, 250)
}

for (const directory of ['content', 'lib']) {
  watch(directory, { recursive: true }, scheduleGeneration)
}

watch('.', (_, changedPath) => {
  if (changedPath && WATCHED_ROOT_FILES.has(changedPath.toString())) scheduleGeneration()
})
