'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import { client, useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { XCircle, CheckCircle } from 'lucide-react'

export default function InvitePage() {
  const router = useRouter()
  const params = useParams()
  const invitationId = params.id as string
  const searchParams = useSearchParams()
  const { data: session, isPending, error: sessionError } = useSession()
  const [invitation, setInvitation] = useState<any>(null)
  const [organization, setOrganization] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAccepting, setIsAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [isNewUser, setIsNewUser] = useState(false)

  // Check if this is a new user vs. existing user
  useEffect(() => {
    const isNew = searchParams.get('new') === 'true'
    setIsNewUser(isNew)
  }, [searchParams])

  // Fetch invitation details
  useEffect(() => {
    async function fetchInvitation() {
      try {
        setIsLoading(true)
        const { data } = await client.organization.getInvitation({
          query: { id: invitationId }
        })
        
        if (data) {
          setInvitation(data)
          
          // Get organization details if we have the invitation
          if (data.organizationId) {
            const orgResponse = await client.organization.getFullOrganization({
              query: { organizationId: data.organizationId }
            })
            setOrganization(orgResponse.data)
          }
        } else {
          setError('Invitation not found or has expired')
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load invitation')
      } finally {
        setIsLoading(false)
      }
    }
    
    // Only fetch if the user is logged in
    if (session?.user && invitationId) {
      fetchInvitation()
    }
  }, [invitationId, session?.user])

  // Handle invitation acceptance
  const handleAcceptInvitation = async () => {
    if (!session?.user) return
    
    try {
      setIsAccepting(true)
      console.log("Accepting invitation:", invitationId, "for user:", session.user.id);
      
      const response = await client.organization.acceptInvitation({
        invitationId
      })
      
      console.log("Invitation acceptance response:", response);
      
      // Explicitly verify membership was created
      try {
        const orgResponse = await client.organization.getFullOrganization({
          query: { organizationId: invitation.organizationId }
        });
        
        console.log("Organization members after acceptance:", orgResponse.data?.members);
        
        const isMember = orgResponse.data?.members?.some(
          (member: any) => member.userId === session.user.id
        );
        
        if (!isMember) {
          console.error("User was not added as a member after invitation acceptance");
          throw new Error("Failed to add you as a member. Please contact support.");
        }
        
        // Set the active organization to the one the user just joined
        await client.organization.setActive({
          organizationId: invitation.organizationId
        });
        
        console.log("Successfully set active organization:", invitation.organizationId);
      } catch (memberCheckErr: any) {
        console.error("Error verifying membership:", memberCheckErr);
        throw memberCheckErr;
      }
      
      setAccepted(true)
      
      // Redirect to the workspace after a short delay
      setTimeout(() => {
        router.push('/w')
      }, 2000)
      
    } catch (err: any) {
      console.error("Error accepting invitation:", err);
      setError(err.message || 'Failed to accept invitation')
    } finally {
      setIsAccepting(false)
    }
  }

  // Show login/signup prompt if not logged in
  if (!session?.user && !isPending) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>You've been invited to join a team</CardTitle>
            <CardDescription>
              {isNewUser ? 
                "Create an account to join this team on Sim Studio" :
                "Sign in to your account to accept this invitation"}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col space-y-2">
            {isNewUser ? (
              <>
                <Button 
                  className="w-full" 
                  onClick={() => router.push(`/signup?redirect=/invite/${invitationId}`)}
                >
                  Create an account
                </Button>
                <Button 
                  variant="outline"
                  className="w-full" 
                  onClick={() => router.push(`/login?redirect=/invite/${invitationId}`)}
                >
                  I already have an account
                </Button>
              </>
            ) : (
              <>
                <Button 
                  className="w-full" 
                  onClick={() => router.push(`/login?redirect=/invite/${invitationId}`)}
                >
                  Sign in
                </Button>
                <Button 
                  variant="outline"
                  className="w-full" 
                  onClick={() => router.push(`/signup?redirect=/invite/${invitationId}&new=true`)}
                >
                  Create an account
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      </div>
    )
  }

  // Show loading state
  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <LoadingAgent size="lg" />
        <p className="mt-4 text-sm text-muted-foreground">Loading invitation...</p>
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  // Show success state
  if (accepted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <Alert className="max-w-md bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <AlertTitle>Invitation Accepted</AlertTitle>
          <AlertDescription>
            You have successfully joined {organization?.name}. Redirecting to your workspace...
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // Show invitation details
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Team Invitation</CardTitle>
          <CardDescription>
            You've been invited to join{' '}
            <span className="font-medium">{organization?.name || 'a team'}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {invitation?.inviterId ? 'A team member has' : 'You have'} invited you to collaborate in {organization?.name || 'their workspace'}.
          </p>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={() => router.push('/')}>
            Decline
          </Button>
          <Button 
            onClick={handleAcceptInvitation} 
            disabled={isAccepting}
          >
            {isAccepting ? <LoadingAgent size="sm" /> : null}
            <span className={isAccepting ? "ml-2" : ""}>
              Accept Invitation
            </span>
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
