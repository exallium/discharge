import { NextRequest, NextResponse } from 'next/server';
import { getOctokitForRepo } from '@/src/github/app-service';
import {
  validateConfig,
  AiBugsConfig,
  BugFixConfig,
  getAvailableAgents,
} from '@/src/runner/bug-config';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * Validate a repository's .ai-bugs.json configuration
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

    // Try to fetch .ai-bugs.json
    const [owner, repo] = repoFullName.split('/');
    let configContent: string | null = null;

    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: '.ai-bugs.json',
      });

      if ('content' in data && data.type === 'file') {
        configContent = Buffer.from(data.content, 'base64').toString('utf-8');
      }
    } catch (e: unknown) {
      const error = e as { status?: number };
      if (error.status === 404) {
        return NextResponse.json({
          exists: false,
          message: 'No .ai-bugs.json found - using default settings',
        });
      }
      throw e;
    }

    if (!configContent) {
      return NextResponse.json({
        exists: false,
        message: 'No .ai-bugs.json found - using default settings',
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
        error: 'Invalid JSON syntax in .ai-bugs.json',
      });
    }

    const validation = validateConfig(parsed);

    if (!validation.valid) {
      return NextResponse.json({
        exists: true,
        valid: false,
        error: validation.error,
      });
    }

    // Get secondary repos based on config version
    let secondaryRepos: string[] = [];
    if (validation.isV2) {
      const v2Config = validation.config as AiBugsConfig;
      secondaryRepos = v2Config.config?.secondaryRepos || [];
    } else {
      const v1Config = validation.config as BugFixConfig;
      secondaryRepos = v1Config.secondaryRepos || [];
    }

    // Check access to secondary repos
    const secondaryAccess = await Promise.all(
      secondaryRepos.map(async (repoName: string) => {
        const secondaryOctokit = await getOctokitForRepo(repoName);
        return { repo: repoName, hasAccess: !!secondaryOctokit };
      })
    );

    // Count inaccessible repos for warning
    const inaccessibleCount = secondaryAccess.filter(r => !r.hasAccess).length;

    // Build response based on config version
    if (validation.isV2) {
      const v2Config = validation.config as AiBugsConfig;
      const agents = getAvailableAgents(v2Config);

      return NextResponse.json({
        exists: true,
        valid: true,
        schemaVersion: 2,
        config: {
          version: v2Config.version,
          rulesCount: v2Config.rules?.length || 0,
          agents: agents.map(a => ({
            name: a.name,
            model: a.model,
            description: a.description,
            isSystem: a.isSystem,
          })),
        },
        secondaryRepos: secondaryAccess,
        warnings: inaccessibleCount > 0
          ? [`${inaccessibleCount} secondary repo(s) are not accessible. Ensure the GitHub App is installed on those repositories.`]
          : [],
      });
    }

    // v1 legacy response
    const v1Config = validation.config as BugFixConfig;
    return NextResponse.json({
      exists: true,
      valid: true,
      schemaVersion: 1,
      config: {
        version: v1Config.version,
        categoryCount: Object.keys(v1Config.categories).length,
        categoryNames: Object.keys(v1Config.categories),
        hasConstraints: !!v1Config.constraints,
      },
      secondaryRepos: secondaryAccess,
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
