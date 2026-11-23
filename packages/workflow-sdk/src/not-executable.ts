/**
 * The error every runtime export of the SDK throws, and the stub that throws it: workflow and
 * declaration files are compiled or read statically, never executed.
 */

/** Thrown by every runtime export: workflow files are compiled, never executed. */
export class SimSdkNotExecutable extends Error {
  readonly export: string

  constructor(exportName: string) {
    super(
      `@sim/workflow-sdk: \`${exportName}\` does not run. Workflow files are compiled by Sim, never executed; check them with \`sim workflows source apply --dry-run\` or a type-check.`
    )
    this.name = 'SimSdkNotExecutable'
    this.export = exportName
  }
}

/** Throws {@link SimSdkNotExecutable} for `exportName`. */
export function notExecutable(exportName: string): never {
  throw new SimSdkNotExecutable(exportName)
}

/**
 * A function that throws `SimSdkNotExecutable` when called, constructed with `new`, or read a
 * property of. The target is a function declaration, since an arrow function has no [[Construct]]
 * and `new` would throw a `TypeError` before the trap runs.
 */
export function stub(exportName: string): (...args: unknown[]) => never {
  function target(): never {
    return notExecutable(exportName)
  }
  return new Proxy(target, {
    apply: () => notExecutable(exportName),
    construct: () => notExecutable(exportName),
    get: (_target, property) => notExecutable(`${exportName}.${String(property)}`),
  })
}
