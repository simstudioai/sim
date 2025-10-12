import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('PIIValidator')
const DEFAULT_TIMEOUT = 30000 // 30 seconds

export interface PIIValidationInput {
  text: string
  entityTypes: string[] // e.g., ["PERSON", "EMAIL_ADDRESS", "CREDIT_CARD"]
  mode: 'block' | 'mask' // block = fail if PII found, mask = return masked text
  language?: string // default: "en"
  requestId: string
}

export interface DetectedPIIEntity {
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

/**
 * List of all supported PII entity types
 * Based on Microsoft Presidio's supported entities
 */
export const SUPPORTED_PII_ENTITIES = {
  // Common/Global
  CREDIT_CARD: 'Credit card number',
  CRYPTO: 'Cryptocurrency wallet address',
  DATE_TIME: 'Date or time',
  EMAIL_ADDRESS: 'Email address',
  IBAN_CODE: 'International Bank Account Number',
  IP_ADDRESS: 'IP address',
  NRP: 'Nationality, religious or political group',
  LOCATION: 'Location',
  PERSON: 'Person name',
  PHONE_NUMBER: 'Phone number',
  MEDICAL_LICENSE: 'Medical license number',
  URL: 'URL',

  // USA
  US_BANK_NUMBER: 'US bank account number',
  US_DRIVER_LICENSE: 'US driver license',
  US_ITIN: 'US Individual Taxpayer Identification Number',
  US_PASSPORT: 'US passport number',
  US_SSN: 'US Social Security Number',

  // UK
  UK_NHS: 'UK NHS number',
  UK_NINO: 'UK National Insurance Number',

  // Other countries
  ES_NIF: 'Spanish NIF number',
  ES_NIE: 'Spanish NIE number',
  IT_FISCAL_CODE: 'Italian fiscal code',
  IT_DRIVER_LICENSE: 'Italian driver license',
  IT_VAT_CODE: 'Italian VAT code',
  IT_PASSPORT: 'Italian passport',
  IT_IDENTITY_CARD: 'Italian identity card',
  PL_PESEL: 'Polish PESEL number',
  SG_NRIC_FIN: 'Singapore NRIC/FIN',
  SG_UEN: 'Singapore Unique Entity Number',
  AU_ABN: 'Australian Business Number',
  AU_ACN: 'Australian Company Number',
  AU_TFN: 'Australian Tax File Number',
  AU_MEDICARE: 'Australian Medicare number',
  IN_PAN: 'Indian Permanent Account Number',
  IN_AADHAAR: 'Indian Aadhaar number',
  IN_VEHICLE_REGISTRATION: 'Indian vehicle registration',
  IN_VOTER: 'Indian voter ID',
  IN_PASSPORT: 'Indian passport',
  FI_PERSONAL_IDENTITY_CODE: 'Finnish Personal Identity Code',
  KR_RRN: 'Korean Resident Registration Number',
  TH_TNIN: 'Thai National ID Number',
} as const

export type PIIEntityType = keyof typeof SUPPORTED_PII_ENTITIES
