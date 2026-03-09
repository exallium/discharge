/**
 * HTTP Client for Discharge API
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

export interface ClientOptions {
  serverUrl: string;
  token: string;
}

export class DischargeClient {
  private serverUrl: string;
  private token: string;

  constructor(options: ClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, '');
    this.token = options.token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.serverUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const bodyStr = body ? JSON.stringify(body) : undefined;

    return new Promise<T>((resolve, reject) => {
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
              } else {
                resolve(parsed);
              }
            } catch {
              reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
            }
          });
        }
      );

      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  async submitJob(params: {
    projectId: string;
    title: string;
    description?: string;
    mode?: string;
    skipPR?: boolean;
    severity?: string;
    gitAuthor?: { name: string; email: string };
  }) {
    return this.request<{ jobId: string; status: string }>('POST', '/api/cli/jobs', params);
  }

  async listJobs(params: { projectId: string; limit?: number; status?: string }) {
    const query = new URLSearchParams({ projectId: params.projectId });
    if (params.limit) query.set('limit', String(params.limit));
    if (params.status) query.set('status', params.status);
    return this.request<{ jobs: unknown[] }>('GET', `/api/cli/jobs?${query}`);
  }

  async getJob(jobId: string) {
    return this.request<{ job: unknown }>('GET', `/api/cli/jobs/${jobId}`);
  }

  async getStats(projectId?: string) {
    const query = projectId ? `?projectId=${projectId}` : '';
    return this.request<{ queue: unknown; jobs: unknown }>('GET', `/api/cli/stats${query}`);
  }

  getStreamUrl(jobId: string): string {
    return `${this.serverUrl}/api/cli/jobs/${jobId}/stream`;
  }
}
