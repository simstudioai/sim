import { Stagehand } from '@browserbasehq/stagehand'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import { createLogger } from '@/lib/logs/console/logger'
import { ensureZodObject, normalizeUrl } from '@/app/api/tools/stagehand/utils'

const logger = createLogger('StagehandAgentAPI')

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

  while ((match = actionRegex.exec(task)) !== null) {
    const actionText = match[1].trim()
    const index = match.index

    actionDirectives.push({
      index,
      action: actionText,
    })
  }

  if (actionDirectives.length > 0) {
    let offset = 0
    for (let i = 0; i < actionDirectives.length; i++) {
      const directive = actionDirectives[i]
      const originalIndex = directive.index
      const placeholder = `[SECURE ACTION ${i + 1}]`

      const adjustedIndex = originalIndex - offset

      const fullMatch = task.substring(
        originalIndex,
        originalIndex + task.substring(originalIndex).indexOf(']]') + 2
      )

      processedTask =
        processedTask.substring(0, adjustedIndex) +
        placeholder +
        processedTask.substring(adjustedIndex + fullMatch.length)

      offset += fullMatch.length - placeholder.length
    }
  }

  return { processedTask, actionDirectives }
}

async function processSecureActions(
  message: string,
  stagehand: Stagehand,
  actionDirectives: Array<{ index: number; action: string }>,
  variables: Record<string, string> | undefined
): Promise<{
  modifiedMessage: string
  executedActions: Array<{ action: string; result: { success: boolean; message: string } }>
}> {
  const executedActions: Array<{ action: string; result: { success: boolean; message: string } }> =
    []
  let modifiedMessage = message

  const secureActionMatches = [...message.matchAll(/EXECUTE SECURE ACTION (\d+)/gi)]

  for (const match of secureActionMatches) {
    const fullMatch = match[0]
    const actionIndex = Number.parseInt(match[1], 10) - 1

    if (actionDirectives[actionIndex]) {
      const actionDirective = actionDirectives[actionIndex]
      let resultMessage = ''

      try {
        logger.info(`Executing secure action ${actionIndex + 1}`, {
          action: actionDirective.action,
        })

        const result = await stagehand.act(actionDirective.action, {
          variables: variables || {},
        })

        executedActions.push({
          action: actionDirective.action,
          result: {
            success: result.success,
            message: result.message,
          },
        })

        resultMessage = `\nSecure action ${actionIndex + 1} executed successfully.\n`
      } catch (error) {
        logger.error(`Error executing secure action ${actionIndex + 1}`, {
          error,
          action: actionDirective.action,
        })

        executedActions.push({
          action: actionDirective.action,
          result: {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        })

        resultMessage = `\nError executing secure action ${actionIndex + 1}: ${error instanceof Error ? error.message : 'Unknown error'}\n`
      }

      modifiedMessage = modifiedMessage.replace(fullMatch, resultMessage)
    } else {
      const errorMessage = `\nError: Secure action ${actionIndex + 1} does not exist.\n`
      modifiedMessage = modifiedMessage.replace(fullMatch, errorMessage)
    }
  }

  return { modifiedMessage, executedActions }
}

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

  const usernameKeys = ['username', 'email', 'user']
  const passwordKeys = ['password', 'pass', 'secret']

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
    const page = stagehand.context.pages()[0]

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

    const passwordSelectors = [
      'input[type="password"]',
      'input[name*="pass"]',
      'input[id*="pass"]',
      'input[placeholder*="pass" i]',
      'input[aria-label*="pass" i]',
    ]

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

    let usernameFilled = false
    for (const selector of usernameSelectors) {
      const input = page.locator(selector).first()
      if ((await input.count()) > 0 && (await input.isVisible())) {
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

    let passwordFilled = false
    for (const selector of passwordSelectors) {
      const input = page.locator(selector).first()
      if ((await input.count()) > 0 && (await input.isVisible())) {
        logger.info(`Found password field: ${selector}`)
        await input.fill(passwordValue)
        passwordFilled = true
        break
      }
    }

    if (!passwordFilled) {
      logger.warn('Could not find a visible password field for direct login.')
      return {
        attempted: true,
        success: false,
        message:
          'Login attempt incomplete: Found and filled username but could not find password field.',
      }
    }

    let submitClicked = false
    for (const selector of submitSelectors) {
      const button = page.locator(selector).first()
      if ((await button.count()) > 0 && (await button.isVisible())) {
        logger.info(`Found submit button: ${selector}`)
        await button.click()
        await new Promise((resolve) => setTimeout(resolve, 3000))
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

    const currentUrl = page.url()
    const isStillOnLoginPage =
      currentUrl.includes('login') ||
      currentUrl.includes('signin') ||
      currentUrl.includes('auth') ||
      currentUrl.includes('signup') ||
      currentUrl.includes('register')

    const hasLoginError = await page.evaluate(() => {
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

    const hasSuccessIndicators = await page.evaluate(() => {
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
    let variablesObject: Record<string, string> | undefined

    if (params.variables) {
      if (Array.isArray(params.variables)) {
        variablesObject = {}
        params.variables.forEach((item: any) => {
          if (item?.cells?.Key && typeof item.cells.Key === 'string') {
            variablesObject![item.cells.Key] = item.cells.Value || ''
          }
        })
      } else if (typeof params.variables === 'object' && params.variables !== null) {
        variablesObject = { ...params.variables }
      } else if (typeof params.variables === 'string') {
        try {
          variablesObject = JSON.parse(params.variables)
        } catch (_e) {
          logger.warn('Failed to parse variables string as JSON', { variables: params.variables })
        }
      }

      if (!variablesObject || Object.keys(variablesObject).length === 0) {
        logger.warn('Variables object is empty after processing', {
          originalVariables: params.variables,
          variablesType: typeof params.variables,
        })

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

    let startUrl = rawStartUrl

    startUrl = normalizeUrl(startUrl)

    logger.info('Starting Stagehand agent process', {
      rawStartUrl,
      startUrl,
      hasTask: !!task,
      hasVariables: !!variablesObject && Object.keys(variablesObject).length > 0,
    })

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
      logger.info('Initializing Stagehand with Browserbase (v3)')

      stagehand = new Stagehand({
        env: 'BROWSERBASE',
        apiKey: BROWSERBASE_API_KEY,
        projectId: BROWSERBASE_PROJECT_ID,
        verbose: 1,
        logger: (msg) => logger.info(typeof msg === 'string' ? msg : JSON.stringify(msg)),
        model: {
          modelName: 'anthropic/claude-3-7-sonnet-latest',
          apiKey: apiKey,
        },
      })

      logger.info('Starting stagehand.init()')
      await stagehand.init()
      logger.info('Stagehand initialized successfully')

      const page = stagehand.context.pages()[0]

      logger.info(`Navigating to ${startUrl}`)
      await page.goto(startUrl, { waitUntil: 'networkidle' })
      logger.info('Navigation complete')

      const ensureLoginPage = async (): Promise<boolean> => {
        if (!stagehand) {
          logger.error('Stagehand instance is null')
          return false
        }

        const currentPage = stagehand.context.pages()[0]
        logger.info('Checking if we need to navigate to login page')

        try {
          const loginFormExists = await currentPage.evaluate(() => {
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

          const loginElements = await stagehand.observe('Find login buttons or links on this page')

          if (loginElements && loginElements.length > 0) {
            for (const element of loginElements) {
              if (
                element.description.toLowerCase().includes('login') ||
                element.description.toLowerCase().includes('sign in')
              ) {
                logger.info(`Found login element: ${element.description}`)

                if (element.selector) {
                  logger.info(`Clicking login element: ${element.selector}`)
                  await stagehand.act(`Click on the ${element.description}`)

                  await new Promise((resolve) => setTimeout(resolve, 2000))

                  const loginPageAfterClick = await currentPage.evaluate(() => {
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

          logger.info('Trying direct navigation to /login path')
          const currentUrl = currentPage.url()
          const loginUrl = new URL('/login', currentUrl).toString()

          await currentPage.goto(loginUrl, { waitUntil: 'networkidle' })

          const loginPageAfterDirectNav = await currentPage.evaluate(() => {
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

      let directLoginAttempted = false
      let directLoginSuccess = false
      let loginMessage = ''
      let taskForAgent = task
      let agentInstructions = ''

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

      const { processedTask, actionDirectives } = extractActionDirectives(task)

      logger.info('Extracted action directives', {
        actionCount: actionDirectives.length,
        hasActionDirectives: actionDirectives.length > 0,
      })

      if (directLoginAttempted) {
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

      logger.info('Creating Stagehand agent', {
        directLoginAttempted,
        directLoginSuccess,
        loginMessage,
      })

      const additionalContext = directLoginAttempted
        ? `Login was ${directLoginSuccess ? 'successfully completed' : 'attempted but failed'}.
           ${loginMessage}
           First check the current state of the page.
           If login failed, you may need to click the login button again after ensuring fields are properly filled.`
        : `
This task may contain placeholder variables like %username% and %password%.
When you need to fill form fields, use these placeholders directly (e.g., type "%username%").
The system will substitute actual values when these placeholders are used, keeping sensitive data secure.
        `.trim()

      const agent = stagehand.agent({
        model: {
          modelName: 'anthropic/claude-3-7-sonnet-latest',
          apiKey: apiKey,
        },
        executionModel: {
          modelName: 'anthropic/claude-3-7-sonnet-latest',
          apiKey: apiKey,
        },
        systemPrompt: `${agentInstructions}\n\n${additionalContext}`,
      })

      const runAgentWithSecureActions = async (): Promise<any> => {
        let currentResult = await agent.execute({ instruction: taskForAgent })
        let allExecutedActions: Array<{
          action: string
          result: { success: boolean; message: string }
        }> = []
        let iterationCount = 0
        const maxIterations = 10 // Safety limit for iterations

        while (iterationCount < maxIterations && stagehand !== null) {
          if (!currentResult.message) {
            break
          }

          if (!/EXECUTE SECURE ACTION \d+/i.test(currentResult.message)) {
            break
          }

          const { modifiedMessage, executedActions } = await processSecureActions(
            currentResult.message,
            stagehand,
            actionDirectives,
            variablesObject
          )

          allExecutedActions = [...allExecutedActions, ...executedActions]

          if (executedActions.length === 0) {
            break
          }

          iterationCount++

          const hasStructuredOutput = /```json|^\s*{/.test(modifiedMessage)
          if (hasStructuredOutput) {
            currentResult.message = modifiedMessage
            break
          }

          logger.info(
            `Continuing agent execution with processed actions, iteration ${iterationCount}`
          )

          try {
            const continuationPrompt = `${modifiedMessage}\n\nPlease continue with the task.`
            const nextResult = await agent.execute({ instruction: continuationPrompt })

            currentResult = {
              ...nextResult,
              actions: [...currentResult.actions, ...nextResult.actions],
            }
          } catch (error) {
            logger.error('Error continuing agent execution', { error })
            break
          }
        }

        return {
          ...currentResult,
          secureActions: allExecutedActions,
        }
      }

      logger.info('Executing agent task', {
        task: taskForAgent,
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

      let structuredOutput = null
      const hasOutputSchema =
        outputSchema && typeof outputSchema === 'object' && outputSchema !== null

      if (agentResult.message) {
        try {
          let jsonContent = agentResult.message

          const jsonBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
          if (jsonBlockMatch?.[1]) {
            jsonContent = jsonBlockMatch[1]
          }

          structuredOutput = JSON.parse(jsonContent)
          logger.info('Successfully parsed structured output from agent response')
        } catch (parseError) {
          if (hasOutputSchema) {
            logger.warn('Failed to parse JSON from agent message, attempting fallback extraction', {
              error: parseError,
            })

            if (stagehand) {
              try {
                logger.info('Attempting to extract structured data using Stagehand extract')
                const schemaObj = getSchemaObject(outputSchema)
                const zodSchema = ensureZodObject(logger, schemaObj)

                structuredOutput = await stagehand.extract(
                  'Extract the requested information from this page according to the schema',
                  zodSchema
                )

                logger.info('Successfully extracted structured data as fallback', {
                  keys: structuredOutput ? Object.keys(structuredOutput) : [],
                })
              } catch (extractError) {
                logger.error('Fallback extraction also failed', { error: extractError })
              }
            }
          } else {
            logger.info('Agent returned plain text response (no schema provided)')
          }
        }
      }

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

      let errorMessage = 'Unknown error during agent execution'
      let errorDetails: Record<string, any> = {}

      if (error instanceof Error) {
        errorMessage = error.message
        errorDetails = {
          name: error.name,
          stack: error.stack,
        }

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
