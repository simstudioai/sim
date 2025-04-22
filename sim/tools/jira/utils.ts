import { JiraCloudResource } from './types'

export async function getJiraCloudId(domain: string, accessToken: string): Promise<string> {
    try {
        const accessibleResourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        if (!accessibleResourcesRes.ok) {
            // Only throw error if status indicates a real failure (not 2xx or 3xx)
            if (accessibleResourcesRes.status >= 400) {
                const errorData = await accessibleResourcesRes.json().catch(() => null);
                const errorMessage = errorData?.message || `Failed to fetch accessible resources: ${accessibleResourcesRes.status} ${accessibleResourcesRes.statusText}`;
                console.error('Accessible resources error:', {
                    status: accessibleResourcesRes.status,
                    statusText: accessibleResourcesRes.statusText,
                    errorData
                });
                throw new Error(errorMessage);
            }
        }

        const accessibleResources: JiraCloudResource[] = await accessibleResourcesRes.json();
        
        if (!Array.isArray(accessibleResources) || accessibleResources.length === 0) {
            throw new Error('No accessible Jira resources found for this account');
        }

        const normalizedInput = `https://${domain}`.toLowerCase();
        const matchedResource = accessibleResources.find(r => r.url.toLowerCase() === normalizedInput);

        if (!matchedResource) {
            console.error('Available resources:', accessibleResources.map(r => r.url));
            throw new Error(`Could not find matching Jira site for domain: ${domain}`);
        }

        return matchedResource.id;
    } catch (error) {
        // Ensure we always throw an Error object with a meaningful message
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to get Jira cloud ID: ${error}`);
    }
}