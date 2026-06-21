import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { createLogger } from '@sim/logger'

const logger = createLogger('PIIValidator')
const DEFAULT_TIMEOUT = 30000 // 30 seconds

/**
 * Max total bytes of text sent to a single Presidio subprocess. spaCy NER is the
 * bottleneck, so large payloads are split into multiple short calls instead of
 * one that risks the 30s timeout.
 */
const PII_CHUNK_MAX_BYTES = 256 * 1024

export interface PIIValidationInput {
  text: string
  entityTypes: string[] // e.g., ["PERSON", "EMAIL_ADDRESS", "CREDIT_CARD"]
  mode: 'block' | 'mask' // block = fail if PII found, mask = return masked text
  language?: string // default: "en"
  requestId: string
}

interface DetectedPIIEntity {
  type: string
  start: number
  end: number
  score: number
  text: string
}

export interface PIIValidationResult {
  passed: boolean
  error?: string
  detectedEntities: DetectedPIIEntity[]
  maskedText?: string
}

/**
 * Validate text for PII using Microsoft Presidio
 *
 * Supports two modes:
 * - block: Fails validation if any PII is detected
 * - mask: Passes validation and returns masked text with PII replaced
 */
export async function validatePII(input: PIIValidationInput): Promise<PIIValidationResult> {
  const { text, entityTypes, mode, language = 'en', requestId } = input

  logger.info(`[${requestId}] Starting PII validation`, {
    textLength: text.length,
    entityTypes,
    mode,
    language,
  })

  try {
    // Call Python script for PII detection
    const result = await executePythonPIIDetection(text, entityTypes, mode, language, requestId)

    logger.info(`[${requestId}] PII validation completed`, {
      passed: result.passed,
      detectedCount: result.detectedEntities.length,
      hasMaskedText: !!result.maskedText,
    })

    return result
  } catch (error: any) {
    logger.error(`[${requestId}] PII validation failed`, {
      error: error.message,
    })

    return {
      passed: false,
      error: `PII validation failed: ${error.message}`,
      detectedEntities: [],
    }
  }
}

interface PIIMaskBatchResult {
  passed: boolean
  error?: string
  results?: { maskedText: string }[]
}

/**
 * Mask PII across many strings, preserving input order. Strings are grouped into
 * byte-budgeted chunks so no single subprocess exceeds {@link PII_CHUNK_MAX_BYTES}
 * (keeping each call well under the 30s timeout). One Presidio engine pair is
 * reused per subprocess invocation. Rejects on any subprocess failure so callers
 * can apply their own fail-safe.
 */
export async function maskPIIBatch(
  texts: string[],
  entityTypes: string[],
  language = 'en'
): Promise<string[]> {
  if (texts.length === 0) return []

  const chunks: string[][] = []
  let current: string[] = []
  let currentBytes = 0
  for (const text of texts) {
    const bytes = Buffer.byteLength(text, 'utf8')
    if (current.length > 0 && currentBytes + bytes > PII_CHUNK_MAX_BYTES) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(text)
    currentBytes += bytes
  }
  if (current.length > 0) chunks.push(current)

  const masked: string[] = []
  for (const chunk of chunks) {
    const result = await runPythonScript<PIIMaskBatchResult>({
      texts: chunk,
      entityTypes,
      mode: 'mask',
      language,
    })
    if (!result.passed || !result.results || result.results.length !== chunk.length) {
      throw new Error(result.error || 'PII batch masking returned an unexpected result')
    }
    for (const item of result.results) masked.push(item.maskedText)
  }

  return masked
}

/**
 * Spawn the Presidio Python script, write the payload to stdin as JSON, and parse
 * the `__SIM_RESULT__=` marker from stdout. Rejects on non-zero exit, timeout,
 * spawn failure, or a missing/unparseable marker.
 */
function runPythonScript<T>(payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const guardrailsDir = path.join(process.cwd(), 'lib/guardrails')
    const scriptPath = path.join(guardrailsDir, 'validate_pii.py')
    const venvPython = path.join(guardrailsDir, 'venv/bin/python3')
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3'

    const python = spawn(pythonCmd, [scriptPath])
    let stdout = ''
    let stderr = ''

    const timeout = setTimeout(() => {
      python.kill()
      reject(new Error('PII processing timeout'))
    }, DEFAULT_TIMEOUT)

    // stdin errors (e.g. EPIPE when the child exits before draining the payload —
    // chunks can exceed the OS pipe buffer) emit on stdin, not the process. Without
    // a listener Node throws an unhandled 'error' and crashes; funnel it into the
    // promise so the caller's fail-safe scrub path handles it.
    python.stdin.on('error', (error: Error) => {
      clearTimeout(timeout)
      reject(new Error(`PII script stdin error: ${error.message}`))
    })
    python.stdin.write(JSON.stringify(payload))
    python.stdin.end()
    python.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    python.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    python.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(stderr || `PII script exited with code ${code}`))
        return
      }
      const prefix = '__SIM_RESULT__='
      const marker = stdout.split('\n').find((l) => l.startsWith(prefix))
      if (!marker) {
        reject(new Error(`No result marker in PII script output: ${stdout.substring(0, 200)}`))
        return
      }
      try {
        resolve(JSON.parse(marker.slice(prefix.length)) as T)
      } catch (error: any) {
        reject(new Error(`Failed to parse PII script result: ${error.message}`))
      }
    })

    python.on('error', (error) => {
      clearTimeout(timeout)
      reject(
        new Error(
          `Failed to execute Python: ${error.message}. Make sure Python 3 and Presidio are installed.`
        )
      )
    })
  })
}

/**
 * Execute Python PII detection script
 */
async function executePythonPIIDetection(
  text: string,
  entityTypes: string[],
  mode: string,
  language: string,
  requestId: string
): Promise<PIIValidationResult> {
  return new Promise((resolve, reject) => {
    // Use path relative to project root
    // In Next.js, process.cwd() returns the project root
    const guardrailsDir = path.join(process.cwd(), 'lib/guardrails')
    const scriptPath = path.join(guardrailsDir, 'validate_pii.py')
    const venvPython = path.join(guardrailsDir, 'venv/bin/python3')

    // Use venv Python if it exists, otherwise fall back to system python3
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3'

    const python = spawn(pythonCmd, [scriptPath])

    let stdout = ''
    let stderr = ''

    const timeout = setTimeout(() => {
      python.kill()
      reject(new Error('PII validation timeout'))
    }, DEFAULT_TIMEOUT)

    // Write input to stdin as JSON
    const inputData = JSON.stringify({
      text,
      entityTypes,
      mode,
      language,
    })
    // See runPythonScript: stdin errors (EPIPE on early child exit) must be
    // caught here or Node throws an unhandled 'error' and crashes the process.
    python.stdin.on('error', (error: Error) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to write to Python: ${error.message}`))
    })
    python.stdin.write(inputData)
    python.stdin.end()

    python.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    python.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    python.on('close', (code) => {
      clearTimeout(timeout)

      if (code !== 0) {
        logger.error(`[${requestId}] Python PII detection failed`, {
          code,
          stderr,
        })
        resolve({
          passed: false,
          error: stderr || 'PII detection failed',
          detectedEntities: [],
        })
        return
      }

      // Parse result from stdout
      try {
        const prefix = '__SIM_RESULT__='
        const lines = stdout.split('\n')
        const marker = lines.find((l) => l.startsWith(prefix))

        if (marker) {
          const jsonPart = marker.slice(prefix.length)
          const result = JSON.parse(jsonPart)
          resolve(result)
        } else {
          logger.error(`[${requestId}] No result marker found`, {
            stdout,
            stderr,
            stdoutLines: lines,
          })
          resolve({
            passed: false,
            error: `No result marker found in output. stdout: ${stdout.substring(0, 200)}, stderr: ${stderr.substring(0, 200)}`,
            detectedEntities: [],
          })
        }
      } catch (error: any) {
        logger.error(`[${requestId}] Failed to parse Python result`, {
          error: error.message,
          stdout,
          stderr,
        })
        resolve({
          passed: false,
          error: `Failed to parse result: ${error.message}. stdout: ${stdout.substring(0, 200)}`,
          detectedEntities: [],
        })
      }
    })

    python.on('error', (error) => {
      clearTimeout(timeout)
      logger.error(`[${requestId}] Failed to spawn Python process`, {
        error: error.message,
      })
      reject(
        new Error(
          `Failed to execute Python: ${error.message}. Make sure Python 3 and Presidio are installed.`
        )
      )
    })
  })
}

export { type PIIEntityType, SUPPORTED_PII_ENTITIES } from '@/lib/guardrails/pii-entities'
