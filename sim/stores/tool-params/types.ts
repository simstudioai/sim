export interface ToolParamsStore {
  params: Record<string, Record<string, string>>
  clearedParams: Record<string, Record<string, boolean>>
  setParam: (toolId: string, paramId: string, value: string) => void
  markParamAsCleared: (instanceId: string, paramId: string) => void
  isParamCleared: (instanceId: string, paramId: string) => boolean
  getParam: (toolId: string, paramId: string) => string | undefined
  getToolParams: (toolId: string) => Record<string, string>
  isEnvVarReference: (value: string) => boolean
  resolveParamValue: (toolId: string, paramId: string, instanceId?: string) => string | undefined
  clear: () => void
}
