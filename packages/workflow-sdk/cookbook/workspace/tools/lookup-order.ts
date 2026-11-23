// @sim-sdk 1
import { codeFile, defineTool } from '@sim/workflow-sdk/workspace'

// tools/<key>.ts, with its code in tools/<key>.js.
// A workflow names it as customTool('lookup-order').
export default defineTool({
  title: 'Lookup order',
  schema: {
    type: 'function',
    function: {
      name: 'lookup_order',
      description: 'Find an order by id.',
      parameters: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
    },
  },
  code: codeFile('./lookup-order.js'),
})
