/** What a field exposes so its sub-block's label row can run the AI prompt into it. */
export interface WandControlHandlers {
  onWandTrigger: (prompt: string) => void
  isWandActive: boolean
  isWandStreaming: boolean
}
