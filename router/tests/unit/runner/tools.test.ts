import { validateTool, validateTools } from '../../../src/runner/tools';
import { Tool } from '../../../src/sources/base';

describe('Tools', () => {
  describe('validateTool', () => {
    it('should validate a correct tool', () => {
      const tool: Tool = {
        name: 'get-issue',
        description: 'Get issue details',
        script: '#!/bin/bash\necho "test"',
      };

      const result = validateTool(tool);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject tool with missing name', () => {
      const tool: Tool = {
        name: '',
        description: 'Get issue details',
        script: '#!/bin/bash\necho "test"',
      };

      const result = validateTool(tool);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool name is required');
    });

    it('should reject tool with missing description', () => {
      const tool: Tool = {
        name: 'get-issue',
        description: '',
        script: '#!/bin/bash\necho "test"',
      };

      const result = validateTool(tool);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool description is required');
    });

    it('should reject tool with missing script', () => {
      const tool: Tool = {
        name: 'get-issue',
        description: 'Get issue details',
        script: '',
      };

      const result = validateTool(tool);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool script is required');
    });

    it('should reject tool with invalid characters in name', () => {
      const tool: Tool = {
        name: 'get issue!',
        description: 'Get issue details',
        script: '#!/bin/bash\necho "test"',
      };

      const result = validateTool(tool);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Tool name must contain only alphanumeric characters, hyphens, and underscores'
      );
    });

    it('should reject tool with dangerous command', () => {
      const tool: Tool = {
        name: 'dangerous-tool',
        description: 'Dangerous tool',
        script: '#!/bin/bash\nrm -rf /',
      };

      const result = validateTool(tool);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Tool script contains potentially dangerous command: rm -rf /'
      );
    });
  });

  describe('validateTools', () => {
    it('should validate array of correct tools', () => {
      const tools: Tool[] = [
        {
          name: 'tool1',
          description: 'Tool 1',
          script: '#!/bin/bash\necho "1"',
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          script: '#!/bin/bash\necho "2"',
        },
      ];

      const result = validateTools(tools);

      expect(result.valid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it('should return errors for invalid tools', () => {
      const tools: Tool[] = [
        {
          name: 'tool1',
          description: 'Tool 1',
          script: '#!/bin/bash\necho "1"',
        },
        {
          name: '',
          description: 'Tool 2',
          script: '#!/bin/bash\necho "2"',
        },
      ];

      const result = validateTools(tools);

      expect(result.valid).toBe(false);
      expect(result.errors['']).toBeDefined();
      expect(result.errors[''].length).toBeGreaterThan(0);
    });
  });
});
