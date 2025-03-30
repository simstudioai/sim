// Helper function to get the next block number for a given type
export const getNextBlockNumber = (blocks: Record<string, any>, type: string) => {
  const typeBlocks = Object.values(blocks)
    .filter((block: any) => block.type.toLowerCase() === type.toLowerCase())
    .map((block: any) => {
      const match = block.name.match(new RegExp(`${type}\\s*(\\d+)`, 'i'))
      return match ? parseInt(match[1]) : 0
    })

  const maxNumber = Math.max(0, ...typeBlocks)
  return maxNumber + 1
}

// Calculate block position based on existing blocks and current action index
export const calculateBlockPosition = (
  existingBlocks: Record<string, any>,
  index: number,
  startX = 100,
  startY = 100,
  xSpacing = 500,
  ySpacing = 150
) => {
  const blocksCount = Object.keys(existingBlocks).length

  // Calculate position based on existing blocks and current action index
  const row = Math.floor((blocksCount + index) / 5) // 5 blocks per row
  const col = (blocksCount + index) % 5

  return {
    x: startX + col * xSpacing,
    y: startY + row * ySpacing,
  }
}
