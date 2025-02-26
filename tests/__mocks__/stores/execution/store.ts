export const useExecutionStore = {
  getState: jest.fn().mockReturnValue({
    setIsExecuting: jest.fn(),
    reset: jest.fn(),
    setActiveBlocks: jest.fn(),
  }),
}
