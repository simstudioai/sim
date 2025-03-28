import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { agentChat, agentChatMessage } from '@/db/schema'
import { and, eq, asc } from 'drizzle-orm'

// GET: Retrieve a specific chat with its messages
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const chatId = params.id

    // Get the chat
    const [chat] = await db
      .select()
      .from(agentChat)
      .where(and(eq(agentChat.id, chatId), eq(agentChat.userId, userId)))
      .limit(1)

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Get all messages for this chat
    const messages = await db
      .select()
      .from(agentChatMessage)
      .where(eq(agentChatMessage.chatId, chatId))
      .orderBy(asc(agentChatMessage.order))

    return NextResponse.json({ chat, messages })
  } catch (error) {
    console.error('Error fetching chat:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chat' },
      { status: 500 }
    )
  }
}

// PUT: Update a chat (e.g., rename)
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const chatId = params.id
    const { title } = await request.json()

    // Verify the chat belongs to the user
    const [existingChat] = await db
      .select()
      .from(agentChat)
      .where(and(eq(agentChat.id, chatId), eq(agentChat.userId, userId)))
      .limit(1)

    if (!existingChat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Update the chat
    const [updatedChat] = await db
      .update(agentChat)
      .set({
        title,
        updatedAt: new Date(),
      })
      .where(and(eq(agentChat.id, chatId), eq(agentChat.userId, userId)))
      .returning()

    return NextResponse.json(updatedChat)
  } catch (error) {
    console.error('Error updating chat:', error)
    return NextResponse.json(
      { error: 'Failed to update chat' },
      { status: 500 }
    )
  }
}

// DELETE: Delete a chat and all its messages
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const chatId = params.id

    // Verify the chat belongs to the user
    const [existingChat] = await db
      .select()
      .from(agentChat)
      .where(and(eq(agentChat.id, chatId), eq(agentChat.userId, userId)))
      .limit(1)

    if (!existingChat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Delete all messages for this chat first
    await db
      .delete(agentChatMessage)
      .where(eq(agentChatMessage.chatId, chatId))

    // Then delete the chat
    await db
      .delete(agentChat)
      .where(and(eq(agentChat.id, chatId), eq(agentChat.userId, userId)))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting chat:', error)
    return NextResponse.json(
      { error: 'Failed to delete chat' },
      { status: 500 }
    )
  }
} 