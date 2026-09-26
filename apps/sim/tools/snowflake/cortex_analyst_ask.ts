import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  buildCortexAnalystBody,
  type CortexAnalystResponsePayload,
  cortexAnalystSqlContext,
  cortexAnalystUserMessage,
  mapCortexAnalystResponse,
  parseCortexAnalystHistory,
} from '@/tools/snowflake/cortex'
import {
  SNOWFLAKE_CORTEX_ANALYST_ASK_OUTPUTS,
  type SnowflakeCortexAnalystAskParams,
  type SnowflakeCortexAnalystAskResponse,
  type SnowflakeStatementResponse,
} from '@/tools/snowflake/types'
import {
  getSnowflakeBaseUrl,
  getSnowflakeHeaders,
  snowflakeAuthParamFields,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SnowflakeCortexAnalystAskTool')

/** Only a real `true` or the exact string `"true"` runs the generated SQL. */
function shouldExecuteSql(value: unknown): boolean {
  return value === true || value === 'true'
}

export const cortexAnalystAskTool: ToolConfig<
  SnowflakeCortexAnalystAskParams,
  SnowflakeCortexAnalystAskResponse
> = {
  id: 'snowflake_cortex_analyst_ask',
  version: '1.0.0',
  name: 'Snowflake Cortex Analyst Ask',
  description:
    'Ask Snowflake Cortex Analyst a question in natural language against a semantic view or semantic model. Returns its interpretation and the generated SQL, or suggested questions when the question is ambiguous, and can run the SQL to return rows. Pass the returned conversation as history to ask a follow-up.',
  params: {
    ...snowflakeAuthParamFields,
    question: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The question to ask about your data',
    },
    semanticView: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fully qualified semantic view name (for example MY_DB.MY_SCHEMA.MY_VIEW). Provide exactly one semantic source.',
    },
    semanticModelFile: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Stage path to a semantic model YAML file (for example @MY_DB.MY_SCHEMA.MY_STAGE/model.yaml). Provide exactly one semantic source.',
    },
    semanticModel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full semantic model YAML. Provide exactly one semantic source.',
    },
    semanticModels: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Several semantic sources for Cortex Analyst to choose between, as a JSON array of {"semantic_view": "..."} or {"semantic_model_file": "@..."} objects. Provide exactly one semantic source.',
    },
    history: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Earlier conversation messages in order, as returned in the conversation output of a previous ask',
    },
    executeSql: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run the generated SQL with the same credential and return the result rows',
    },
    warehouse: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Warehouse for running the generated SQL; defaults to the PAT user setting',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Snowflake role for running the generated SQL. Cortex Analyst itself always answers under the access token role',
    },
    maxRows: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum result rows when running the SQL; defaults to 1000 (Sim limit 10000)',
    },
    statementTimeoutSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timeout in seconds for running the SQL; 0 uses the Snowflake maximum',
    },
  },
  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({
        question: params.question,
        history: params.history,
        semanticModel: params.semanticModel,
      }),
    },
    url: (params) => `${getSnowflakeBaseUrl(params)}/api/v2/cortex/analyst/message`,
    method: 'POST',
    headers: getSnowflakeHeaders,
    body: buildCortexAnalystBody,
  },
  transformResponse: async (response, params) => {
    const data = (await response.json()) as CortexAnalystResponsePayload
    const sentMessages = params
      ? [
          ...parseCortexAnalystHistory(params.history),
          cortexAnalystUserMessage(params.question.trim()),
        ]
      : []
    return {
      success: true,
      output: mapCortexAnalystResponse(
        data,
        sentMessages,
        response.headers.get('X-Snowflake-Request-Id')
      ),
    }
  },
  postProcess: async (result, params, executeTool) => {
    const { sql } = result.output
    if (!sql || !shouldExecuteSql(params.executeSql)) return result

    /** A thrown nested call would otherwise leave the answer without its promised rows. */
    try {
      const execution = (await executeTool('snowflake_execute_sql', {
        /*
         * The token and host were already resolved for this call. Passing the credential ID
         * instead would re-resolve it without the caller's scope, which Chat does not forward
         * to nested tools.
         */
        accessToken: params.accessToken,
        domain: params.domain,
        statement: sql,
        ...cortexAnalystSqlContext(params, result.output.semanticModelSelection?.index),
        warehouse: params.warehouse,
        role: params.role,
        maxRows: params.maxRows,
        statementTimeoutSeconds: params.statementTimeoutSeconds,
      })) as SnowflakeStatementResponse
      if (!execution.success) {
        return {
          ...result,
          success: false,
          error: `Cortex Analyst generated SQL, but running it failed: ${execution.error ?? 'Unknown error'}`,
        }
      }
      return { ...result, output: { ...result.output, execution: execution.output } }
    } catch (error) {
      logger.error('Error running Cortex Analyst SQL', {
        message: getErrorMessage(error, 'Unknown error'),
      })
      return {
        ...result,
        success: false,
        error: `Cortex Analyst generated SQL, but running it failed: ${getErrorMessage(error, 'Unknown error')}`,
      }
    }
  },
  outputs: SNOWFLAKE_CORTEX_ANALYST_ASK_OUTPUTS,
}
