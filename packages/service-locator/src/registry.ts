/**
 * Service Registry
 *
 * Central registry for all service plugins.
 * Provides lookup by service ID, trigger type, runner type, and VCS for repo.
 */

import type {
  ServiceManifest,
  TriggerPlugin,
  VCSPlugin,
  VCSPluginFactory,
  RunnerPlugin,
  SecretRequirement,
} from '@ai-bug-fixer/service-sdk';

/**
 * Service Registry
 *
 * Manages registration and lookup of service plugins.
 */
export class ServiceRegistry {
  private services = new Map<string, ServiceManifest>();
  private triggersByType = new Map<string, TriggerPlugin>();
  private runnersByType = new Map<string, RunnerPlugin>();
  private initialized = false;

  /**
   * Register a service manifest
   */
  register(service: ServiceManifest): void {
    if (this.services.has(service.id)) {
      console.warn(`[ServiceRegistry] Service '${service.id}' is already registered, overwriting`);
    }

    this.services.set(service.id, service);

    // Index trigger by type
    if (service.trigger) {
      this.triggersByType.set(service.trigger.type, service.trigger);
      console.log(`  ✓ Registered trigger: ${service.trigger.type}`);
    }

    // Index runner by type
    if (service.runner) {
      this.runnersByType.set(service.runner.type, service.runner);
      console.log(`  ✓ Registered runner: ${service.runner.type}`);
    }

    // VCS is looked up via factory, no indexing needed
    if (service.vcs) {
      console.log(`  ✓ Registered VCS factory`);
    }

    console.log(`[ServiceRegistry] Registered service: ${service.name} (${service.id})`);
  }

  /**
   * Initialize all registered services
   * Calls initialize() on each service that has one
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.warn('[ServiceRegistry] Already initialized');
      return;
    }

    console.log('[ServiceRegistry] Initializing services...');

    for (const [id, service] of this.services) {
      if (service.initialize) {
        try {
          await service.initialize();
          console.log(`  ✓ Initialized: ${service.name}`);
        } catch (error) {
          console.error(`  ✗ Failed to initialize ${service.name}:`, error);
          // Continue with other services
        }
      }
    }

    this.initialized = true;
    console.log(`[ServiceRegistry] ${this.services.size} service(s) registered`);
  }

  /**
   * Get a service by ID
   */
  getService(id: string): ServiceManifest | undefined {
    return this.services.get(id);
  }

  /**
   * Get a trigger from a service
   */
  getTrigger(serviceId: string): TriggerPlugin | undefined {
    return this.services.get(serviceId)?.trigger;
  }

  /**
   * Get a VCS factory from a service
   */
  getVCS(serviceId: string): VCSPluginFactory | undefined {
    return this.services.get(serviceId)?.vcs;
  }

  /**
   * Get a runner from a service
   */
  getRunner(serviceId: string): RunnerPlugin | undefined {
    return this.services.get(serviceId)?.runner;
  }

  /**
   * Get all registered triggers
   */
  getAllTriggers(): TriggerPlugin[] {
    return Array.from(this.services.values())
      .map(s => s.trigger)
      .filter((t): t is TriggerPlugin => t !== undefined);
  }

  /**
   * Get all registered runners
   */
  getAllRunners(): RunnerPlugin[] {
    return Array.from(this.services.values())
      .map(s => s.runner)
      .filter((r): r is RunnerPlugin => r !== undefined);
  }

  /**
   * Get all registered services
   */
  getAllServices(): ServiceManifest[] {
    return Array.from(this.services.values());
  }

  /**
   * Get a trigger by its type (e.g., 'github-issues', 'sentry')
   * Used for webhook routing
   */
  getTriggerByType(type: string): TriggerPlugin | undefined {
    return this.triggersByType.get(type);
  }

  /**
   * Get a runner by its type (e.g., 'claude-code')
   */
  getRunnerByType(type: string): RunnerPlugin | undefined {
    return this.runnersByType.get(type);
  }

  /**
   * Get a VCS plugin for a specific repository
   * Iterates through all VCS factories to find one that can handle this repo
   */
  async getVCSForRepo(repoFullName: string): Promise<VCSPlugin | null> {
    for (const service of this.services.values()) {
      if (service.vcs) {
        const isAvailable = await service.vcs.isAvailable(repoFullName);
        if (isAvailable) {
          return service.vcs.getForRepo(repoFullName);
        }
      }
    }
    return null;
  }

  /**
   * Check if any VCS is available for a repository
   */
  async isVCSAvailableForRepo(repoFullName: string): Promise<boolean> {
    for (const service of this.services.values()) {
      if (service.vcs) {
        const isAvailable = await service.vcs.isAvailable(repoFullName);
        if (isAvailable) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get all required secrets from all services
   * Deduplicates by secret ID
   */
  getAllRequiredSecrets(): SecretRequirement[] {
    const secretsById = new Map<string, SecretRequirement>();

    for (const service of this.services.values()) {
      for (const secret of service.getRequiredSecrets()) {
        // Use existing secret if same ID (allows services to share secrets)
        if (!secretsById.has(secret.id)) {
          secretsById.set(secret.id, secret);
        }
      }
    }

    return Array.from(secretsById.values());
  }

  /**
   * Validate all registered services
   */
  async validateAll(): Promise<Map<string, { valid: boolean; errors: string[]; warnings: string[] }>> {
    const results = new Map<string, { valid: boolean; errors: string[]; warnings: string[] }>();

    for (const [id, service] of this.services) {
      if (service.validate) {
        const result = await service.validate();
        results.set(id, result);
      } else {
        results.set(id, { valid: true, errors: [], warnings: [] });
      }
    }

    return results;
  }

  /**
   * Get service status for health checks
   */
  getStatus(): {
    initialized: boolean;
    serviceCount: number;
    triggerCount: number;
    runnerCount: number;
    vcsCount: number;
    services: Array<{
      id: string;
      name: string;
      hasTrigger: boolean;
      hasRunner: boolean;
      hasVCS: boolean;
    }>;
  } {
    const services = Array.from(this.services.values()).map(s => ({
      id: s.id,
      name: s.name,
      hasTrigger: !!s.trigger,
      hasRunner: !!s.runner,
      hasVCS: !!s.vcs,
    }));

    return {
      initialized: this.initialized,
      serviceCount: this.services.size,
      triggerCount: this.triggersByType.size,
      runnerCount: this.runnersByType.size,
      vcsCount: services.filter(s => s.hasVCS).length,
      services,
    };
  }

  /**
   * Clear all registered services (for testing)
   */
  clear(): void {
    this.services.clear();
    this.triggersByType.clear();
    this.runnersByType.clear();
    this.initialized = false;
  }
}
