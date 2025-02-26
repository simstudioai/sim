export const LoopManager = jest.fn().mockImplementation(() => ({
  processLoopIterations: jest.fn().mockResolvedValue(false),
  getMaxIterations: jest.fn().mockReturnValue(5),
}))
