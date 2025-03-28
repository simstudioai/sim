import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { addToWaitlist } from '@/lib/waitlist/service'

const waitlistSchema = z.object({
  email: z.string().email('Please enter a valid email'),
})

export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const body = await request.json()

    // Validate the request
    const validatedData = waitlistSchema.safeParse(body)

    if (!validatedData.success) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid email address',
          errors: validatedData.error.format(),
        },
        { status: 400 }
      )
    }

    const { email } = validatedData.data

    // Add the email to the waitlist and send confirmation email
    const result = await addToWaitlist(email)

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          message: result.message,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Successfully added to waitlist',
    })
  } catch (error) {
    console.error('Waitlist API error:', error)

    return NextResponse.json(
      {
        success: false,
        message: 'An error occurred while processing your request',
      },
      { status: 500 }
    )
  }
}
