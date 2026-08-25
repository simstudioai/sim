/**
 * Build the standard installer invocation for this bundled skill pack.
 * `install` and `add` are accepted as readable aliases; direct flags keep the
 * shortest `bunx sim-skills --skill ...` form.
 */
export function buildInstallerArguments(
  pluginRoot: string,
  arguments_: readonly string[]
): string[] {
  const [command, ...rest] = arguments_

  if (command === 'install' || command === 'add') {
    return ['add', pluginRoot, ...rest]
  }

  if (command && !command.startsWith('-')) {
    throw new Error(
      `Unknown command "${command}". Pass installer flags directly or use "install" or "add".`
    )
  }

  return ['add', pluginRoot, ...arguments_]
}
