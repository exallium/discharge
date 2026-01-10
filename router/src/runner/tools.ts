import { writeFile, mkdir, chmod } from 'fs/promises';
import { join } from 'path';
import { Tool } from '../triggers/base';

/**
 * Generate tool scripts and write them to a directory
 *
 * @param tools - Array of tools from source plugin
 * @param workspacePath - Workspace directory path
 * @returns Path to the tools directory
 */
export async function generateAndMountTools(
  tools: Tool[],
  workspacePath: string
): Promise<string> {
  // Create .claude-tools directory in workspace
  const toolsDir = join(workspacePath, '.claude-tools');
  await mkdir(toolsDir, { recursive: true });

  // Write each tool as an executable bash script
  for (const tool of tools) {
    const toolPath = join(toolsDir, tool.name);

    // Ensure script has proper shebang
    const script = tool.script.startsWith('#!')
      ? tool.script
      : `#!/bin/bash\n${tool.script}`;

    await writeFile(toolPath, script, { mode: 0o755 });
    await chmod(toolPath, 0o755); // Ensure executable
  }

  console.log(`Generated ${tools.length} tools in ${toolsDir}`);

  return toolsDir;
}

/**
 * Generate a README for the tools directory
 * This helps Claude understand what tools are available
 */
export async function generateToolsReadme(
  tools: Tool[],
  toolsDir: string
): Promise<void> {
  const readmeContent = `# Investigation Tools

The following tools are available to help investigate this issue:

${tools.map(tool => `
## ${tool.name}

${tool.description}

\`\`\`bash
${tool.name} [arguments]
\`\`\`
`).join('\n')}

## Usage

All tools are executable bash scripts in your PATH. Run them directly:

\`\`\`bash
${tools[0]?.name || 'tool-name'}
\`\`\`

Tools output JSON when possible for easy parsing with \`jq\`.
`;

  await writeFile(join(toolsDir, 'README.md'), readmeContent);
}

/**
 * Validate tool scripts for common issues
 */
export function validateTool(tool: Tool): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required fields
  if (!tool.name || tool.name.trim() === '') {
    errors.push('Tool name is required');
  }

  if (!tool.description || tool.description.trim() === '') {
    errors.push('Tool description is required');
  }

  if (!tool.script || tool.script.trim() === '') {
    errors.push('Tool script is required');
  }

  // Check for invalid characters in name (must be valid filename)
  if (tool.name && !/^[a-z0-9\-_]+$/i.test(tool.name)) {
    errors.push('Tool name must contain only alphanumeric characters, hyphens, and underscores');
  }

  // Warn about potentially unsafe patterns
  if (tool.script && tool.script.includes('rm -rf /')) {
    errors.push('Tool script contains potentially dangerous command: rm -rf /');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate all tools in array
 */
export function validateTools(tools: Tool[]): { valid: boolean; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};

  for (const tool of tools) {
    const validation = validateTool(tool);
    if (!validation.valid) {
      errors[tool.name] = validation.errors;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
