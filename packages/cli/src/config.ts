/**
 * CLI Configuration Resolution
 *
 * Resolution order (project-local first):
 * 1. .discharge.json `cli` section in current directory
 * 2. ~/.config/discharge/config.json (global fallback)
 * 3. Token always from DISCHARGE_TOKEN env var
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface CliConfig {
  serverUrl: string;
  projectId: string;
  token: string;
  skipPR?: boolean;
  defaultMode?: 'triage' | 'investigate';
  localRepoPath?: string;
  worktreeCommand?: string;
  baseBranch?: string;
  copyFiles?: string[];
  gitAuthor?: 'auto' | { name: string; email: string };
}

interface DischargeJson {
  config?: {
    cli?: {
      serverUrl?: string;
      projectId?: string;
      skipPR?: boolean;
      defaultMode?: 'triage' | 'investigate';
      localRepoPath?: string;
      worktreeCommand?: string;
      baseBranch?: string;
      copyFiles?: string[];
      gitAuthor?: 'auto' | { name: string; email: string };
    };
  };
}

interface GlobalConfig {
  serverUrl?: string;
  projectId?: string;
}

function readDischargeJson(): DischargeJson | null {
  const path = join(process.cwd(), '.discharge.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function readGlobalConfig(): GlobalConfig | null {
  const path = join(homedir(), '.config', 'discharge', 'config.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function resolveConfig(): CliConfig | null {
  const token = process.env.DISCHARGE_TOKEN;
  if (!token) {
    return null;
  }

  const dischargeJson = readDischargeJson();
  const cliSection = dischargeJson?.config?.cli;
  const globalConfig = readGlobalConfig();

  const serverUrl = cliSection?.serverUrl || globalConfig?.serverUrl;
  const projectId = cliSection?.projectId || globalConfig?.projectId;

  if (!serverUrl || !projectId) {
    return null;
  }

  return {
    serverUrl,
    projectId,
    token,
    skipPR: cliSection?.skipPR,
    defaultMode: cliSection?.defaultMode,
    localRepoPath: cliSection?.localRepoPath,
    worktreeCommand: cliSection?.worktreeCommand,
    baseBranch: cliSection?.baseBranch,
    copyFiles: cliSection?.copyFiles,
    gitAuthor: cliSection?.gitAuthor,
  };
}
