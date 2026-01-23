/**
 * Plan Manager
 *
 * Manages plan file creation, updates, and parsing.
 * Works with VCS plugins for file operations.
 */

import type { PlanFile, PlanStep } from '../types/conversation';
import type { VCSPlugin, PlanFileResult, VCSProjectConfig } from '@discharge/service-sdk';
import { logger } from '../logger';

/**
 * VCS plugin with plan file support
 */
interface VCSWithPlanSupport extends VCSPlugin {
  supportsPlanFiles: true;
  createPlanFile(
    project: VCSProjectConfig,
    content: string,
    filePath: string,
    issueNumber?: number | string
  ): Promise<PlanFileResult>;
  updatePlanFile(project: VCSProjectConfig, planRef: string, content: string): Promise<void>;
  getPlanFile(project: VCSProjectConfig, planRef: string): Promise<string | null>;
}

/**
 * Type guard for VCS plugins that support plan files
 */
function vcsSupportsPlans(vcs: VCSPlugin): vcs is VCSWithPlanSupport {
  return (
    vcs.supportsPlanFiles === true &&
    typeof vcs.createPlanFile === 'function' &&
    typeof vcs.updatePlanFile === 'function' &&
    typeof vcs.getPlanFile === 'function'
  );
}

/**
 * Plan reference returned from creation
 */
export interface PlanRef {
  planRef: string;
  branch?: string;
  prNumber?: number;
  url?: string;
}

/**
 * Plan Manager
 *
 * Handles:
 * - Plan file creation and updates via VCS
 * - Markdown serialization/deserialization
 * - Plan file path generation
 */
export class PlanManager {
  private planDirectory: string;

  constructor(planDirectory = '.ai-bug-fixer/plans') {
    this.planDirectory = planDirectory;
  }

  /**
   * Generate plan file path for an issue/conversation
   */
  getPlanPath(issueNumber: number | string): string {
    return `${this.planDirectory}/PLAN-${issueNumber}.md`;
  }

  /**
   * Create a new plan file in the repository
   */
  async createPlan(
    vcs: VCSPlugin,
    project: VCSProjectConfig,
    issueNumber: number | string,
    plan: PlanFile
  ): Promise<PlanRef | null> {
    // Check if VCS supports plan files
    if (!vcsSupportsPlans(vcs)) {
      logger.warn('VCS does not support plan files', { vcsType: vcs.type });
      return null;
    }

    const planPath = this.getPlanPath(issueNumber);
    const content = this.renderPlanToMarkdown(plan);

    try {
      const result = await vcs.createPlanFile(project, content, planPath);

      logger.info('Plan created', {
        issueNumber,
        planPath,
        planRef: result.planRef,
      });

      return result;
    } catch (error) {
      logger.error('Failed to create plan', {
        issueNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update an existing plan file
   */
  async updatePlan(
    vcs: VCSPlugin,
    project: VCSProjectConfig,
    planRef: string,
    plan: PlanFile,
    iteration: number
  ): Promise<void> {
    if (!vcsSupportsPlans(vcs)) {
      logger.warn('VCS does not support plan files', { vcsType: vcs.type });
      return;
    }

    // Update plan metadata
    plan.metadata.iteration = iteration;
    plan.metadata.updated = new Date().toISOString();

    const content = this.renderPlanToMarkdown(plan);

    try {
      await vcs.updatePlanFile(project, planRef, content);

      logger.info('Plan updated', {
        planRef,
        iteration,
      });
    } catch (error) {
      logger.error('Failed to update plan', {
        planRef,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get an existing plan file
   */
  async getPlan(
    vcs: VCSPlugin,
    project: VCSProjectConfig,
    planRef: string
  ): Promise<PlanFile | null> {
    if (!vcsSupportsPlans(vcs)) {
      return null;
    }

    try {
      const content = await vcs.getPlanFile(project, planRef);
      if (!content) {
        return null;
      }

      return this.parsePlanFromMarkdown(content);
    } catch (error) {
      logger.warn('Failed to get plan', {
        planRef,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Render a PlanFile to markdown
   */
  renderPlanToMarkdown(plan: PlanFile): string {
    const lines: string[] = [];

    // YAML frontmatter
    lines.push('---');
    lines.push(`issue: ${plan.metadata.issue}`);
    lines.push(`status: ${plan.metadata.status}`);
    lines.push(`iteration: ${plan.metadata.iteration}`);
    lines.push(`confidence: ${plan.metadata.confidence}`);
    lines.push(`created: ${plan.metadata.created}`);
    lines.push(`updated: ${plan.metadata.updated}`);
    lines.push(`author: ${plan.metadata.author}`);
    lines.push('---');
    lines.push('');

    // Title
    lines.push(`# Plan: Issue #${plan.metadata.issue}`);
    lines.push('');

    // Context
    lines.push('## Context');
    lines.push('');
    lines.push(plan.sections.context);
    lines.push('');

    // Approach
    lines.push('## Approach');
    lines.push('');
    lines.push(plan.sections.approach);
    lines.push('');

    // Steps
    lines.push('## Steps');
    lines.push('');
    for (const step of plan.sections.steps) {
      lines.push(`### ${step.title}`);
      lines.push('');
      lines.push(`**Complexity:** ${step.estimatedComplexity}`);
      if (step.files.length > 0) {
        lines.push(`**Files:** ${step.files.map(f => `\`${f}\``).join(', ')}`);
      }
      lines.push('');
      lines.push(step.description);
      lines.push('');
      for (const task of step.tasks) {
        lines.push(`- [ ] ${task}`);
      }
      lines.push('');
    }

    // Risks
    if (plan.sections.risks.length > 0) {
      lines.push('## Risks');
      lines.push('');
      for (const risk of plan.sections.risks) {
        lines.push(`- ${risk}`);
      }
      lines.push('');
    }

    // Questions
    if (plan.sections.questions.length > 0) {
      lines.push('## Questions');
      lines.push('');
      for (let i = 0; i < plan.sections.questions.length; i++) {
        lines.push(`${i + 1}. ${plan.sections.questions[i]}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Parse markdown back to PlanFile structure
   */
  parsePlanFromMarkdown(markdown: string): PlanFile {
    // Parse YAML frontmatter
    const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
    const metadata: PlanFile['metadata'] = {
      issue: 0,
      status: 'draft',
      iteration: 1,
      confidence: 0.5,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      author: 'claude',
    };

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const lines = frontmatter.split('\n');
      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        if (key && value) {
          switch (key.trim()) {
            case 'issue':
              metadata.issue = parseInt(value) || value;
              break;
            case 'status':
              if (['draft', 'reviewing', 'approved', 'executing', 'complete'].includes(value)) {
                metadata.status = value as PlanFile['metadata']['status'];
              }
              break;
            case 'iteration':
              metadata.iteration = parseInt(value) || 1;
              break;
            case 'confidence':
              metadata.confidence = parseFloat(value) || 0.5;
              break;
            case 'created':
              metadata.created = value;
              break;
            case 'updated':
              metadata.updated = value;
              break;
            case 'author':
              metadata.author = value;
              break;
          }
        }
      }
    }

    // Remove frontmatter for content parsing
    const content = markdown.replace(/^---\n[\s\S]*?\n---\n*/, '');

    // Parse sections
    const sections: PlanFile['sections'] = {
      context: '',
      approach: '',
      steps: [],
      risks: [],
      questions: [],
    };

    // Simple section parsing
    const contextMatch = content.match(/## Context\n+([\s\S]*?)(?=\n## |$)/);
    if (contextMatch) {
      sections.context = contextMatch[1].trim();
    }

    const approachMatch = content.match(/## Approach\n+([\s\S]*?)(?=\n## |$)/);
    if (approachMatch) {
      sections.approach = approachMatch[1].trim();
    }

    const stepsMatch = content.match(/## Steps\n+([\s\S]*?)(?=\n## Risks|\n## Questions|$)/);
    if (stepsMatch) {
      const stepsContent = stepsMatch[1];
      const stepMatches = stepsContent.matchAll(/### (.*?)\n+([\s\S]*?)(?=\n### |$)/g);

      for (const match of stepMatches) {
        const title = match[1].trim();
        const stepContent = match[2];

        const step: PlanStep = {
          title,
          description: '',
          tasks: [],
          files: [],
          estimatedComplexity: 'medium',
        };

        // Parse complexity
        const complexityMatch = stepContent.match(/\*\*Complexity:\*\* (\w+)/);
        if (complexityMatch) {
          const complexity = complexityMatch[1].toLowerCase();
          if (['trivial', 'low', 'medium', 'high'].includes(complexity)) {
            step.estimatedComplexity = complexity as PlanStep['estimatedComplexity'];
          }
        }

        // Parse files
        const filesMatch = stepContent.match(/\*\*Files:\*\* (.*)/);
        if (filesMatch) {
          step.files = filesMatch[1]
            .split(',')
            .map(f => f.trim().replace(/`/g, ''))
            .filter(f => f);
        }

        // Parse tasks (checkboxes)
        const taskMatches = stepContent.matchAll(/- \[[ x]\] (.*)/g);
        for (const taskMatch of taskMatches) {
          step.tasks.push(taskMatch[1].trim());
        }

        // Description is everything else after metadata
        const descriptionMatch = stepContent.match(
          /(?:\*\*Files:\*\* .*\n+|\*\*Complexity:\*\* .*\n+)*([\s\S]*?)(?=\n- \[|$)/
        );
        if (descriptionMatch) {
          step.description = descriptionMatch[1]
            .replace(/\*\*Complexity:\*\*.*\n*/g, '')
            .replace(/\*\*Files:\*\*.*\n*/g, '')
            .trim();
        }

        sections.steps.push(step);
      }
    }

    const risksMatch = content.match(/## Risks\n+([\s\S]*?)(?=\n## |$)/);
    if (risksMatch) {
      const riskLines = risksMatch[1].trim().split('\n');
      sections.risks = riskLines
        .filter(l => l.startsWith('- '))
        .map(l => l.slice(2).trim());
    }

    const questionsMatch = content.match(/## Questions\n+([\s\S]*?)$/);
    if (questionsMatch) {
      const questionLines = questionsMatch[1].trim().split('\n');
      sections.questions = questionLines
        .filter(l => /^\d+\./.test(l))
        .map(l => l.replace(/^\d+\.\s*/, '').trim());
    }

    return { metadata, sections };
  }

  /**
   * Create an initial plan from analysis
   */
  createInitialPlan(
    issueNumber: number | string,
    title: string,
    context: string,
    approach: string,
    confidence: number
  ): PlanFile {
    return {
      metadata: {
        issue: issueNumber,
        status: 'draft',
        iteration: 1,
        confidence,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        author: 'claude',
      },
      sections: {
        context,
        approach,
        steps: [],
        risks: [],
        questions: [],
      },
    };
  }
}

// Default singleton instance
let defaultManager: PlanManager | null = null;

/**
 * Get the default PlanManager instance
 */
export function getPlanManager(): PlanManager {
  if (!defaultManager) {
    const planDirectory = process.env.PLAN_DIRECTORY || '.ai-bug-fixer/plans';
    defaultManager = new PlanManager(planDirectory);
  }
  return defaultManager;
}

/**
 * Initialize the PlanManager with custom directory
 */
export function initializePlanManager(planDirectory?: string): PlanManager {
  defaultManager = new PlanManager(
    planDirectory ?? process.env.PLAN_DIRECTORY ?? '.ai-bug-fixer/plans'
  );
  return defaultManager;
}
