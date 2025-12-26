import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import { getStorageMethod, type StorageMethod } from '@/lib/core/storage'

const logger = createLogger('DocumentQueue')

interface QueueJob<T = unknown> {
  id: string
  type: string
  data: T
  timestamp: number
  attempts: number
  maxAttempts: number
}

interface QueueConfig {
  maxConcurrent: number
  retryDelay: number
  maxRetries: number
}

/**
 * Document processing queue that uses either Redis or in-memory storage.
 * Storage method is determined once at construction based on configuration.
 * No switching on transient errors.
 */
export class DocumentProcessingQueue {
  private config: QueueConfig
  private storageMethod: StorageMethod
  private processing = new Map<string, Promise<void>>()
  private inMemoryQueue: QueueJob[] = []
  private inMemoryProcessing = 0
  private processingStarted = false

  constructor(config: QueueConfig) {
    this.config = config
    this.storageMethod = getStorageMethod()
    logger.info(`DocumentProcessingQueue using ${this.storageMethod} storage`)
  }

  async addJob<T>(type: string, data: T, options: { maxAttempts?: number } = {}): Promise<string> {
    const job: QueueJob = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      type,
      data,
      timestamp: Date.now(),
      attempts: 0,
      maxAttempts: options.maxAttempts || this.config.maxRetries,
    }

    if (this.storageMethod === 'redis') {
      const redis = getRedisClient()
      if (!redis) {
        throw new Error('Redis configured but client unavailable')
      }
      await redis.lpush('document-queue', JSON.stringify(job))
      logger.info(`Job ${job.id} added to Redis queue`)
    } else {
      this.inMemoryQueue.push(job)
      logger.info(`Job ${job.id} added to in-memory queue`)
    }

    return job.id
  }

  async processJobs(processor: (job: QueueJob) => Promise<void>): Promise<void> {
    if (this.processingStarted) {
      logger.info('Queue processing already started, skipping')
      return
    }

    this.processingStarted = true
    logger.info(`Starting queue processing (${this.storageMethod})`)

    if (this.storageMethod === 'redis') {
      await this.processRedisJobs(processor)
    } else {
      await this.processInMemoryJobs(processor)
    }
  }

  private async processRedisJobs(processor: (job: QueueJob) => Promise<void>) {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis configured but client unavailable')
    }

    const processJobsContinuously = async () => {
      while (true) {
        if (this.processing.size >= this.config.maxConcurrent) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          continue
        }

        try {
          const result = await redis.rpop('document-queue')
          if (!result) {
            await new Promise((resolve) => setTimeout(resolve, 500))
            continue
          }

          const job: QueueJob = JSON.parse(result)
          const promise = this.executeJob(job, processor)
          this.processing.set(job.id, promise)

          promise.finally(() => {
            this.processing.delete(job.id)
          })
        } catch (error: any) {
          logger.error('Error processing Redis job:', error)
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
    }

    const processors = Array(this.config.maxConcurrent)
      .fill(null)
      .map(() => processJobsContinuously())

    Promise.allSettled(processors).catch((error) => {
      logger.error('Error in Redis queue processors:', error)
    })
  }

  private async processInMemoryJobs(processor: (job: QueueJob) => Promise<void>) {
    const processInMemoryContinuously = async () => {
      while (true) {
        if (this.inMemoryProcessing >= this.config.maxConcurrent) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          continue
        }

        const job = this.inMemoryQueue.shift()
        if (!job) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          continue
        }

        this.inMemoryProcessing++

        this.executeJob(job, processor).finally(() => {
          this.inMemoryProcessing--
        })
      }
    }

    const processors = Array(this.config.maxConcurrent)
      .fill(null)
      .map(() => processInMemoryContinuously())

    Promise.allSettled(processors).catch((error) => {
      logger.error('Error in in-memory queue processors:', error)
    })
  }

  private async executeJob(
    job: QueueJob,
    processor: (job: QueueJob) => Promise<void>
  ): Promise<void> {
    try {
      job.attempts++
      logger.info(`Processing job ${job.id} (attempt ${job.attempts}/${job.maxAttempts})`)

      await processor(job)
      logger.info(`Job ${job.id} completed successfully`)
    } catch (error) {
      logger.error(`Job ${job.id} failed (attempt ${job.attempts}):`, error)

      if (job.attempts < job.maxAttempts) {
        const delay = this.config.retryDelay * 2 ** (job.attempts - 1)

        setTimeout(async () => {
          if (this.storageMethod === 'redis') {
            const redis = getRedisClient()
            if (!redis) {
              logger.error('Redis unavailable for retry, job lost:', job.id)
              return
            }
            await redis.lpush('document-queue', JSON.stringify(job))
          } else {
            this.inMemoryQueue.push(job)
          }
        }, delay)

        logger.info(`Job ${job.id} will retry in ${delay}ms`)
      } else {
        logger.error(`Job ${job.id} failed permanently after ${job.attempts} attempts`)
      }
    }
  }

  async getQueueStats(): Promise<{
    pending: number
    processing: number
    storageMethod: StorageMethod
  }> {
    let pending = 0

    if (this.storageMethod === 'redis') {
      const redis = getRedisClient()
      if (redis) {
        pending = await redis.llen('document-queue')
      }
    } else {
      pending = this.inMemoryQueue.length
    }

    return {
      pending,
      processing: this.storageMethod === 'redis' ? this.processing.size : this.inMemoryProcessing,
      storageMethod: this.storageMethod,
    }
  }

  async clearQueue(): Promise<void> {
    if (this.storageMethod === 'redis') {
      const redis = getRedisClient()
      if (redis) {
        await redis.del('document-queue')
        logger.info('Redis queue cleared')
      }
    }

    this.inMemoryQueue.length = 0
    logger.info('In-memory queue cleared')
  }
}
