import type {
  ConversationProtocol,
  NativeConversationMessage,
} from '@/lib/memory/conversation-types'
import type { Message } from '@/providers/types'

const nativeMessages = new WeakMap<object, NativeConversationMessage>()
const encryptedMessages = new WeakMap<object, string>()

export function setEncryptedConversationMessage(message: object, encrypted: string): void {
  encryptedMessages.set(message, encrypted)
}

export function getEncryptedConversationMessage(message: object): string | undefined {
  return encryptedMessages.get(message)
}

/** Native state is attached by trusted memory restoration, never accepted from user message JSON. */
export function setNativeConversationMessage(
  message: object,
  native: NativeConversationMessage
): void {
  nativeMessages.set(message, native)
}

export function getNativeConversationMessage(
  message: object,
  protocol: ConversationProtocol
): unknown | undefined {
  const native = nativeMessages.get(message)
  return native?.protocol === protocol ? native.value : undefined
}

export function getNativeConversationPrefixHash(message: object): string | undefined {
  return nativeMessages.get(message)?.prefixHash
}

/** Restoring a request must discard an attachment left by an earlier fallback attempt. */
export function retainCompatibleNativeConversationMessage(
  message: object,
  binding: Omit<NativeConversationMessage, 'value'>
): void {
  const native = nativeMessages.get(message)
  if (
    native &&
    (native.protocol !== binding.protocol ||
      native.providerId !== binding.providerId ||
      native.model !== binding.model ||
      native.binding !== binding.binding)
  ) {
    nativeMessages.delete(message)
  }
}

/** Message transforms preserve the binding without copying private data into enumerable fields. */
export function copyNativeConversationMessage(source: Message, target: Message): void {
  const native = nativeMessages.get(source)
  if (native) nativeMessages.set(target, native)
  const encrypted = encryptedMessages.get(source)
  if (encrypted) encryptedMessages.set(target, encrypted)
}
