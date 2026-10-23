import { unpublishedFileCopyOpenApiRoutes } from '@/lib/api/contracts/v2/openapi/files-audit'
import { projectFileDownloadOpenApiRoutes } from '@/lib/api/contracts/v2/openapi/project-file-downloads'
import { projectFileFolderOpenApiRoutes } from '@/lib/api/contracts/v2/openapi/project-file-folders'
import { projectFileShareOpenApiRoutes } from '@/lib/api/contracts/v2/openapi/project-file-shares'
import { projectFileUploadOpenApiRoutes } from '@/lib/api/contracts/v2/openapi/project-file-uploads'
import { projectFileVersionOpenApiRoutes } from '@/lib/api/contracts/v2/openapi/project-file-versions'
import { projectFileOpenApiRoutes } from '@/lib/api/contracts/v2/openapi/project-files'

/** Keep runtime contracts and launch-ready definitions while Projects remains unreleased. */
export const unpublishedProjectFileDocumentation = {
  reason:
    'Project files are unreleased. Publish these routes and the Projects CLI documentation together at launch.',
  routes: [
    ...unpublishedFileCopyOpenApiRoutes,
    ...projectFileDownloadOpenApiRoutes,
    ...projectFileOpenApiRoutes,
    ...projectFileVersionOpenApiRoutes,
    ...projectFileFolderOpenApiRoutes,
    ...projectFileUploadOpenApiRoutes,
    ...projectFileShareOpenApiRoutes,
  ],
}
