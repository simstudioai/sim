import type { UserFile } from '@/executor/types'
import type { ToolFileData, ToolResponse } from '@/tools/types'

/**
 * Complete Telegram Bot API type definitions covering all 180+ API methods
 * Reference: https://core.telegram.org/bots/api
 */

// ============================================================================
// API Envelope & Common Types
// ============================================================================

export interface TelegramApiResponse<T = unknown> {
  ok: boolean
  result?: T
  error_code?: number
  description?: string
  parameters?: Record<string, unknown>
}

export interface TelegramParams {
  botToken: string
  operation: string
  [key: string]: unknown
}

// ============================================================================
// User & Chat Types
// ============================================================================

export interface User {
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  added_to_attachment_menu?: boolean
  can_join_groups?: boolean
  can_read_all_group_messages?: boolean
  supports_inline_queries?: boolean
  can_connect_to_business?: boolean
}

export interface Chat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
  first_name?: string
  last_name?: string
  is_forum?: boolean
  description?: string
  invite_link?: string
  pinned_message?: Message
  permissions?: ChatPermissions
  sticker_set_name?: string
  can_set_sticker_set?: boolean
  linked_chat_id?: number
  location?: ChatLocation
  message_auto_delete_time?: number
}

export interface Message {
  message_id: number
  message_thread_id?: number
  from?: User
  sender_chat?: Chat
  date: number
  chat: Chat
  forward_origin?: MessageOrigin
  is_topic_message?: boolean
  is_automatic_forward?: boolean
  reply_to_message?: Message
  external_reply?: ExternalReplyInfo
  quote?: TextQuote
  reply_to_story?: Story
  via_bot?: User
  edit_date?: number
  has_protected_content?: boolean
  is_from_offline?: boolean
  media_group_id?: string
  author_signature?: string
  text?: string
  entities?: MessageEntity[]
  link_preview_options?: LinkPreviewOptions
  effect_id?: string
  animation?: Animation
  audio?: Audio
  document?: Document
  paid_media?: PaidMediaInfo
  photo?: PhotoSize[]
  sticker?: Sticker
  story?: Story
  video?: Video
  video_note?: VideoNote
  voice?: Voice
  caption?: string
  caption_entities?: MessageEntity[]
  show_caption_above_media?: boolean
  has_media_spoiler?: boolean
  contact?: Contact
  dice?: Dice
  game?: Game
  poll?: Poll
  venue?: Venue
  location?: Location
  new_chat_members?: User[]
  left_chat_member?: User
  new_chat_title?: string
  new_chat_photo?: PhotoSize[]
  delete_chat_photo?: boolean
  group_chat_created?: boolean
  supergroup_chat_created?: boolean
  channel_chat_created?: boolean
  message_auto_delete_timer_changed?: MessageAutoDeleteTimerChanged
  migrate_to_chat_id?: number
  migrate_from_chat_id?: number
  pinned_message?: Message
  invoice?: Invoice
  successful_payment?: SuccessfulPayment
  paid_media_purchased?: PaidMediaPurchased
  user_shared?: UserShared
  chat_shared?: ChatShared
  connected_website?: string
  write_access_allowed?: WriteAccessAllowed
  proximity_alert_triggered?: ProximityAlertTriggered
  video_chat_scheduled?: VideoChatScheduled
  video_chat_started?: VideoChatStarted
  video_chat_ended?: VideoChatEnded
  video_chat_participants_invited?: VideoChatParticipantsInvited
  web_app_data?: WebAppData
  button_pressed?: KeyboardButtonPressed
  forum_topic_created?: ForumTopicCreated
  forum_topic_edited?: ForumTopicEdited
  forum_topic_closed?: ForumTopicClosed
  forum_topic_reopened?: ForumTopicReopened
  general_forum_topic_hidden?: GeneralForumTopicHidden
  general_forum_topic_unhidden?: GeneralForumTopicUnhidden
  giveaway_created?: GiveawayCreated
  giveaway?: Giveaway
  giveaway_winners?: GiveawayWinners
  giveaway_completed?: GiveawayCompleted
}

export interface PhotoSize {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

export interface Audio {
  file_id: string
  file_unique_id: string
  duration: number
  performer?: string
  title?: string
  mime_type?: string
  file_size?: number
  thumbnail?: PhotoSize
}

export interface Document {
  file_id: string
  file_unique_id: string
  thumbnail?: PhotoSize
  file_name?: string
  mime_type?: string
  file_size?: number
}

export interface Video {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  duration: number
  thumbnail?: PhotoSize
  mime_type?: string
  file_size?: number
}

export interface Animation {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  duration: number
  thumbnail?: PhotoSize
  file_name?: string
  mime_type?: string
  file_size?: number
}

export interface Voice {
  file_id: string
  file_unique_id: string
  duration: number
  mime_type?: string
  file_size?: number
}

export interface VideoNote {
  file_id: string
  file_unique_id: string
  length: number
  duration: number
  thumbnail?: PhotoSize
  file_size?: number
}

export interface Update {
  update_id: number
  message?: Message
  edited_message?: Message
  channel_post?: Message
  edited_channel_post?: Message
  message_reaction?: MessageReactionUpdated
  message_reaction_count?: MessageReactionCountUpdated
  business_connection_id?: string
  business_message?: Message
  edited_business_message?: Message
  deleted_business_messages?: DeletedBusinessMessages
  inline_query?: InlineQuery
  chosen_inline_result?: ChosenInlineResult
  callback_query?: CallbackQuery
  shipping_query?: ShippingQuery
  pre_checkout_query?: PreCheckoutQuery
  purchased_paid_media?: PurchasedPaidMedia
  poll?: Poll
  poll_answer?: PollAnswer
  my_chat_member?: ChatMemberUpdated
  chat_member?: ChatMemberUpdated
  chat_join_request?: ChatJoinRequest
  chat_boost?: ChatBoostUpdated
  removed_chat_boost?: ChatBoostRemoved
  business_connection?: BusinessConnection
  business_messages_deleted?: BusinessMessagesDeleted
}

export interface MessageEntity {
  type:
    | 'mention'
    | 'hashtag'
    | 'cashtag'
    | 'bot_command'
    | 'url'
    | 'email'
    | 'phone_number'
    | 'bold'
    | 'italic'
    | 'underline'
    | 'strikethrough'
    | 'spoiler'
    | 'code'
    | 'pre'
    | 'text_link'
    | 'text_mention'
    | 'custom_emoji'
  offset: number
  length: number
  url?: string
  user?: User
  language?: string
  custom_emoji_id?: string
}

export interface ChatPermissions {
  can_send_messages?: boolean
  can_send_audios?: boolean
  can_send_documents?: boolean
  can_send_photos?: boolean
  can_send_videos?: boolean
  can_send_video_notes?: boolean
  can_send_voice_notes?: boolean
  can_send_polls?: boolean
  can_send_other_messages?: boolean
  can_add_web_page_previews?: boolean
  can_change_info?: boolean
  can_invite_users?: boolean
  can_pin_messages?: boolean
  can_manage_topics?: boolean
}

export interface Contact {
  phone_number: string
  first_name: string
  last_name?: string
  user_id?: number
  vcard?: string
}

export interface Dice {
  emoji: string
  value: number
}

export interface Location {
  longitude: number
  latitude: number
  horizontal_accuracy?: number
  live_period?: number
  heading?: number
  proximity_alert_radius?: number
}

export interface Venue {
  location: Location
  title: string
  address: string
  foursquare_id?: string
  foursquare_type?: string
  google_place_id?: string
  google_place_type?: string
}

export interface Poll {
  id: string
  question: string
  options: PollOption[]
  total_voter_count: number
  is_closed: boolean
  is_anonymous: boolean
  type: 'quiz' | 'regular'
  allows_multiple_answers: boolean
  correct_option_id?: number
  explanation?: string
  explanation_entities?: MessageEntity[]
  open_period?: number
  close_date?: number
}

export interface PollOption {
  text: string
  voter_count: number
  text_entities?: MessageEntity[]
}

export interface Invoice {
  title: string
  description: string
  start_parameter: string
  currency: string
  total_amount: number
}

export interface SuccessfulPayment {
  currency: string
  total_amount: number
  invoice_payload: string
  shipping_option_id?: string
  order_info?: OrderInfo
  telegram_payment_charge_id: string
  provider_payment_charge_id: string
}

export interface ShippingAddress {
  country_code: string
  state: string
  city: string
  street_line1: string
  street_line2: string
  post_code: string
}

export interface OrderInfo {
  name?: string
  phone_number?: string
  email?: string
  shipping_address?: ShippingAddress
}

export interface InlineQuery {
  id: string
  from: User
  query: string
  offset: string
  chat_type?: string
  location?: Location
}

export interface ChosenInlineResult {
  result_id: string
  from: User
  location?: Location
  inline_message_id?: string
  query: string
}

export interface CallbackQuery {
  id: string
  from: User
  chat_instance: string
  message?: Message
  inline_message_id?: string
  data?: string
  game_short_name?: string
}

export interface ShippingQuery {
  id: string
  from: User
  invoice_payload: string
  shipping_address: ShippingAddress
}

export interface PreCheckoutQuery {
  id: string
  from: User
  currency: string
  total_amount: number
  invoice_payload: string
  shipping_option_id?: string
  order_info?: OrderInfo
}

export interface Sticker {
  file_id: string
  file_unique_id: string
  type: 'regular' | 'mask' | 'custom_emoji'
  width: number
  height: number
  is_animated: boolean
  is_video: boolean
  is_custom_emoji?: boolean
  thumbnail?: PhotoSize
  emoji?: string
  set_name?: string
  premium_animation?: File
  mask_position?: MaskPosition
  custom_emoji_id?: string
  needs_repainting?: boolean
  file_size?: number
}

export interface MaskPosition {
  point: 'forehead' | 'eyes' | 'mouth' | 'chin'
  x_offset: number
  y_offset: number
  scale: number
}

export interface ChatMember {
  user: User
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked'
  custom_title?: string
  is_member?: boolean
  can_send_messages?: boolean
  until_date?: number
  [key: string]: unknown
}

export interface ChatMemberUpdated {
  chat: Chat
  from: User
  date: number
  old_chat_member: ChatMember
  new_chat_member: ChatMember
  invite_link?: ChatInviteLink
  via_chat_folder_invite_link?: boolean
}

export interface ChatInviteLink {
  invite_link: string
  creator: User
  creates_join_request: boolean
  is_primary: boolean
  is_revoked: boolean
  name?: string
  expire_date?: number
  member_limit?: number
  pending_join_request_count?: number
}

export interface Game {
  title: string
  description: string
  photo: PhotoSize[]
  text?: string
  text_entities?: MessageEntity[]
  animation?: Animation
}

export interface GameHighScore {
  position: number
  user: User
  score: number
}

// ============================================================================
// File & Webhook Types
// ============================================================================

export interface File {
  file_id: string
  file_unique_id: string
  file_size?: number
  file_path?: string
}

export interface WebhookInfo {
  url: string
  has_custom_certificate: boolean
  pending_update_count: number
  ip_address?: string
  last_error_date?: number
  last_error_message?: string
  last_synchronization_error_date?: number
  max_connections?: number
  allowed_updates?: string[]
  can_be_deleted_if_ignored?: boolean
}

export interface ReactionType {
  type: 'emoji' | 'custom_emoji'
  emoji?: string
  custom_emoji_id?: string
}

export interface MessageOrigin {
  type: 'user' | 'hidden_user' | 'chat' | 'channel'
  sender_user?: User
  date: number
  chat?: Chat
  chat_username?: string
  message_id?: number
}

export interface ExternalReplyInfo {
  origin: MessageOrigin
  chat?: Chat
  message_id?: number
  link_preview_options?: LinkPreviewOptions
  animation?: Animation
  audio?: Audio
  document?: Document
  paid_media?: PaidMediaInfo
  photo?: PhotoSize[]
  sticker?: Sticker
  story?: Story
  video?: Video
  video_note?: VideoNote
  voice?: Voice
  has_media_spoiler?: boolean
  contact?: Contact
  dice?: Dice
  game?: Game
  giveaway?: Giveaway
  giveaway_winners?: GiveawayWinners
  invoice?: Invoice
  location?: Location
  poll?: Poll
  venue?: Venue
}

export interface TextQuote {
  text: string
  entities?: MessageEntity[]
  position: number
  is_manual?: boolean
}

export interface Story {
  chat?: Chat
  id: number
}

export interface LinkPreviewOptions {
  is_disabled?: boolean
  url?: string
  prefer_small_media?: boolean
  prefer_large_media?: boolean
  show_above_text?: boolean
}

export interface PaidMediaInfo {
  star_count: number
  paid_media: PaidMedia[]
}

export interface PaidMedia {
  type: 'preview' | 'photo' | 'video'
  media?: PhotoSize | Video
  width?: number
  height?: number
  duration?: number
}

export interface MessageAutoDeleteTimerChanged {
  message_auto_delete_time: number
}

export interface PaidMediaPurchased {
  from_user: User
  paid_media_payload: string
}

export interface UserShared {
  request_id: number
  user_id: number
  first_name: string
  last_name?: string
  username?: string
}

export interface ChatShared {
  request_id: number
  chat_id: number
  title?: string
  username?: string
  photo?: PhotoSize[]
}

export interface WriteAccessAllowed {
  web_app_name?: string
}

export interface ProximityAlertTriggered {
  traveler: User
  watcher: User
  distance: number
}

export interface VideoChatScheduled {
  start_date: number
}

/** Telegram sends this as an empty object — the event carries no fields of its own. */
export type VideoChatStarted = Record<string, never>

export interface VideoChatEnded {
  duration: number
}

export interface VideoChatParticipantsInvited {
  users: User[]
}

export interface WebAppData {
  data: string
  button_text: string
}

export interface KeyboardButtonPressed {
  web_app: WebAppInfo
}

export interface WebAppInfo {
  url: string
}

export interface ForumTopicCreated {
  name: string
  icon_color: number
  icon_custom_emoji_id?: string
}

export interface ForumTopicEdited {
  name?: string
  icon_custom_emoji_id?: string
}

/** Telegram sends this as an empty object — the event carries no fields of its own. */
export type ForumTopicClosed = Record<string, never>

/** Telegram sends this as an empty object — the event carries no fields of its own. */
export type ForumTopicReopened = Record<string, never>

/** Telegram sends this as an empty object — the event carries no fields of its own. */
export type GeneralForumTopicHidden = Record<string, never>

/** Telegram sends this as an empty object — the event carries no fields of its own. */
export type GeneralForumTopicUnhidden = Record<string, never>

export interface GiveawayCreated {
  prize_star_count?: number
}

export interface Giveaway {
  chats: Chat[]
  winners_selection_date: number
  winner_count: number
  only_new_members?: boolean
  has_public_winners?: boolean
  prize_description?: string
  country_codes?: string[]
  premium_subscription_month_count?: number
}

export interface GiveawayWinners {
  giveaway_chat: Chat
  additional_chat_count?: number
  winners_selection_date: number
  winner_count: number
  winners: User[]
  unclaimed_prizes_count?: number
  only_new_members?: boolean
  was_refunded?: boolean
  prize_description?: string
}

export interface GiveawayCompleted {
  winner_count: number
  unclaimed_prize_count: number
  next_giveaway_chat?: Chat
}

export interface MessageReactionUpdated {
  chat: Chat
  message_id: number
  user?: User
  actor_chat?: Chat
  date: number
  old_reaction: ReactionType[]
  new_reaction: ReactionType[]
}

export interface MessageReactionCountUpdated {
  chat: Chat
  message_id: number
  date: number
  reactions: ReactionCount[]
}

export interface ReactionCount {
  type: ReactionType
  total_count: number
  recent_senders?: User[]
}

export interface DeletedBusinessMessages {
  business_connection_id: string
  chat_id: number
  message_ids: number[]
}

export interface PurchasedPaidMedia {
  from: User
  paid_media_payload: string
}

export interface PollAnswer {
  poll_id: string
  user: User
  option_ids: number[]
}

export interface ChatJoinRequest {
  chat: Chat
  from: User
  user_chat_id: number
  date: number
  bio?: string
  invite_link?: ChatInviteLink
}

export interface ChatBoostUpdated {
  chat: Chat
  boost: ChatBoost
}

export interface ChatBoost {
  boost_id: string
  add_date: number
  expiration_date: number
  source: ChatBoostSource
}

export interface ChatBoostSource {
  source: 'premium' | 'gift_code' | 'giveaway'
  user?: User
  gift_code?: string
  giveaway_message_id?: number
  is_unclaimed?: boolean
}

export interface ChatBoostRemoved {
  chat: Chat
  boost_id: string
  remove_date: number
  source: ChatBoostSource
}

export interface BusinessConnection {
  id: string
  user: User
  user_business_id: string
  date: number
  is_enabled: boolean
}

export interface BusinessMessagesDeleted {
  business_connection_id: string
  chat_id: number
  message_ids: number[]
}

export interface ChatLocation {
  location: Location
  address: string
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

export interface InlineKeyboardButton {
  text: string
  url?: string
  callback_data?: string
  web_app?: WebAppInfo
  login_url?: LoginUrl
  switch_inline_query?: string
  switch_inline_query_current_chat?: string
  switch_inline_query_chosen_chat?: SwitchInlineQueryChosenChat
  callback_game?: string
  pay?: boolean
}

export interface LoginUrl {
  url: string
  forward_text?: string
  bot_username?: string
  request_write_access?: boolean
}

export interface SwitchInlineQueryChosenChat {
  allow_user_chats?: boolean
  allow_bot_chats?: boolean
  allow_group_chats?: boolean
  allow_channel_chats?: boolean
}

// ============================================================================
// Legacy/Compatibility Types (for existing tools)
// ============================================================================

export interface TelegramMessage {
  message_id: number
  from: {
    id: number
    is_bot: boolean
    first_name?: string
    username?: string
  }
  chat?: {
    id: number
    first_name?: string
    username?: string
    type?: string
  }
  date: number
  text?: string
}

export interface TelegramAudio extends TelegramMessage {
  voice: {
    duration: number
    mime_type: string
    file_id: string
    file_unique_id: string
    file_size: number
  }
}

export interface TelegramPhoto extends TelegramMessage {
  photo?: {
    file_id: string
    file_unique_id: string
    file_size: number
    width: number
    height: number
  }
}

export interface TelegramMedia extends TelegramMessage {
  format?: {
    file_name: string
    mime_type: string
    duration: number
    width: number
    height: number
    thumbnail: {
      file_id: string
      file_unique_id: string
      file_size: number
      width: number
      height: number
    }
    thumb: {
      file_id: string
      file_unique_id: string
      file_size: number
      width: number
      height: number
    }
    file_id: string
    file_unique_id: string
    file_size: number
  }
  document?: {
    file_name: string
    mime_type: string
    thumbnail: {
      file_id: string
      file_unique_id: string
      file_size: number
      width: number
      height: number
    }
    thumb: {
      file_id: string
      file_unique_id: string
      file_size: number
      width: number
      height: number
    }
    file_id: string
    file_unique_id: string
    file_size: number
  }
}

interface TelegramAuthParams {
  botToken: string
  chatId: string
}

export interface TelegramSendMessageParams extends TelegramAuthParams {
  text: string
}

export interface TelegramSendPhotoParams extends TelegramAuthParams {
  photo: string
  caption?: string
}

export interface TelegramSendVideoParams extends TelegramAuthParams {
  video: string
  caption?: string
}

export interface TelegramSendAudioParams extends TelegramAuthParams {
  audio: string
  caption?: string
}

export interface TelegramSendAnimationParams extends TelegramAuthParams {
  animation: string
  caption?: string
}

export interface TelegramSendDocumentParams extends TelegramAuthParams {
  files?: UserFile[]
  caption?: string
}

export interface TelegramDeleteMessageParams extends TelegramAuthParams {
  messageId: number
}

export interface TelegramEditMessageTextParams extends TelegramAuthParams {
  messageId: number
  text: string
}

export interface TelegramForwardMessageParams extends TelegramAuthParams {
  fromChatId: string
  messageId: number
}

export interface TelegramCopyMessageParams extends TelegramAuthParams {
  fromChatId: string
  messageId: number
  caption?: string
}

export interface TelegramSendLocationParams extends TelegramAuthParams {
  latitude: number
  longitude: number
}

export interface TelegramSendContactParams extends TelegramAuthParams {
  phoneNumber: string
  firstName: string
  lastName?: string
  vcard?: string
}

export interface TelegramSendPollParams extends TelegramAuthParams {
  question: string
  options: string[]
  isAnonymous?: boolean
  allowsMultipleAnswers?: boolean
}

export interface TelegramPinMessageParams extends TelegramAuthParams {
  messageId: number
  disableNotification?: boolean
}

export interface TelegramUnpinMessageParams extends TelegramAuthParams {
  messageId?: number
}

export interface TelegramSetMessageReactionParams extends TelegramAuthParams {
  messageId: number
  reaction?: string
  isBig?: boolean
}

export interface TelegramSendChatActionParams extends TelegramAuthParams {
  action: string
}

export type TelegramGetChatParams = TelegramAuthParams

export interface TelegramGetChatMemberParams extends TelegramAuthParams {
  userId: number
}

export interface TelegramChatFullInfo {
  id: number
  type: string
  title?: string
  username?: string
  first_name?: string
  last_name?: string
  description?: string
  bio?: string
  invite_link?: string
  linked_chat_id?: number
}

export interface TelegramUser {
  id: number
  is_bot: boolean
  first_name?: string
  last_name?: string
  username?: string
}

export interface TelegramChatMember {
  status: string
  user: TelegramUser
}

export interface TelegramSendMessageResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramMessage
  }
}

export interface TelegramSendMediaResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramMedia
  }
}

export interface TelegramSendAudioResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramAudio
  }
}

export interface TelegramDeleteMessageResponse extends ToolResponse {
  output: {
    message: string
    data?: {
      ok: boolean
      deleted: boolean
    }
  }
}

export interface TelegramSendPhotoResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramPhoto
  }
}

export interface TelegramSendDocumentResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramMedia
    files?: ToolFileData[]
  }
}

export interface TelegramCopyMessageResponse extends ToolResponse {
  output: {
    message: string
    data?: {
      message_id: number
    }
  }
}

export interface TelegramBooleanResponse extends ToolResponse {
  output: {
    message: string
    data?: {
      ok: boolean
      result: boolean
    }
  }
}

export interface TelegramGetChatResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramChatFullInfo
  }
}

export interface TelegramGetChatMemberResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramChatMember
  }
}

// ============================================================================
// Response Union (supports all output types)
// ============================================================================

export type TelegramResponse =
  | TelegramSendMessageResponse
  | TelegramSendPhotoResponse
  | TelegramSendAudioResponse
  | TelegramSendMediaResponse
  | TelegramSendDocumentResponse
  | TelegramDeleteMessageResponse
  | TelegramCopyMessageResponse
  | TelegramBooleanResponse
  | TelegramGetChatResponse
  | TelegramGetChatMemberResponse
  | Message
  | User
  | Chat
  | boolean
  | string
  | number
  | Array<Message>
  | Array<User>
  | Array<Chat>
  | Array<Update>
  | Array<PhotoSize>
  | Array<ChatMember>
  | Array<GameHighScore>
  | Poll
  | Invoice
  | SuccessfulPayment
  | WebhookInfo
  | null
  | undefined
