/**
 * discharge link <url> <project-id> [--global]
 *
 * Save connection config. Default: .discharge.json cli section.
 * --global: ~/.config/discharge/config.json
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { success, error } from '../output';

export function linkCommand(url: string, projectId: string, options: { global?: boolean }) {
  if (options.global) {
    // Write to global config
    const configDir = join(homedir(), '.config', 'discharge');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'config.json');

    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch {
        // start fresh
      }
    }

    config.serverUrl = url;
    config.projectId = projectId;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    success(`Global config saved to ${configPath}`);
  } else {
    // Write to .discharge.json cli section
    const configPath = join(process.cwd(), '.discharge.json');

    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch {
        error(`Failed to parse existing .discharge.json`);
        process.exit(1);
      }
    }

    if (!config.version) {
      config.version = '2';
    }

    if (!config.config || typeof config.config !== 'object') {
      config.config = {};
    }

    const cfgObj = config.config as Record<string, unknown>;
    if (!cfgObj.cli || typeof cfgObj.cli !== 'object') {
      cfgObj.cli = {};
    }

    const cli = cfgObj.cli as Record<string, unknown>;
    cli.serverUrl = url;
    cli.projectId = projectId;

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    success(`Config saved to ${configPath}`);
  }
}
