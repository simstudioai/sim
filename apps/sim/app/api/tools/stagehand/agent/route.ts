import { Stagehand } from '@browserbasehq/stagehand'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { ensureZodObject, normalizeUrl } from '@/app/api/tools/stagehand/utils'

const logger = createLogger('StagehandAgentAPI')

// Environment variables for Browserbase
const BROWSERBASE_API_KEY = env.BROWSERBASE_API_KEY
const BROWSERBASE_PROJECT_ID = env.BROWSERBASE_PROJECT_ID

const requestSchema = z.object({
  task: z.string().min(1),
  startUrl: z.string().url(),
  outputSchema: z.any(),
  variables: z.any(),
  apiKey: z.string(),
})

function getSchemaObject(outputSchema: Record<string, any>): Record<string, any> {
  if (outputSchema.schema && typeof outputSchema.schema === 'object') {
    return outputSchema.schema
  }
  return outputSchema
}

function formatSchemaForInstructions(schema: Record<string, any>): string {
  try {
    return JSON.stringify(schema, null, 2)
  } catch (error) {
    logger.error('Error formatting schema for instructions', { error })
    return JSON.stringify(schema)
  }
}

function extractActionDirectives(task: string): {
  processedTask: string
  actionDirectives: Array<{ index: number; action: string }>
} {
  const actionRegex = /\[\[ACTION:(.*?)\]\]/g
  const actionDirectives: Array<{ index: number; action: string }> = []
  let match
  let processedTask = task

  // Find all action directives in the task
  while ((match = actionRegex.exec(task)) !== null) {
    const _fullMatch = match[0]
    const actionText = match[1].trim()
    const index = match.index

    actionDirectives.push({
      index,
      action: actionText,
    })
  }

  // Replace action directives with placeholders for the agent
  // We'll number them to make it clear to the agent what's happening
  if (actionDirectives.length > 0) {
    let offset = 0
    for (let i = 0; i < actionDirectives.length; i++) {
      const directive = actionDirectives[i]
      const originalIndex = directive.index
      const placeholder = `[SECURE ACTION ${i + 1}]`

      // Calculate position considering previous replacements
      const adjustedIndex = originalIndex - offset

      // Get text to replace
      const fullMatch = task.substring(
        originalIndex,
        originalIndex + task.substring(originalIndex).indexOf(']]') + 2
      )

      // Replace in processed task
      processedTask =
        processedTask.substring(0, adjustedIndex) +
        placeholder +
        processedTask.substring(adjustedIndex + fullMatch.length)

      // Update offset for next replacement
      offset += fullMatch.length - placeholder.length
    }
  }

  return { processedTask, actionDirectives }
}

// Function to process secure actions in a given message
async function processSecureActions(
  message: string,
  stagehand: Stagehand,
  actionDirectives: Array<{ index: number; action: string }>,
  variables: Record<string, string> | undefined
): Promise<{
  modifiedMessage: string
  executedActions: Array<{ action: string; result: { success: boolean; message: string } }>
}> {
  // Track executed actions and modified message
  const executedActions: Array<{ action: string; result: { success: boolean; message: string } }> =
    []
  let modifiedMessage = message

  // Look for secure action execute directives
  const secureActionMatches = [...message.matchAll(/EXECUTE SECURE ACTION (\d+)/gi)]

  // Process each secure action request
  for (const match of secureActionMatches) {
    const fullMatch = match[0]
    const actionIndex = Number.parseInt(match[1], 10) - 1 // Convert to 0-based index

    if (actionDirectives[actionIndex]) {
      // Found a secure action directive to execute
      const actionDirective = actionDirectives[actionIndex]
      let resultMessage = ''

      try {
        logger.info(`Executing secure action ${actionIndex + 1}`, {
          action: actionDirective.action,
        })

        // Perform the action with variable substitution at runtime
        // This uses act() directly, which handles variables securely
        const result = await stagehand.page.act({
          action: actionDirective.action,
          variables: variables || {},
        })

        // Store the result for later reporting
        executedActions.push({
          action: actionDirective.action,
          result: {
            success: result.success,
            message: result.message,
          },
        })

        // Success message to replace the execution request
        resultMessage = `\nSecure action ${actionIndex + 1} executed successfully.\n`
      } catch (error) {
        logger.error(`Error executing secure action ${actionIndex + 1}`, {
          error,
          action: actionDirective.action,
        })

        // Store the failed result
        executedActions.push({
          action: actionDirective.action,
          result: {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        })

        // Error message to replace the execution request
        resultMessage = `\nError executing secure action ${actionIndex + 1}: ${error instanceof Error ? error.message : 'Unknown error'}\n`
      }

      // Replace the execution directive with the result message
      modifiedMessage = modifiedMessage.replace(fullMatch, resultMessage)
    } else {
      // Invalid action index - replace with error message
      const errorMessage = `\nError: Secure action ${actionIndex + 1} does not exist.\n`
      modifiedMessage = modifiedMessage.replace(fullMatch, errorMessage)
    }
  }

  return { modifiedMessage, executedActions }
}

// New helper function for direct login attempt
async function attemptDirectLogin(
  stagehand: Stagehand,
  variables: Record<string, string> | undefined
): Promise<{
  attempted: boolean
  success: boolean
  message: string
}> {
  if (!stagehand || !variables) {
    return {
      attempted: false,
      success: false,
      message: 'Login not attempted: missing stagehand or variables',
    }
  }

  // Define common variable keys for credentials
  const usernameKeys = ['username', 'email', 'user']
  const passwordKeys = ['password', 'pass', 'secret']

  // Find the actual keys used in the variables
  const usernameKey = usernameKeys.find((key) => variables[key] !== undefined)
  const passwordKey = passwordKeys.find((key) => variables[key] !== undefined)

  if (!usernameKey || !passwordKey) {
    logger.info('Direct login skipped: Missing username or password variable.')
    return {
      attempted: false,
      success: false,
      message: 'Login not attempted: Missing username or password variable.',
    }
  }

  const usernameValue = variables[usernameKey]
  const passwordValue = variables[passwordKey]

  logger.info('Attempting direct login with provided variables.')

  try {
    const page = stagehand.page

    // Common selectors for username/email fields
    const usernameSelectors = [
      'input[type="text"][name*="user"]',
      'input[type="email"]',
      'input[name*="email"]',
      'input[id*="user"]',
      'input[id*="email"]',
      'input[placeholder*="user" i]',
      'input[placeholder*="email" i]',
      'input[aria-label*="user" i]',
      'input[aria-label*="email" i]',
    ]

    // Common selectors for password fields
    const passwordSelectors = [
      'input[type="password"]',
      'input[name*="pass"]',
      'input[id*="pass"]',
      'input[placeholder*="pass" i]',
      'input[aria-label*="pass" i]',
    ]

    // Common selectors for submit buttons
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
      'button[id*="login"]',
      'button[id*="submit"]',
      'button[name*="login"]',
      'button[name*="submit"]',
    ]

    // Find and fill username
    let usernameFilled = false
    for (const selector of usernameSelectors) {
      const input = page.locator(selector).first()
      if ((await input.count()) > 0 && (await input.isVisible({ timeout: 1000 }))) {
        // Short timeout
        logger.info(`Found username field: ${selector}`)
        await input.fill(usernameValue)
        usernameFilled = true
        break
      }
    }

    if (!usernameFilled) {
      logger.warn('Could not find a visible username/email field for direct login.')
      return {
        attempted: false,
        success: false,
        message: 'Login not attempted: Could not find a username field.',
      }
    }

    // Find and fill password
    let passwordFilled = false
    for (const selector of passwordSelectors) {
      const input = page.locator(selector).first()
      if ((await input.count()) > 0 && (await input.isVisible({ timeout: 1000 }))) {
        logger.info(`Found password field: ${selector}`)
        await input.fill(passwordValue)
        passwordFilled = true
        break
      }
    }

    if (!passwordFilled) {
      logger.warn('Could not find a visible password field for direct login.')
      // Even if password field not found, maybe username submit works? Unlikely but possible.
      return {
        attempted: true,
        success: false,
        message:
          'Login attempt incomplete: Found and filled username but could not find password field.',
      }
    }

    // Find and click submit button
    let submitClicked = false
    for (const selector of submitSelectors) {
      const button = page.locator(selector).first()
      // Check if button exists and is visible/enabled
      if (
        (await button.count()) > 0 &&
        (await button.isVisible({ timeout: 1000 })) &&
        (await button.isEnabled({ timeout: 1000 }))
      ) {
        logger.info(`Found submit button: ${selector}`)
        await button.click()
        // Wait longer for login processing
        await page.waitForTimeout(3000)
        submitClicked = true
        break
      }
    }

    if (!submitClicked) {
      logger.warn('Could not find a visible/enabled submit button for direct login.')
      return {
        attempted: true,
        success: false,
        message:
          'Login attempt incomplete: Found and filled form fields but could not find submit button.',
      }
    }

    logger.info(
      'Direct login attempt completed (fields filled, submit clicked). Verifying result...'
    )

    // Verify if login was successful by checking for common success indicators
    // 1. Check if we're redirected away from login page
    const currentUrl = page.url()
    const isStillOnLoginPage =
      currentUrl.includes('login') ||
      currentUrl.includes('signin') ||
      currentUrl.includes('auth') ||
      currentUrl.includes('signup') ||
      currentUrl.includes('register')

    // 2. Check for login error messages
    const hasLoginError = await page.evaluate(() => {
      // Look for common error message elements
      const errorSelectors = [
        '[class*="error" i]',
        '[id*="error" i]',
        '[role="alert"]',
        '.alert-danger',
        '.text-danger',
        '.text-error',
        '.notification-error',
      ]

      for (const selector of errorSelectors) {
        const elements = document.querySelectorAll(selector)
        for (const element of elements) {
          const text = element.textContent || ''
          if (
            text.toLowerCase().includes('password') ||
            text.toLowerCase().includes('login failed') ||
            text.toLowerCase().includes('incorrect') ||
            text.toLowerCase().includes('invalid') ||
            text.toLowerCase().includes("doesn't match") ||
            text.toLowerCase().includes('does not match')
          ) {
            return true
          }
        }
      }

      return false
    })

    // 3. Check for common success indicators
    const hasSuccessIndicators = await page.evaluate(() => {
      // Check for user menu elements, profile info, etc.
      const userMenuSelectors = [
        '[class*="avatar" i]',
        '[class*="profile" i]',
        '[class*="user-menu" i]',
        '[class*="account" i]',
        '[aria-label*="account" i]',
        '[aria-label*="profile" i]',
      ]

      for (const selector of userMenuSelectors) {
        if (document.querySelector(selector)) {
          return true
        }
      }

      return false
    })

    if (!isStillOnLoginPage && !hasLoginError && hasSuccessIndicators) {
      logger.info('Login verification successful: Detected successful login.')
      return {
        attempted: true,
        success: true,
        message: 'Login successful. User is now authenticated.',
      }
    }
    if (hasLoginError) {
      logger.warn('Login verification failed: Detected login error message.')
      return {
        attempted: true,
        success: false,
        message:
          'Login attempted but failed: Detected error message on page. Likely invalid credentials.',
      }
    }
    if (isStillOnLoginPage) {
      logger.warn('Login verification inconclusive: Still on login page.')
      return {
        attempted: true,
        success: false,
        message: 'Login attempted but failed: Still on login/authentication page.',
      }
    }
    logger.info('Login verification inconclusive. Proceeding as if login was successful.')
    return {
      attempted: true,
      success: true,
      message: 'Login likely successful, but could not verify with certainty.',
    }
  } catch (error) {
    logger.error('Error during direct login attempt', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      attempted: true,
      success: false,
      message: `Login attempt encountered an error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export async function POST(request: NextRequest) {
  let stagehand: Stagehand | null = null

  try {
    const body = await request.json()
    logger.info('Received Stagehand agent request', {
      startUrl: body.startUrl,
      hasTask: !!body.task,
      hasVariables: !!body.variables,
      hasSchema: !!body.outputSchema,
    })

    const validationResult = requestSchema.safeParse(body)

    if (!validationResult.success) {
      logger.error('Invalid request body', { errors: validationResult.error.errors })
      return NextResponse.json(
        { error: 'Invalid request parameters', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const params = validationResult.data
    // Simplify variable handling - safely convert any format to the object we need
    let variablesObject: Record<string, string> | undefined

    // Handle different formats of variables that might come from the UI
    if (params.variables) {
      if (Array.isArray(params.variables)) {
        // For array format (from table input)
        variablesObject = {}
        params.variables.forEach((item: any) => {
          // Check if item and item.cells exist, and Key is a string
          if (item?.cells?.Key && typeof item.cells.Key === 'string') {
            // Access Key and Value within the 'cells' object
            variablesObject![item.cells.Key] = item.cells.Value || ''
          }
        })
      } else if (typeof params.variables === 'object' && params.variables !== null) {
        // For object format (already in correct format)
        variablesObject = { ...params.variables }
      } else if (typeof params.variables === 'string') {
        // Handle string format (sometimes comes as JSON string)
        try {
          variablesObject = JSON.parse(params.variables)
        } catch (_e) {
          logger.warn('Failed to parse variables string as JSON', { variables: params.variables })
        }
      }

      // Verify we have non-empty variables
      if (!variablesObject || Object.keys(variablesObject).length === 0) {
        logger.warn('Variables object is empty after processing', {
          originalVariables: params.variables,
          variablesType: typeof params.variables,
        })

        // Try to recover username/password from the raw variables if we can
        if (typeof params.variables === 'object' && params.variables !== null) {
          variablesObject = {}
          for (const key in params.variables) {
            if (typeof params.variables[key] === 'string') {
              variablesObject[key] = params.variables[key]
            }
          }
          logger.info('Recovered variables from raw object', {
            recoveredCount: Object.keys(variablesObject).length,
          })
        }
      }

      // Log the collected variables (careful not to log actual passwords)
      if (variablesObject) {
        const safeVarKeys = Object.keys(variablesObject).map((key) => {
          return key.toLowerCase().includes('password')
            ? `${key}: [REDACTED]`
            : `${key}: ${variablesObject?.[key]}`
        })

        logger.info('Collected variables for substitution', {
          variableCount: Object.keys(variablesObject).length,
          safeVariables: safeVarKeys,
        })
      }
    }

    const { task, startUrl: rawStartUrl, outputSchema, apiKey } = params

    // Normalize the starting URL - only add https:// if needed
    let startUrl = rawStartUrl

    // Add https:// if no protocol is specified
    startUrl = normalizeUrl(startUrl)

    logger.info('Starting Stagehand agent process', {
      rawStartUrl,
      startUrl,
      hasTask: !!task,
      hasVariables: !!variablesObject && Object.keys(variablesObject).length > 0,
    })

    // Check for required environment variables
    if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
      logger.error('Missing required environment variables', {
        hasBrowserbaseApiKey: !!BROWSERBASE_API_KEY,
        hasBrowserbaseProjectId: !!BROWSERBASE_PROJECT_ID,
      })

      return NextResponse.json(
        { error: 'Server configuration error: Missing required environment variables' },
        { status: 500 }
      )
    }

    try {
      // Initialize Stagehand with Browserbase
      logger.info('Initializing Stagehand with Browserbase')
      stagehand = new Stagehand({
        env: 'BROWSERBASE',
        apiKey: BROWSERBASE_API_KEY,
        projectId: BROWSERBASE_PROJECT_ID,
        verbose: 1,
        // Use a custom logger wrapper that adapts our logger to Stagehand's expected format
        logger: (msg) => logger.info(typeof msg === 'string' ? msg : JSON.stringify(msg)),
        disablePino: true,
        modelName: 'claude-3-7-sonnet-20250219',
        modelClientOptions: {
          apiKey: apiKey, // User's OpenAI API key
        },
      })

      // Initialize Stagehand
      logger.info('Starting stagehand.init()')
      await stagehand.init()
      logger.info('Stagehand initialized successfully')

      // Monkey patch the page.act method to automatically apply variables to all actions
      if (variablesObject && Object.keys(variablesObject).length > 0) {
        logger.info('Setting up automatic variable substitution for all actions')
        const originalAct = stagehand.page.act.bind(stagehand.page)
        stagehand.page.act = async (options: any) => {
          // If options is a string, convert it to object
          if (typeof options === 'string') {
            options = { action: options }
          }

          // Ensure variables are included
          options.variables = { ...(options.variables || {}), ...variablesObject }

          logger.info('Executing act with variables', {
            action: options.action,
            hasVariables: true,
            variableCount: Object.keys(options.variables).length,
          })

          // Call original method
          return originalAct(options)
        }
      }

      // Navigate to the start URL
      logger.info(`Navigating to ${startUrl}`)
      await stagehand.page.goto(startUrl, { waitUntil: 'networkidle' })
      logger.info('Navigation complete')

      // Helper function to detect and navigate to login page if needed
      const ensureLoginPage = async (): Promise<boolean> => {
        if (!stagehand) {
          logger.error('Stagehand instance is null')
          return false
        }

        logger.info('Checking if we need to navigate to login page')

        try {
          // Check if we're already on a page with login form
          const loginFormExists = await stagehand.page.evaluate(() => {
            const usernameInput = document.querySelector(
              'input[type="text"], input[type="email"], input[name="username"], input[id="username"]'
            )
            const passwordInput = document.querySelector('input[type="password"]')
            return !!(usernameInput && passwordInput)
          })

          if (loginFormExists) {
            logger.info('Already on login page with username/password fields')
            return true
          }

          // Look for common login buttons/links
          const loginElements = await stagehand.page.observe({
            instruction: 'Find login buttons or links on this page',
          })

          if (loginElements && loginElements.length > 0) {
            for (const element of loginElements) {
              if (
                element.description.toLowerCase().includes('login') ||
                element.description.toLowerCase().includes('sign in')
              ) {
                logger.info(`Found login element: ${element.description}`)

                // Click the login button/link
                if (element.selector) {
                  logger.info(`Clicking login element: ${element.selector}`)
                  await stagehand.page.act({
                    action: `Click on the ${element.description}`,
                  })

                  // Wait for navigation or DOM changes
                  await stagehand.page.waitForTimeout(2000)

                  // Check if we're now on login page
                  const loginPageAfterClick = await stagehand.page.evaluate(() => {
                    const usernameInput = document.querySelector(
                      'input[type="text"], input[type="email"], input[name="username"], input[id="username"]'
                    )
                    const passwordInput = document.querySelector('input[type="password"]')
                    return !!(usernameInput && passwordInput)
                  })

                  if (loginPageAfterClick) {
                    logger.info('Successfully navigated to login page')
                    return true
                  }
                }
              }
            }
          }

          // Try direct navigation to /login if we couldn't find login elements
          logger.info('Trying direct navigation to /login path')
          const currentUrl = await stagehand.page.url()
          const loginUrl = new URL('/login', currentUrl).toString()

          await stagehand.page.goto(loginUrl, { waitUntil: 'networkidle' })

          // Check if we're now on login page
          const loginPageAfterDirectNav = await stagehand.page.evaluate(() => {
            const usernameInput = document.querySelector(
              'input[type="text"], input[type="email"], input[name="username"], input[id="username"]'
            )
            const passwordInput = document.querySelector('input[type="password"]')
            return !!(usernameInput && passwordInput)
          })

          if (loginPageAfterDirectNav) {
            logger.info('Successfully navigated to login page via direct URL')
            return true
          }

          logger.warn('Could not navigate to login page')
          return false
        } catch (error) {
          logger.error('Error finding login page', { error })
          return false
        }
      }

      // --- Direct Login Logic ---
      let directLoginAttempted = false
      let directLoginSuccess = false
      let loginMessage = ''
      let taskForAgent = task // Use original task by default
      let agentInstructions = '' // Will be generated below

      // Only attempt direct login if relevant variables exist
      const hasLoginVars =
        variablesObject &&
        Object.keys(variablesObject).some((k) =>
          ['username', 'email', 'user'].includes(k.toLowerCase())
        ) &&
        Object.keys(variablesObject).some((k) =>
          ['password', 'pass', 'secret'].includes(k.toLowerCase())
        )

      if (hasLoginVars) {
        logger.info('Login variables detected, checking if login page navigation is needed.')
        const isOnLoginPage = await ensureLoginPage()

        if (isOnLoginPage && stagehand) {
          logger.info('Attempting direct login before involving the agent.')
          const loginResult = await attemptDirectLogin(stagehand, variablesObject)
          directLoginAttempted = loginResult.attempted
          directLoginSuccess = loginResult.success
          loginMessage = loginResult.message

          logger.info('Direct login attempt result', {
            attempted: directLoginAttempted,
            success: directLoginSuccess,
            message: loginMessage,
          })

          if (directLoginAttempted) {
            // Modify task for agent regardless of login success/failure
            if (directLoginSuccess) {
              taskForAgent = `Login has been completed programmatically and was successful. Please verify that you are logged in and then proceed with the original task: ${task}`
            } else {
              taskForAgent = `Login was attempted programmatically but failed (${loginMessage}). You will need to check the current state and either:
1. Try to login again if you see a login form
2. Or proceed with the task if login actually succeeded: ${task}`
            }
            logger.info('Task modified for agent after direct login attempt.')
          }
        } else {
          logger.info('Skipping direct login attempt: Not on login page or stagehand unavailable.')
        }
      } else {
        logger.info('Skipping direct login: No relevant username/password variables found.')
      }
      // --- End Direct Login Logic ---

      // Extract action directives with variable placeholders (from original task)
      const { processedTask, actionDirectives } = extractActionDirectives(task) // Use original task for extraction

      logger.info('Extracted action directives', {
        actionCount: actionDirectives.length,
        hasActionDirectives: actionDirectives.length > 0,
      })

      // Generate instructions based on whether direct login was attempted
      if (directLoginAttempted) {
        // Construct specific instructions based on login attempt outcome
        const loginInstructions = directLoginSuccess
          ? 'Login was completed programmatically and appears successful. Please VERIFY if the login was successful by checking for elements that only appear when logged in.'
          : `Login was attempted programmatically but appears to have FAILED (${loginMessage}). 
             IMPORTANT: Check if you see a login form, and if so:
             1. Username and password fields may already be filled (but may contain placeholder text if the login failed)
             2. If you need to attempt login again, make sure you use the actual variable placeholders (%username%, %password%) so they are properly substituted.
             3. Check for any error messages to understand why the login failed.`

        agentInstructions = `You are a helpful web browsing assistant. ${loginInstructions}
Once you've verified the login state, proceed with the following task: ${task} 
${actionDirectives.length > 0 ? `\n\nNote on Secure Actions: You might see [SECURE ACTION X] placeholders. Handle these by outputting "EXECUTE SECURE ACTION X" when appropriate.` : ''}
${outputSchema && typeof outputSchema === 'object' && outputSchema !== null ? `\n\nIMPORTANT: You MUST return your final result in the following JSON format exactly:\n${formatSchemaForInstructions(getSchemaObject(outputSchema))}\n\nYour response should consist of valid JSON only, with no additional text.` : ''}`
      } else {
        // Original detailed instructions if agent needs to handle login/placeholders
        agentInstructions = `You are a helpful web browsing assistant that will complete tasks on websites. Your goal is to accomplish the following task: ${processedTask}\n
${actionDirectives.length > 0 ? `\n\nYou'll see [SECURE ACTION X] placeholders in the task. These represent secure actions that will be handled automatically when you navigate to the appropriate page. When you reach a point where a secure action should be performed, output a line with exactly: "EXECUTE SECURE ACTION X" (where X is the action number). Then wait for confirmation before proceeding.` : ''}\n
IMPORTANT: For any form fields that require sensitive information like usernames or passwords:
1. If you see placeholders like %username% or %password% in the task, DO NOT ask for the actual values.
2. If you need to type in login forms, use the EXACT placeholder text (e.g., "%username%" or "%password%") UNLESS instructed otherwise.
3. The system will automatically substitute the real values when you use these placeholders IF direct login was not attempted.
4. Example correct approach: "type %username% in the username field".${
          variablesObject && Object.keys(variablesObject).length > 0
            ? `\n5. Available variables: ${Object.keys(variablesObject)
                .map((k) => `%${k}%`)
                .join(', ')}`
            : ''
        }\n
WEBSITE NAVIGATION GUIDANCE:
1. If you need to log in but don't see a login form, LOOK for login buttons or links (they might say "Login" or "Sign in").
2. If you're on a login page but don't see a username/password form, try scrolling or looking for "Continue with email" or similar options.
3. Always TYPE carefully in form fields - use accurate coordinates for clicking if necessary.
4. Use specific actions like "type %username% in the username field".
5. After logging in, verify you've successfully authenticated before proceeding.\n
${outputSchema && typeof outputSchema === 'object' && outputSchema !== null ? `\n\nIMPORTANT: You MUST return your final result in the following JSON format exactly:\n${formatSchemaForInstructions(getSchemaObject(outputSchema))}\n\nYour response should consist of valid JSON only, with no additional text. Ensure the data in your response adheres strictly to the schema provided.` : ''}`
      }

      // Create agent to execute the task
      logger.info('Creating Stagehand agent', {
        directLoginAttempted,
        directLoginSuccess,
        loginMessage,
      })
      const agent = stagehand.agent({
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-20250219',
        instructions: agentInstructions, // Use the generated instructions
        options: {
          apiKey: apiKey,
          // Conditional additional instructions based on direct login attempt
          additionalInstructions: directLoginAttempted
            ? `Login was ${directLoginSuccess ? 'successfully completed' : 'attempted but failed'}. 
               ${loginMessage}
               First check the current state of the page. 
               If login failed, you may need to click the login button again after ensuring fields are properly filled.`
            : `
This task may contain placeholder variables like %username% and %password%.
When you need to fill form fields, use these placeholders directly (e.g., type "%username%").
The system will substitute actual values when these placeholders are used, keeping sensitive data secure.
          `.trim(),
        },
      })

      // Since we can't use events directly, we'll need to handle secure actions
      // by running the agent and then processing any EXECUTE SECURE ACTION directives
      // in its output, then decide if we need to continue the conversation

      // Sequence to execute agent with secure action processing
      const runAgentWithSecureActions = async (): Promise<any> => {
        // Use taskForAgent which might have been modified if direct login occurred
        let currentResult = await agent.execute(taskForAgent)
        let allExecutedActions: Array<{
          action: string
          result: { success: boolean; message: string }
        }> = []
        let iterationCount = 0
        const maxIterations = 10 // Safety limit for iterations

        while (iterationCount < maxIterations && stagehand !== null) {
          if (!currentResult.message) {
            // No message to process, we're done
            break
          }

          // Check if there are secure action directives in the message
          if (!/EXECUTE SECURE ACTION \d+/i.test(currentResult.message)) {
            // No secure actions to execute, we're done
            break
          }

          // Process secure actions in the message
          const { modifiedMessage, executedActions } = await processSecureActions(
            currentResult.message,
            stagehand,
            actionDirectives,
            variablesObject
          )

          // Add executed actions to our collection
          allExecutedActions = [...allExecutedActions, ...executedActions]

          if (executedActions.length === 0) {
            // No actions were executed, we can stop
            break
          }

          // Continue conversation with the agent using the modified message as context
          iterationCount++

          // Only continue if we need to - if we reached the final state
          // with structured output, don't keep going
          const hasStructuredOutput = /```json|^\s*{/.test(modifiedMessage)
          if (hasStructuredOutput) {
            // Already has structured output, let's not continue and risk losing it
            currentResult.message = modifiedMessage
            break
          }

          // Continue the conversation with the agent
          logger.info(
            `Continuing agent execution with processed actions, iteration ${iterationCount}`
          )

          try {
            // Here we'd continue the agent conversation, but since agent.execute
            // doesn't support continuation easily, we have to create a new prompt
            // that synthesizes what's happened so far
            const continuationPrompt = `${modifiedMessage}\n\nPlease continue with the task.`
            const nextResult = await agent.execute(continuationPrompt)

            // Merge results - keep actions from both iterations but update message
            currentResult = {
              ...nextResult,
              actions: [...currentResult.actions, ...nextResult.actions],
            }
          } catch (error) {
            logger.error('Error continuing agent execution', { error })
            break
          }
        }

        // Return the final result and all executed secure actions
        return {
          ...currentResult,
          secureActions: allExecutedActions,
        }
      }

      // Execute the agent with secure action handling
      logger.info('Executing agent task', {
        task: taskForAgent, // Log the task actually given to the agent
        actionDirectiveCount: actionDirectives.length,
        directLoginAttempted,
        directLoginSuccess,
        loginMessage,
      })

      const agentExecutionResult = await runAgentWithSecureActions()

      const agentResult = {
        success: agentExecutionResult.success,
        completed: agentExecutionResult.completed,
        message: agentExecutionResult.message,
        actions: agentExecutionResult.actions,
      }

      logger.info('Agent execution complete', {
        success: agentResult.success,
        completed: agentResult.completed,
        executedActionCount: agentExecutionResult.secureActions?.length || 0,
      })

      // Parse the structured data from the agent's message if possible
      let structuredOutput = null
      if (agentResult.message) {
        try {
          // Try to parse JSON from the message
          // First, clean up the message to extract just the JSON
          let jsonContent = agentResult.message

          // Look for JSON block markers in case the model wrapped it in ```json blocks
          const jsonBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
          if (jsonBlockMatch?.[1]) {
            jsonContent = jsonBlockMatch[1]
          }

          // Try to parse the content as JSON
          structuredOutput = JSON.parse(jsonContent)
          logger.info('Successfully parsed structured output from agent response')
        } catch (parseError) {
          logger.error('Failed to parse JSON from agent message', {
            error: parseError,
            message: agentResult.message,
          })

          // If we have a schema, try one more approach with extract
          if (
            outputSchema &&
            typeof outputSchema === 'object' &&
            outputSchema !== null &&
            stagehand
          ) {
            try {
              logger.info('Attempting to extract structured data using Stagehand extract')
              const schemaObj = getSchemaObject(outputSchema)
              // Use ensureZodObject to get a proper ZodObject instance
              const zodSchema = ensureZodObject(logger, schemaObj)

              // Use the extract API to get structured data from whatever page we ended up on
              structuredOutput = await stagehand.page.extract({
                instruction:
                  'Extract the requested information from this page according to the schema',
                schema: zodSchema,
              })

              logger.info('Successfully extracted structured data as fallback', {
                keys: structuredOutput ? Object.keys(structuredOutput) : [],
              })
            } catch (extractError) {
              logger.error('Fallback extraction also failed', { error: extractError })
            }
          }
        }
      }

      // Return agent result, structured output, and secure action results
      return NextResponse.json({
        agentResult,
        structuredOutput,
        secureActions: agentExecutionResult.secureActions || [],
      })
    } catch (error) {
      logger.error('Stagehand agent execution error', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      })

      // Provide detailed error information
      let errorMessage = 'Unknown error during agent execution'
      let errorDetails: Record<string, any> = {}

      if (error instanceof Error) {
        errorMessage = error.message
        errorDetails = {
          name: error.name,
          stack: error.stack,
        }

        // Log additional properties for context
        const errorObj = error as any
        if (typeof errorObj.code !== 'undefined') {
          errorDetails.code = errorObj.code
        }
        if (typeof errorObj.statusCode !== 'undefined') {
          errorDetails.statusCode = errorObj.statusCode
        }
        if (typeof errorObj.response !== 'undefined') {
          errorDetails.response = errorObj.response
        }
      }

      return NextResponse.json(
        {
          error: errorMessage,
          details: errorDetails,
        },
        { status: 500 }
      )
    }
  } catch (error) {
    logger.error('Unexpected error in agent API route', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  } finally {
    // Clean up Stagehand resources
    if (stagehand) {
      try {
        logger.info('Closing Stagehand instance')
        await stagehand.close()
      } catch (closeError) {
        logger.error('Error closing Stagehand instance', { error: closeError })
      }
    }
  }
}
