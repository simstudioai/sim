import type { SandboxTask, SandboxTaskInput } from '@/lib/execution/sandbox/types'

/**
 * Helper that preserves the task's input type through declaration.
 * Mirrors the `task(...)` / `defineConfig(...)` pattern used elsewhere in the
 * codebase so sandbox tasks look familiar next to trigger.dev tasks.
 */
export function defineSandboxTask<TInput extends SandboxTaskInput = SandboxTaskInput>(
  task: SandboxTask<TInput>
): SandboxTask<TInput> {
  if (!task.id || !/^[a-z][a-z0-9-]*$/.test(task.id)) {
    throw new Error(`Sandbox task id must be kebab-case: got "${task.id}"`)
  }
  const brokerNames = new Set<string>()
  for (const broker of task.brokers) {
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(broker.name)) {
      throw new Error(
        `Sandbox broker name must be a valid JS identifier: got "${broker.name}" on task "${task.id}"`
      )
    }
    if (brokerNames.has(broker.name)) {
      throw new Error(`Duplicate broker name "${broker.name}" on task "${task.id}"`)
    }
    brokerNames.add(broker.name)
  }
  return task
}
