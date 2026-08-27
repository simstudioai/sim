import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  textractAnalyzeExpenseContract,
  textractAnalyzeIdContract,
  textractParseContract,
} from '@/lib/api/contracts/tools/media/document-parse'
import { getValidationErrorMessage } from '@/lib/api/server'
import {
  executeTextractAnalyzeExpense,
  executeTextractAnalyzeId,
  executeTextractParse,
  type TextractOperationContext,
} from '@/lib/internal/textract/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

type ParseResult<C extends AnyApiRouteContract> =
  | { success: true; data: ContractBody<C> }
  | { success: false; response: Response }

function parseTextractInput<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown
): ParseResult<C> {
  if (!contract.body) return { success: true, data: undefined as ContractBody<C> }
  const parsed = contract.body.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      response: Response.json(
        {
          success: false,
          error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
          details: parsed.error.issues,
        },
        { status: 400 }
      ),
    }
  }
  return { success: true, data: parsed.data as ContractBody<C> }
}

export const executeTextractTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  headers,
  context,
  requestId,
  signal,
}) => {
  signal?.throwIfAborted()
  if (!context.userId) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const operationContext: TextractOperationContext = {
    headers,
    userId: context.userId,
    requestId,
    signal,
  }

  switch (toolId) {
    case 'textract_parser':
    case 'textract_parser_v2': {
      const parsed = parseTextractInput(textractParseContract, input)
      if (!parsed.success) return parsed.response
      return executeTextractParse(parsed.data, operationContext)
    }
    case 'textract_analyze_expense': {
      const parsed = parseTextractInput(textractAnalyzeExpenseContract, input)
      if (!parsed.success) return parsed.response
      return executeTextractAnalyzeExpense(parsed.data, operationContext)
    }
    case 'textract_analyze_id': {
      const parsed = parseTextractInput(textractAnalyzeIdContract, input)
      if (!parsed.success) return parsed.response
      return executeTextractAnalyzeId(parsed.data, operationContext)
    }
    default:
      return Response.json({ error: `Unsupported Textract tool: ${toolId}` }, { status: 500 })
  }
}
