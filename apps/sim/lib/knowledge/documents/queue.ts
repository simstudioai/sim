import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient } from '@/lib/redis'

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

export class DocumentProcessingQueue {
  private config: QueueConfig
  private processing = new Map<string, Promise<void>>()
  private fallbackQueue: QueueJob[] = []
  private fallbackProcessing = 0
  private processingStarted = false

  constructor(config: QueueConfig) {
    this.config = config
  }

  private isRedisAvailable(): boolean {
    const redis = getRedisClient()
    return redis !== null
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

    if (this.isRedisAvailable()) {
      try {
        const redis = getRedisClient()!
        await redis.lpush('document-queue', JSON.stringify(job))
        logger.info(`Job ${job.id} added to Redis queue`)
        return job.id
      } catch (error) {
        logger.warn('Failed to add job to Redis, using fallback:', error)
      }
    }

    // Fallback to in-memory queue
    this.fallbackQueue.push(job)
    logger.info(`Job ${job.id} added to in-memory fallback queue`)
    return job.id
  }

  async processJobs(processor: (job: QueueJob) => Promise<void>): Promise<void> {
    if (this.processingStarted) {
      logger.info('Queue processing already started, skipping')
      return
    }

    this.processingStarted = true
    logger.info('Starting queue processing')

    if (this.isRedisAvailable()) {
      await this.processRedisJobs(processor)
    } else {
      await this.processFallbackJobs(processor)
    }
  }

  private async processRedisJobs(processor: (job: QueueJob) => Promise<void>) {
    const redis = getRedisClient()
    if (!redis) {
      logger.warn('Redis client not available, falling back to in-memory processing')
      await this.processFallbackJobs(processor)
      return
    }

    const processJobsContinuously = async () => {
      let consecutiveErrors = 0
      while (true) {
        if (this.processing.size >= this.config.maxConcurrent) {
          await new Promise((resolve) => setTimeout(resolve, 100)) // Wait before checking again
          continue
        }

        try {
          const currentRedis = getRedisClient()
          if (!currentRedis) {
            logger.warn('Redis connection lost, switching to fallback processing')
            await this.processFallbackJobs(processor)
            return
          }

          const result = await currentRedis.brpop('document-queue', 1)
          if (!result || !result[1]) {
            consecutiveErrors = 0 // Reset error counter on successful operation
            continue // Continue polling for jobs
          }

          const job: QueueJob = JSON.parse(result[1])
          const promise = this.executeJob(job, processor)
          this.processing.set(job.id, promise)

          promise.finally(() => {
            this.processing.delete(job.id)
          })

          consecutiveErrors = 0 // Reset error counter on success
          // Don't await here - let it process in background while we get next job
        } catch (error: any) {
          consecutiveErrors++

          if (
            error.message?.includes('Connection is closed') ||
            error.message?.includes('ECONNREFUSED') ||
            error.code === 'ECONNREFUSED' ||
            consecutiveErrors >= 5
          ) {
            logger.warn(
              `Redis connection failed (${consecutiveErrors} consecutive errors), switching to fallback processing:`,
              error.message
            )
            await this.processFallbackJobs(processor)
            return
          }

          logger.error('Error processing Redis job:', error)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(1000 * consecutiveErrors, 5000))
          ) // Exponential backoff
        }
      }
    }

    // Start multiple concurrent processors that run continuously
    const processors = Array(this.config.maxConcurrent)
      .fill(null)
      .map(() => processJobsContinuously())

    // Don't await - let processors run in background
    Promise.allSettled(processors).catch((error) => {
      logger.error('Error in Redis queue processors:', error)
    })
  }

  private async processFallbackJobs(processor: (job: QueueJob) => Promise<void>) {
    const processFallbackContinuously = async () => {
      while (true) {
        if (this.fallbackProcessing >= this.config.maxConcurrent) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          continue
        }

        const job = this.fallbackQueue.shift()
        if (!job) {
          await new Promise((resolve) => setTimeout(resolve, 500)) // Wait for new jobs
          continue
        }

        this.fallbackProcessing++

        this.executeJob(job, processor).finally(() => {
          this.fallbackProcessing--
        })
      }
    }

    // Start multiple concurrent processors for fallback queue
    const processors = Array(this.config.maxConcurrent)
      .fill(null)
      .map(() => processFallbackContinuously())

    // Don't await - let processors run in background
    Promise.allSettled(processors).catch((error) => {
      logger.error('Error in fallback queue processors:', error)
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
        // Retry logic with exponential backoff
        const delay = this.config.retryDelay * 2 ** (job.attempts - 1)

        setTimeout(async () => {
          if (this.isRedisAvailable()) {
            try {
              const redis = getRedisClient()!
              await redis.lpush('document-queue', JSON.stringify(job))
            } catch (retryError) {
              logger.warn('Failed to requeue job to Redis, using fallback:', retryError)
              this.fallbackQueue.push(job)
            }
          } else {
            this.fallbackQueue.push(job)
          }
        }, delay)

        logger.info(`Job ${job.id} will retry in ${delay}ms`)
      } else {
        logger.error(`Job ${job.id} failed permanently after ${job.attempts} attempts`)
      }
    }
  }

  async getQueueStats(): Promise<{ pending: number; processing: number; redisAvailable: boolean }> {
    let pending = 0
    const redisAvailable = this.isRedisAvailable()

    if (redisAvailable) {
      try {
        const redis = getRedisClient()!
        pending = await redis.llen('document-queue')
      } catch (error) {
        logger.warn('Failed to get Redis queue stats:', error)
        pending = this.fallbackQueue.length
      }
    } else {
      pending = this.fallbackQueue.length
    }

    return {
      pending,
      processing: redisAvailable ? this.processing.size : this.fallbackProcessing,
      redisAvailable,
    }
  }

  async clearQueue(): Promise<void> {
    if (this.isRedisAvailable()) {
      try {
        const redis = getRedisClient()!
        await redis.del('document-queue')
        logger.info('Redis queue cleared')
      } catch (error) {
        logger.error('Failed to clear Redis queue:', error)
      }
    }

    this.fallbackQueue.length = 0
    logger.info('Fallback queue cleared')
  }
}
