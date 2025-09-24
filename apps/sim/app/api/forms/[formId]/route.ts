import { db } from '@sim/db'
import { workflow, workflowForm } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const formId = (await params).formId

    const forms = await db
      .select({
        form: workflowForm,
        workflow: workflow,
      })
      .from(workflowForm)
      .innerJoin(workflow, eq(workflowForm.workflowId, workflow.id))
      .where(and(eq(workflowForm.path, formId), eq(workflowForm.isActive, true)))
      .limit(1)

    if (forms.length === 0) {
      return new NextResponse('Form not found', { status: 404 })
    }

    const form = forms[0].form
    const workflowData = forms[0].workflow

    return NextResponse.json({
      id: form.id,
      title: form.title,
      description: form.description,
      formConfig: form.formConfig,
      styling: form.styling,
      settings: form.settings,
      workflow: {
        id: workflowData.id,
        name: workflowData.name,
        color: workflowData.color,
      },
    })
  } catch (error: any) {
    console.error('Error fetching form:', error)
    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500,
    })
  }
}
