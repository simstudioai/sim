import { MongoClient } from 'mongodb'
import type { MongoDBConnectionConfig } from '@/tools/mongodb/types'

export async function createMongoDBConnection(config: MongoDBConnectionConfig) {
  const credentials =
    config.username && config.password
      ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
      : ''

  const queryParams = new URLSearchParams()

  if (config.authSource) {
    queryParams.append('authSource', config.authSource)
  }

  if (config.ssl === 'required') {
    queryParams.append('ssl', 'true')
  }

  const queryString = queryParams.toString()
  const uri = `mongodb://${credentials}${config.host}:${config.port}/${config.database}${queryString ? `?${queryString}` : ''}`

  const client = new MongoClient(uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
    maxPoolSize: 1,
  })

  await client.connect()
  return client
}

export function validateFilter(filter: string): { isValid: boolean; error?: string } {
  try {
    const parsed = JSON.parse(filter)

    const dangerousOperators = ['$where', '$regex', '$expr', '$function', '$accumulator', '$let']

    const checkForDangerousOps = (obj: any): boolean => {
      if (typeof obj !== 'object' || obj === null) return false

      for (const key of Object.keys(obj)) {
        if (dangerousOperators.includes(key)) return true
        if (typeof obj[key] === 'object' && checkForDangerousOps(obj[key])) return true
      }
      return false
    }

    if (checkForDangerousOps(parsed)) {
      return {
        isValid: false,
        error: 'Filter contains potentially dangerous operators',
      }
    }

    return { isValid: true }
  } catch (error) {
    return {
      isValid: false,
      error: 'Invalid JSON format in filter',
    }
  }
}

export function validatePipeline(pipeline: string): { isValid: boolean; error?: string } {
  try {
    const parsed = JSON.parse(pipeline)

    if (!Array.isArray(parsed)) {
      return {
        isValid: false,
        error: 'Pipeline must be an array',
      }
    }

    const dangerousOperators = [
      '$where',
      '$function',
      '$accumulator',
      '$let',
      '$merge',
      '$out',
      '$currentOp',
      '$listSessions',
      '$listLocalSessions',
    ]

    const checkPipelineStage = (stage: any): boolean => {
      if (typeof stage !== 'object' || stage === null) return false

      for (const key of Object.keys(stage)) {
        if (dangerousOperators.includes(key)) return true
        if (typeof stage[key] === 'object' && checkPipelineStage(stage[key])) return true
      }
      return false
    }

    for (const stage of parsed) {
      if (checkPipelineStage(stage)) {
        return {
          isValid: false,
          error: 'Pipeline contains potentially dangerous operators',
        }
      }
    }

    return { isValid: true }
  } catch (error) {
    return {
      isValid: false,
      error: 'Invalid JSON format in pipeline',
    }
  }
}

export function sanitizeCollectionName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      'Invalid collection name. Must start with letter or underscore and contain only letters, numbers, and underscores.'
    )
  }
  return name
}
