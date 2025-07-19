import { commentTool } from '@/tools/github/comment'
import { latestCommitTool } from '@/tools/github/latest_commit'
import { prTool } from '@/tools/github/pr'
import { repoInfoTool } from '@/tools/github/repo_info'

export const githubCommentTool = commentTool
export const githubLatestCommitTool = latestCommitTool
export const githubPrTool = prTool
export const githubRepoInfoTool = repoInfoTool
