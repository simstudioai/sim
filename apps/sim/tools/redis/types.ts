import type { ToolResponse } from '@/tools/types'

export interface RedisBaseParams {
  url: string
}

export interface RedisGetParams extends RedisBaseParams {
  key: string
}

export interface RedisSetParams extends RedisBaseParams {
  key: string
  value: string
  ex?: number
}

export interface RedisDeleteParams extends RedisBaseParams {
  key: string
}

export interface RedisKeysParams extends RedisBaseParams {
  pattern?: string
}

export interface RedisCommandParams extends RedisBaseParams {
  command: string
}

export interface RedisHSetParams extends RedisBaseParams {
  key: string
  field: string
  value: string
}

export interface RedisHGetParams extends RedisBaseParams {
  key: string
  field: string
}

export interface RedisHGetAllParams extends RedisBaseParams {
  key: string
}

export interface RedisIncrParams extends RedisBaseParams {
  key: string
}

export interface RedisIncrbyParams extends RedisBaseParams {
  key: string
  increment: number
}

export interface RedisExistsParams extends RedisBaseParams {
  key: string
}

export interface RedisSetnxParams extends RedisBaseParams {
  key: string
  value: string
}

export interface RedisExpireParams extends RedisBaseParams {
  key: string
  seconds: number
}

export interface RedisTtlParams extends RedisBaseParams {
  key: string
}

export interface RedisLPushParams extends RedisBaseParams {
  key: string
  value: string
}

export interface RedisLRangeParams extends RedisBaseParams {
  key: string
  start: number
  stop: number
}

export interface RedisRPushParams extends RedisBaseParams {
  key: string
  value: string
}

export interface RedisLPopParams extends RedisBaseParams {
  key: string
}

export interface RedisRPopParams extends RedisBaseParams {
  key: string
}

export interface RedisLLenParams extends RedisBaseParams {
  key: string
}

export interface RedisHDelParams extends RedisBaseParams {
  key: string
  field: string
}

export interface RedisPersistParams extends RedisBaseParams {
  key: string
}

export interface RedisGetResponse extends ToolResponse {
  output: {
    key: string
    value: string | null
  }
}

export interface RedisSetResponse extends ToolResponse {
  output: {
    key: string
    result: string
  }
}

export interface RedisDeleteResponse extends ToolResponse {
  output: {
    key: string
    deletedCount: number
  }
}

export interface RedisKeysResponse extends ToolResponse {
  output: {
    pattern: string
    keys: string[]
    count: number
  }
}

export interface RedisCommandResponse extends ToolResponse {
  output: {
    command: string
    result: unknown
  }
}

export interface RedisHSetResponse extends ToolResponse {
  output: {
    key: string
    field: string
    result: number
  }
}

export interface RedisHGetResponse extends ToolResponse {
  output: {
    key: string
    field: string
    value: string | null
  }
}

export interface RedisHGetAllResponse extends ToolResponse {
  output: {
    key: string
    fields: Record<string, string>
    fieldCount: number
  }
}

export interface RedisIncrResponse extends ToolResponse {
  output: {
    key: string
    value: number
  }
}

export interface RedisIncrbyResponse extends ToolResponse {
  output: {
    key: string
    value: number
  }
}

export interface RedisExistsResponse extends ToolResponse {
  output: {
    key: string
    exists: boolean
  }
}

export interface RedisSetnxResponse extends ToolResponse {
  output: {
    key: string
    wasSet: boolean
  }
}

export interface RedisExpireResponse extends ToolResponse {
  output: {
    key: string
    result: number
  }
}

export interface RedisTtlResponse extends ToolResponse {
  output: {
    key: string
    ttl: number
  }
}

export interface RedisLPushResponse extends ToolResponse {
  output: {
    key: string
    length: number
  }
}

export interface RedisLRangeResponse extends ToolResponse {
  output: {
    key: string
    values: string[]
    count: number
  }
}

export interface RedisRPushResponse extends ToolResponse {
  output: {
    key: string
    length: number
  }
}

export interface RedisLPopResponse extends ToolResponse {
  output: {
    key: string
    value: string | null
  }
}

export interface RedisRPopResponse extends ToolResponse {
  output: {
    key: string
    value: string | null
  }
}

export interface RedisLLenResponse extends ToolResponse {
  output: {
    key: string
    length: number
  }
}

export interface RedisHDelResponse extends ToolResponse {
  output: {
    key: string
    field: string
    deleted: number
  }
}

export interface RedisPersistResponse extends ToolResponse {
  output: {
    key: string
    result: number
  }
}
