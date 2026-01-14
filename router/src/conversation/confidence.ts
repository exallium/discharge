/**
 * Confidence Assessor
 *
 * Assesses confidence scores for auto-routing decisions.
 * Determines whether to auto-execute or request review.
 */

import type {
  ConfidenceAssessment,
  ConfidenceFactor,
  RouteMode,
} from '../types/conversation';
import type { AnalysisResult } from '../runner/base';

/**
 * High-risk paths that reduce confidence
 */
const HIGH_RISK_PATHS = [
  /auth/i,
  /security/i,
  /payment/i,
  /billing/i,
  /subscription/i,
  /password/i,
  /credential/i,
  /secret/i,
  /token/i,
  /migration/i,
  /schema/i,
];

/**
 * Confidence Assessor
 *
 * Analyzes runner output to determine confidence score
 * and make routing recommendations.
 */
export class ConfidenceAssessor {
  private threshold: number;

  constructor(threshold = 0.85) {
    this.threshold = threshold;
  }

  /**
   * Parse confidence from runner analysis result
   */
  parseFromAnalysis(analysis: AnalysisResult): ConfidenceAssessment {
    const factors: ConfidenceFactor[] = [];
    let baseScore = 0.5; // Start at neutral

    // Analyze complexity
    if (analysis.complexity) {
      switch (analysis.complexity) {
        case 'trivial':
          factors.push({
            factor: 'trivial_complexity',
            impact: 'positive',
            weight: 0.1,
            description: 'Change is trivial in complexity',
          });
          baseScore += 0.1;
          break;
        case 'simple':
          factors.push({
            factor: 'simple_complexity',
            impact: 'positive',
            weight: 0.05,
            description: 'Change is simple in complexity',
          });
          baseScore += 0.05;
          break;
        case 'complex':
          factors.push({
            factor: 'complex_complexity',
            impact: 'negative',
            weight: 0.15,
            description: 'Change is complex',
          });
          baseScore -= 0.15;
          break;
      }
    }

    // Analyze files involved
    if (analysis.filesInvolved) {
      const fileCount = analysis.filesInvolved.length;

      if (fileCount === 1) {
        factors.push({
          factor: 'isolated_to_single_file',
          impact: 'positive',
          weight: 0.15,
          description: 'Change is isolated to a single file',
        });
        baseScore += 0.15;
      } else if (fileCount > 3) {
        factors.push({
          factor: 'multiple_files_affected',
          impact: 'negative',
          weight: 0.1,
          description: `Change affects ${fileCount} files`,
        });
        baseScore -= 0.1;
      }

      // Check for high-risk paths
      const highRiskFiles = analysis.filesInvolved.filter((file) =>
        HIGH_RISK_PATHS.some((pattern) => pattern.test(file))
      );

      if (highRiskFiles.length > 0) {
        // Determine which high-risk area
        const isAuth = highRiskFiles.some(
          (f) => /auth|security|password|credential|secret|token/i.test(f)
        );
        const isPayment = highRiskFiles.some(
          (f) => /payment|billing|subscription/i.test(f)
        );
        const isMigration = highRiskFiles.some(
          (f) => /migration|schema/i.test(f)
        );

        if (isAuth) {
          factors.push({
            factor: 'touches_auth_security',
            impact: 'negative',
            weight: 0.25,
            description: 'Change touches authentication/security code',
          });
          baseScore -= 0.25;
        }
        if (isPayment) {
          factors.push({
            factor: 'touches_payments_billing',
            impact: 'negative',
            weight: 0.25,
            description: 'Change touches payments/billing code',
          });
          baseScore -= 0.25;
        }
        if (isMigration) {
          factors.push({
            factor: 'schema_migration_changes',
            impact: 'negative',
            weight: 0.2,
            description: 'Change involves schema/migration files',
          });
          baseScore -= 0.2;
        }
      }
    }

    // Use runner's confidence if available
    if (analysis.confidence) {
      const confidenceStr = analysis.confidence.toLowerCase();
      if (confidenceStr === 'high') {
        baseScore += 0.2;
        factors.push({
          factor: 'runner_high_confidence',
          impact: 'positive',
          weight: 0.2,
          description: 'Runner reported high confidence',
        });
      } else if (confidenceStr === 'low') {
        baseScore -= 0.2;
        factors.push({
          factor: 'runner_low_confidence',
          impact: 'negative',
          weight: 0.2,
          description: 'Runner reported low confidence',
        });
      }
    }

    // Can auto-fix flag from runner
    if (analysis.canAutoFix === true) {
      factors.push({
        factor: 'runner_can_auto_fix',
        impact: 'positive',
        weight: 0.15,
        description: 'Runner indicates fix can be auto-applied',
      });
      baseScore += 0.15;
    } else if (analysis.canAutoFix === false) {
      factors.push({
        factor: 'runner_cannot_auto_fix',
        impact: 'negative',
        weight: 0.15,
        description: 'Runner indicates fix should not be auto-applied',
      });
      baseScore -= 0.15;
    }

    // Clamp score to [0, 1]
    const score = Math.max(0, Math.min(1, baseScore));

    // Determine recommendation
    const recommendation: 'auto_execute' | 'request_review' =
      score >= this.threshold ? 'auto_execute' : 'request_review';

    // Build reasoning
    const reasoning = this.buildReasoning(score, factors, recommendation);

    return {
      score,
      autoExecuteThreshold: this.threshold,
      factors,
      recommendation,
      reasoning,
    };
  }

  /**
   * Build human-readable reasoning
   */
  private buildReasoning(
    score: number,
    factors: ConfidenceFactor[],
    recommendation: 'auto_execute' | 'request_review'
  ): string {
    const positiveFactors = factors.filter((f) => f.impact === 'positive');
    const negativeFactors = factors.filter((f) => f.impact === 'negative');

    let reasoning = `Confidence score: ${(score * 100).toFixed(0)}% (threshold: ${(this.threshold * 100).toFixed(0)}%). `;

    if (positiveFactors.length > 0) {
      reasoning += `Positive factors: ${positiveFactors.map((f) => f.description).join(', ')}. `;
    }

    if (negativeFactors.length > 0) {
      reasoning += `Concerns: ${negativeFactors.map((f) => f.description).join(', ')}. `;
    }

    reasoning +=
      recommendation === 'auto_execute'
        ? 'Recommending automatic execution.'
        : 'Recommending human review before execution.';

    return reasoning;
  }

  /**
   * Check if auto-execute is appropriate
   */
  shouldAutoExecute(assessment: ConfidenceAssessment): boolean {
    return assessment.score >= assessment.autoExecuteThreshold;
  }

  /**
   * Apply tag overrides to routing decision
   */
  applyTagOverrides(
    assessment: ConfidenceAssessment,
    tags: string[],
    routingTags = { plan: 'ai:plan', auto: 'ai:auto', assist: 'ai:assist' }
  ): RouteMode {
    // Explicit overrides take precedence
    if (tags.includes(routingTags.assist)) {
      return 'assist_only';
    }
    if (tags.includes(routingTags.plan)) {
      return 'plan_review';
    }
    if (tags.includes(routingTags.auto)) {
      return 'auto_execute';
    }

    // Fall back to confidence-based decision
    return assessment.recommendation === 'auto_execute'
      ? 'auto_execute'
      : 'plan_review';
  }

  /**
   * Update threshold
   */
  setThreshold(threshold: number): void {
    this.threshold = Math.max(0, Math.min(1, threshold));
  }

  /**
   * Get current threshold
   */
  getThreshold(): number {
    return this.threshold;
  }
}

// Default singleton instance
let defaultAssessor: ConfidenceAssessor | null = null;

/**
 * Get the default ConfidenceAssessor instance
 */
export function getConfidenceAssessor(): ConfidenceAssessor {
  if (!defaultAssessor) {
    const threshold = parseFloat(
      process.env.AUTO_EXECUTE_THRESHOLD || '0.85'
    );
    defaultAssessor = new ConfidenceAssessor(threshold);
  }
  return defaultAssessor;
}

/**
 * Initialize the ConfidenceAssessor with a custom threshold
 */
export function initializeConfidenceAssessor(threshold?: number): ConfidenceAssessor {
  defaultAssessor = new ConfidenceAssessor(
    threshold ?? parseFloat(process.env.AUTO_EXECUTE_THRESHOLD || '0.85')
  );
  return defaultAssessor;
}
