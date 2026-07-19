import type { AttachedFile } from '@/app/(interfaces)/chat/components/input/input'

/**
 * One attachment as the chat wire format carries it: metadata plus the file
 * inlined as a base64 data URL. Matches `deployedChatFileSchema`
 * (`@/lib/api/contracts/chats`), which is what the server decodes and uploads.
 */
export interface ChatFilePayload {
  name: string
  size: number
  type: string
  data: string
}

/** Reads a `File` into a `data:<mime>;base64,…` URL. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Turns the composer's attachments into the wire payload both chat surfaces
 * send — the deployed chat and an interface's chat module.
 *
 * The `dataUrl` fallback is load-bearing rather than an optimisation: the
 * composer only pre-reads *images*, so every other attachment arrives with
 * `dataUrl: undefined` and must be read here. Skipping it produces an empty
 * `data`, which the server drops with only a warning — the file would vanish
 * silently instead of failing.
 */
export async function toChatFilePayloads(
  files: readonly AttachedFile[] | undefined
): Promise<ChatFilePayload[]> {
  if (!files || files.length === 0) return []
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      data: file.dataUrl || (await fileToBase64(file.file)),
    }))
  )
}
