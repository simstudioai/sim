/**
 * The runtime entry of `@sim/workflow-sdk/workspace`. Declaration files are read statically and
 * never run, so every export throws `SimSdkNotExecutable`.
 */
import { SimSdkNotExecutable } from '../runtime'

function notExecutable(exportName: string): never {
  throw new SimSdkNotExecutable(exportName)
}

/** Throws `SimSdkNotExecutable`: `defineSecrets` is read statically, never run. */
export function defineSecrets(): never {
  return notExecutable('defineSecrets')
}

/** Throws `SimSdkNotExecutable`: `defineCredentials` is read statically, never run. */
export function defineCredentials(): never {
  return notExecutable('defineCredentials')
}

/** Throws `SimSdkNotExecutable`: `defineTable` is read statically, never run. */
export function defineTable(): never {
  return notExecutable('defineTable')
}

/** Throws `SimSdkNotExecutable`: `defineTool` is read statically, never run. */
export function defineTool(): never {
  return notExecutable('defineTool')
}

/** Throws `SimSdkNotExecutable`: `defineKnowledgeBase` is read statically, never run. */
export function defineKnowledgeBase(): never {
  return notExecutable('defineKnowledgeBase')
}

/** Throws `SimSdkNotExecutable`: `defineMcpServer` is read statically, never run. */
export function defineMcpServer(): never {
  return notExecutable('defineMcpServer')
}

/** Throws `SimSdkNotExecutable`: `defineDeployment` is read statically, never run. */
export function defineDeployment(): never {
  return notExecutable('defineDeployment')
}

export { codeFile, env, stored } from '../runtime'

/** Throws `SimSdkNotExecutable` for every `column.<type>()` call. */
export const column = new Proxy(
  {},
  {
    get: (_target, property) => () => notExecutable(`column.${String(property)}`),
  }
)
