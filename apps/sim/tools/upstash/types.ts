import type { ToolResponse } from '@/tools/types'

export interface UpstashRedisBaseParams {
  restUrl: string
  restToken: string
}

export interface UpstashRedisGetParams extends UpstashRedisBaseParams {
  key: string
}

export interface UpstashRedisSetParams extends UpstashRedisBaseParams {
  key: string
  value: string
  ex?: number
}

export interface UpstashRedisDeleteParams extends UpstashRedisBaseParams {
  key: string
}

export interface UpstashRedisKeysParams extends UpstashRedisBaseParams {
  pattern?: string
}

export interface UpstashRedisCommandParams extends UpstashRedisBaseParams {
  command: string
}

export interface UpstashRedisHSetParams extends UpstashRedisBaseParams {
  key: string
  field: string
  value: string
}

export interface UpstashRedisHGetParams extends UpstashRedisBaseParams {
  key: string
  field: string
}

export interface UpstashRedisHGetAllParams extends UpstashRedisBaseParams {
  key: string
}

export interface UpstashRedisIncrParams extends UpstashRedisBaseParams {
  key: string
}

export interface UpstashRedisExpireParams extends UpstashRedisBaseParams {
  key: string
  seconds: number
}

export interface UpstashRedisTtlParams extends UpstashRedisBaseParams {
  key: string
}

export interface UpstashRedisLPushParams extends UpstashRedisBaseParams {
  key: string
  value: string
}

export interface UpstashRedisLRangeParams extends UpstashRedisBaseParams {
  key: string
  start: number
  stop: number
}

export interface UpstashRedisGetResponse extends ToolResponse {
  output: {
    key: string
    value: string | null
  }
}

export interface UpstashRedisSetResponse extends ToolResponse {
  output: {
    key: string
    result: string
  }
}

export interface UpstashRedisDeleteResponse extends ToolResponse {
  output: {
    key: string
    deletedCount: number
  }
}

export interface UpstashRedisKeysResponse extends ToolResponse {
  output: {
    pattern: string
    keys: string[]
    count: number
  }
}

export interface UpstashRedisCommandResponse extends ToolResponse {
  output: {
    command: string
    result: unknown
  }
}

export interface UpstashRedisHSetResponse extends ToolResponse {
  output: {
    key: string
    field: string
    result: number
  }
}

export interface UpstashRedisHGetResponse extends ToolResponse {
  output: {
    key: string
    field: string
    value: string | null
  }
}

export interface UpstashRedisHGetAllResponse extends ToolResponse {
  output: {
    key: string
    fields: Record<string, string>
    fieldCount: number
  }
}

export interface UpstashRedisIncrResponse extends ToolResponse {
  output: {
    key: string
    value: number
  }
}

export interface UpstashRedisExpireResponse extends ToolResponse {
  output: {
    key: string
    result: number
  }
}

export interface UpstashRedisTtlResponse extends ToolResponse {
  output: {
    key: string
    ttl: number
  }
}

export interface UpstashRedisLPushResponse extends ToolResponse {
  output: {
    key: string
    length: number
  }
}

export interface UpstashRedisLRangeResponse extends ToolResponse {
  output: {
    key: string
    values: string[]
    count: number
  }
}

export interface UpstashRedisExistsParams extends UpstashRedisBaseParams {
  key: string
}

export interface UpstashRedisExistsResponse extends ToolResponse {
  output: {
    key: string
    exists: boolean
  }
}

export interface UpstashRedisSetnxParams extends UpstashRedisBaseParams {
  key: string
  value: string
}

export interface UpstashRedisSetnxResponse extends ToolResponse {
  output: {
    key: string
    wasSet: boolean
  }
}

export interface UpstashRedisIncrbyParams extends UpstashRedisBaseParams {
  key: string
  increment: number
}

export interface UpstashRedisIncrbyResponse extends ToolResponse {
  output: {
    key: string
    value: number
  }
}
