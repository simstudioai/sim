/**
 * The runtime entry of `@sim/workflow-sdk/workspace`. Declaration files are read statically and
 * never run, so every export throws `SimSdkNotExecutable`.
 */
import { SimSdkNotExecutable } from '../runtime'

function notExecutable(exportName: string): never {
  throw new SimSdkNotExecutable(exportName)
}

export function defineTable(): never {
  return notExecutable('defineTable')
}

export function defineTool(): never {
  return notExecutable('defineTool')
}

export function codeFile(): never {
  return notExecutable('codeFile')
}

export function defineKnowledgeBase(): never {
  return notExecutable('defineKnowledgeBase')
}

export function defineMcpServer(): never {
  return notExecutable('defineMcpServer')
}

export function defineDeployment(): never {
  return notExecutable('defineDeployment')
}

export { env, stored } from '../runtime'

export const column = new Proxy(
  {},
  {
    get: (_target, property) => () => notExecutable(`column.${String(property)}`),
  }
)
