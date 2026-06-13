import { actionTool } from '@/tools/convex/action'
import { documentDeltasTool } from '@/tools/convex/document_deltas'
import { listDocumentsTool } from '@/tools/convex/list_documents'
import { listTablesTool } from '@/tools/convex/list_tables'
import { mutationTool } from '@/tools/convex/mutation'
import { queryTool } from '@/tools/convex/query'
import { runFunctionTool } from '@/tools/convex/run_function'

export const convexQueryTool = queryTool
export const convexMutationTool = mutationTool
export const convexActionTool = actionTool
export const convexRunFunctionTool = runFunctionTool
export const convexListTablesTool = listTablesTool
export const convexListDocumentsTool = listDocumentsTool
export const convexDocumentDeltasTool = documentDeltasTool
