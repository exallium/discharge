/**
 * PR Module
 *
 * Provides PR provider interface and registry for deterministic PR creation.
 */

export type {
  PRProvider,
  PRResult,
  CreatePROptions,
  CompareOptions,
} from './provider';

export {
  registerPRProvider,
  unregisterPRProvider,
  findPRProvider,
  listPRProviders,
  hasPRProviders,
  clearPRProviders,
} from './registry';

export { GitHubPRProvider, getGitHubPRProvider } from './github-provider';
