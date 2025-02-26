const mockHandler = {
  canHandle: jest.fn().mockReturnValue(true),
  execute: jest.fn().mockResolvedValue({ response: { result: 'success' } }),
}

export const AgentBlockHandler = jest.fn().mockImplementation(() => mockHandler)
export const RouterBlockHandler = jest.fn().mockImplementation(() => mockHandler)
export const ConditionBlockHandler = jest.fn().mockImplementation(() => mockHandler)
export const EvaluatorBlockHandler = jest.fn().mockImplementation(() => mockHandler)
export const FunctionBlockHandler = jest.fn().mockImplementation(() => mockHandler)
export const ApiBlockHandler = jest.fn().mockImplementation(() => mockHandler)
export const GenericBlockHandler = jest.fn().mockImplementation(() => mockHandler)
