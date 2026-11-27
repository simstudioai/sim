/**
 * The error every runtime export of the SDK throws, and the stub that throws it: workflow and
 * declaration files are compiled or read statically, never executed.
 */

/** Thrown by every runtime export: Sim source files are read statically, never executed. */
export class SimSdkNotExecutable extends Error {
  readonly export: string

  constructor(exportName: string) {
    super(
      `@sim/workflow-sdk: \`${exportName}\` does not run. Sim source files are read statically, never executed; check them with \`sim workflows source check\` or \`sim workspaces source check\`.`
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
