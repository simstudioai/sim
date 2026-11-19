/**
 * The runtime entry of `@sim/workflow-sdk/workspace`. Declaration files are read statically and
 * never run, so every export throws `SimSdkNotExecutable`.
 */
import { notExecutable, stub } from '../not-executable'

export const defineSecrets = stub('defineSecrets')
export const defineCredentials = stub('defineCredentials')
export const defineTable = stub('defineTable')
export const defineTool = stub('defineTool')
export const defineKnowledgeBase = stub('defineKnowledgeBase')
export const defineMcpServer = stub('defineMcpServer')
export const defineDeployment = stub('defineDeployment')

export { codeFile, env, stored } from '../runtime'

/** Throws `SimSdkNotExecutable` for every `column.<type>()` call. */
export const column = new Proxy(
  {},
  {
    get: (_target, property) => () => notExecutable(`column.${String(property)}`),
  }
)
