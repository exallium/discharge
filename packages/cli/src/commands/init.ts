/**
 * discharge init [--server <url>]
 *
 * Interactive setup: authenticates with the server, generates an API token,
 * creates the project if needed, and writes .discharge.json + .discharge.env.
 */

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { success, error, info } from '../output';

function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // Disable echo for password
    if (process.stdin.isTTY) {
      process.stdout.write(`${question}: `);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);
      stdin.resume();

      let input = '';
      const onData = (ch: Buffer) => {
        const c = ch.toString('utf8');
        if (c === '\n' || c === '\r') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          rl.close();
          process.stdout.write('\n');
          resolve(input);
        } else if (c === '\u0003') {
          // Ctrl+C
          process.exit(1);
        } else if (c === '\u007f' || c === '\b') {
          // Backspace
          input = input.slice(0, -1);
        } else {
          input += c;
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(`${question}: `, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function gitExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function detectGitInfo(): {
  remoteUrl: string | null;
  repoFullName: string | null;
  branch: string | null;
  vcsType: string;
} {
  const remoteUrl = gitExec('git remote get-url origin');
  const branch = gitExec('git rev-parse --abbrev-ref HEAD') || 'main';

  let repoFullName: string | null = null;
  let vcsType = 'github';

  if (remoteUrl) {
    // Parse owner/repo from various URL formats
    // git@github.com:owner/repo.git
    // https://github.com/owner/repo.git
    const sshMatch = remoteUrl.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (sshMatch) {
      repoFullName = `${sshMatch[1]}/${sshMatch[2]}`;
    }

    if (remoteUrl.includes('gitlab')) vcsType = 'gitlab';
    else if (remoteUrl.includes('bitbucket')) vcsType = 'bitbucket';
  }

  return { remoteUrl, repoFullName, branch, vcsType };
}

function postJson(serverUrl: string, path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const url = new URL(path, serverUrl);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const bodyStr = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, data: JSON.parse(data) });
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function ensureGitignore(dir: string, entry: string): boolean {
  const gitignorePath = join(dir, '.gitignore');
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    if (content.split('\n').some((line) => line.trim() === entry)) {
      return false; // already present
    }
    appendFileSync(gitignorePath, `\n${entry}\n`);
  } else {
    writeFileSync(gitignorePath, `${entry}\n`);
  }
  return true;
}

export async function initCommand(options: { server?: string }) {
  console.log('');
  info('Discharge CLI Setup');
  console.log('');

  // 1. Detect git info
  const git = detectGitInfo();
  if (!git.remoteUrl) {
    error('Not a git repository or no remote configured.');
    error('Run this from your project root (with a git remote).');
    process.exit(1);
  }

  // 2. Server URL
  const serverUrl = options.server || await prompt('Discharge server URL', 'http://localhost:3000');

  // 3. Credentials
  console.log('');
  info('Authenticate with your Discharge admin account:');
  const username = await prompt('Username', 'admin');
  const password = await promptSecret('Password');

  if (!password) {
    error('Password is required.');
    process.exit(1);
  }

  // 4. Project info
  console.log('');
  const defaultId = git.repoFullName?.replace(/\//g, '-') || 'my-project';
  const projectId = await prompt('Project ID', defaultId);
  const repoFullName = await prompt('Repository', git.repoFullName || '');
  const branch = await prompt('Default branch', git.branch || 'main');

  if (!repoFullName) {
    error('Repository name (owner/repo) is required.');
    process.exit(1);
  }

  // 5. Call init endpoint
  console.log('');
  info('Connecting to server...');

  let result: { status: number; data: Record<string, unknown> };
  try {
    result = await postJson(serverUrl, '/api/cli/init', {
      username,
      password,
      project: {
        id: projectId,
        repoFullName,
        repo: git.remoteUrl,
        branch,
        vcsType: git.vcsType,
      },
    });
  } catch (err) {
    error(`Failed to connect to ${serverUrl}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (result.status === 401) {
    error('Invalid credentials.');
    process.exit(1);
  }

  if (result.status >= 400) {
    error(String(result.data.error || `Server returned ${result.status}`));
    process.exit(1);
  }

  const token = result.data.token as string;
  const projectInfo = result.data.project as { id: string; created: boolean } | undefined;

  // 6. Write .discharge.env
  const cwd = process.cwd();
  const envPath = join(cwd, '.discharge.env');
  writeFileSync(envPath, `DISCHARGE_TOKEN=${token}\n`, { mode: 0o600 });
  success(`Token saved to .discharge.env`);

  // 7. Add .discharge.env to .gitignore
  if (ensureGitignore(cwd, '.discharge.env')) {
    success('Added .discharge.env to .gitignore');
  }

  // 8. Write/update .discharge.json
  const configPath = join(cwd, '.discharge.json');
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      // start fresh
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
  cli.serverUrl = serverUrl;
  cli.projectId = projectId;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  success(`Config saved to .discharge.json`);

  // 9. Summary
  console.log('');
  if (projectInfo?.created) {
    success(`Project "${projectId}" created on server`);
  } else if (projectInfo) {
    success(`Project "${projectId}" found on server (kanban enabled)`);
  }

  console.log('');
  success('Setup complete! You can now run:');
  console.log('');
  console.log(`  discharge push "Fix the login bug" --desc "Users can't log in"`);
  console.log('');
}
