import { NextRequest, NextResponse } from 'next/server';
import { getOctokitForRepo } from '@/src/github/app-service';
import {
  validateBugConfig,
  AiBugsConfig,
  getAvailableAgents,
  getSentryConfig,
  getCircleCIConfig,
} from '@/src/runner/bug-config';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * Validate a repository's .discharge.json configuration
 * Returns config preview including secondary repos access status
 */
export async function POST(request: NextRequest) {
  try {
    const { repoFullName } = await request.json();

    if (!repoFullName || typeof repoFullName !== 'string') {
      return NextResponse.json(
        { error: 'repoFullName is required' },
        { status: 400 }
      );
    }

    // Get Octokit for this repo
    const octokit = await getOctokitForRepo(repoFullName);
    if (!octokit) {
      return NextResponse.json(
        { error: 'No access to repository. Ensure the GitHub App is installed.' },
        { status: 403 }
      );
    }

    // Try to fetch .discharge.json
    const [owner, repo] = repoFullName.split('/');
    let configContent: string | null = null;

    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: '.discharge.json',
      });

      if ('content' in data && data.type === 'file') {
        configContent = Buffer.from(data.content, 'base64').toString('utf-8');
      }
    } catch (e: unknown) {
      const error = e as { status?: number };
      if (error.status === 404) {
        return NextResponse.json({
          exists: false,
          message: 'No .discharge.json found - using default settings',
        });
      }
      throw e;
    }

    if (!configContent) {
      return NextResponse.json({
        exists: false,
        message: 'No .discharge.json found - using default settings',
      });
    }

    // Parse and validate
    let parsed: unknown;
    try {
      parsed = JSON.parse(configContent);
    } catch {
      return NextResponse.json({
        exists: true,
        valid: false,
        error: 'Invalid JSON syntax in .discharge.json',
      });
    }

    const validation = validateBugConfig(parsed);

    if (!validation.valid) {
      return NextResponse.json({
        exists: true,
        valid: false,
        error: validation.error,
      });
    }

    const config = validation.config as AiBugsConfig;
    const secondaryRepos = config.config?.secondaryRepos || [];

    // Check access to secondary repos
    const secondaryAccess = await Promise.all(
      secondaryRepos.map(async (repoName: string) => {
        const secondaryOctokit = await getOctokitForRepo(repoName);
        return { repo: repoName, hasAccess: !!secondaryOctokit };
      })
    );

    // Count inaccessible repos for warning
    const inaccessibleCount = secondaryAccess.filter(r => !r.hasAccess).length;

    const agents = getAvailableAgents(config);

    // Extract service integrations
    const sentryConfig = getSentryConfig(config);
    const circleCIConfig = getCircleCIConfig(config);

    return NextResponse.json({
      exists: true,
      valid: true,
      config: {
        version: config.version,
        rulesCount: config.rules?.length || 0,
        agents: agents.map(a => ({
          name: a.name,
          model: a.model,
          description: a.description,
          isSystem: a.isSystem,
        })),
      },
      secondaryRepos: secondaryAccess,
      // Include detected service integrations
      integrations: {
        sentry: sentryConfig ? {
          organization: sentryConfig.organization,
          project: sentryConfig.project,
          instanceUrl: sentryConfig.instanceUrl,
        } : null,
        circleci: circleCIConfig ? {
          project: circleCIConfig.project,
          configPath: circleCIConfig.configPath,
        } : null,
      },
      warnings: inaccessibleCount > 0
        ? [`${inaccessibleCount} secondary repo(s) are not accessible. Ensure the GitHub App is installed on those repositories.`]
        : [],
    });
  } catch (error) {
    console.error('Failed to validate config:', error);
    return NextResponse.json(
      { error: 'Failed to validate configuration' },
      { status: 500 }
    );
  }
}
