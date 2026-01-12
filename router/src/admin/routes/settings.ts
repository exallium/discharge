/**
 * Admin API routes for settings management
 */

import { Router, Request, Response } from 'express';
import { settingsRepo, auditLogRepo } from '../../db/repositories';
import { getAllSettingsSchemas, getSettingsSchema } from '../../types/settings';
import { getAdminUser } from '../auth';
import { logger } from '../../logger';

export const settingsRouter = Router();

/**
 * GET /admin/api/settings/schema
 * Get all plugin settings schemas (for dynamic form rendering)
 */
settingsRouter.get('/schema', async (req: Request, res: Response) => {
  try {
    const schemas = getAllSettingsSchemas();

    res.json({ schemas });
  } catch (error) {
    logger.error('Failed to get settings schemas', { error });
    res.status(500).json({ error: 'Failed to get settings schemas' });
  }
});

/**
 * GET /admin/api/settings/schema/:category
 * Get a specific plugin's settings schema
 */
settingsRouter.get('/schema/:category', async (req: Request, res: Response) => {
  try {
    const schema = getSettingsSchema(req.params.category);

    if (!schema) {
      res.status(404).json({ error: 'Schema not found for category' });
      return;
    }

    res.json({ schema });
  } catch (error) {
    logger.error('Failed to get settings schema', { error, category: req.params.category });
    res.status(500).json({ error: 'Failed to get settings schema' });
  }
});

/**
 * GET /admin/api/settings/categories
 * Get list of all categories
 */
settingsRouter.get('/categories', async (req: Request, res: Response) => {
  try {
    const categories = await settingsRepo.getCategories();

    res.json({ categories });
  } catch (error) {
    logger.error('Failed to get settings categories', { error });
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

/**
 * GET /admin/api/settings
 * Get all settings (encrypted values are masked)
 */
settingsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const settings = await settingsRepo.getAll();

    res.json({ settings });
  } catch (error) {
    logger.error('Failed to get settings', { error });
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

/**
 * GET /admin/api/settings/:category
 * Get settings for a specific category
 */
settingsRouter.get('/:category', async (req: Request, res: Response) => {
  try {
    // Don't match reserved routes as categories
    if (req.params.category === 'schema' || req.params.category === 'categories') {
      return;
    }

    const settings = await settingsRepo.getByCategory(req.params.category);

    res.json({
      category: req.params.category,
      settings,
    });
  } catch (error) {
    logger.error('Failed to get settings by category', { error, category: req.params.category });
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

/**
 * PUT /admin/api/settings/:category/:key
 * Update a setting value
 */
settingsRouter.put('/:category/:key', async (req: Request, res: Response) => {
  try {
    const { category, key } = req.params;
    const { value, description } = req.body;

    if (value === undefined) {
      res.status(400).json({ error: 'value is required' });
      return;
    }

    // Get schema to check if this should be encrypted
    const schema = getSettingsSchema(category);
    const settingDef = schema?.settings.find((s) => s.key === key);
    const shouldEncrypt = settingDef?.encrypted ?? false;

    // Full key is category.key
    const fullKey = `${category}.${key}`;

    // Get existing value for audit log (if any)
    const existingValue = await settingsRepo.get(fullKey);

    // Set the value
    await settingsRepo.set(fullKey, value, {
      encrypted: shouldEncrypt,
      description: description || settingDef?.description,
      category,
    });

    // Audit log (don't log actual values for security)
    await auditLogRepo.logSettingChange(
      existingValue ? 'update' : 'create',
      fullKey,
      {
        actor: getAdminUser(req),
        ipAddress: req.ip,
      }
    );

    logger.info('Setting updated via admin API', { key: fullKey });

    res.json({
      success: true,
      key: fullKey,
    });
  } catch (error) {
    logger.error('Failed to update setting', {
      error,
      category: req.params.category,
      key: req.params.key,
    });
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

/**
 * DELETE /admin/api/settings/:category/:key
 * Delete a setting
 */
settingsRouter.delete('/:category/:key', async (req: Request, res: Response) => {
  try {
    const { category, key } = req.params;
    const fullKey = `${category}.${key}`;

    const deleted = await settingsRepo.remove(fullKey);

    if (!deleted) {
      res.status(404).json({ error: 'Setting not found' });
      return;
    }

    // Audit log
    await auditLogRepo.logSettingChange('delete', fullKey, {
      actor: getAdminUser(req),
      ipAddress: req.ip,
    });

    logger.info('Setting deleted via admin API', { key: fullKey });

    res.json({ success: true, key: fullKey });
  } catch (error) {
    logger.error('Failed to delete setting', {
      error,
      category: req.params.category,
      key: req.params.key,
    });
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

/**
 * POST /admin/api/settings/password
 * Change admin password
 */
settingsRouter.post('/password', async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 12) {
      res.status(400).json({ error: 'New password must be at least 12 characters' });
      return;
    }

    // Verify current password if one exists
    const hasExistingPassword = await settingsRepo.hasPassword('admin');
    if (hasExistingPassword) {
      if (!currentPassword) {
        res.status(400).json({ error: 'Current password is required' });
        return;
      }

      const isValid = await settingsRepo.verifyPassword('admin', currentPassword);
      if (!isValid) {
        res.status(401).json({ error: 'Current password is incorrect' });
        return;
      }
    }

    // Set new password
    await settingsRepo.setPassword('admin', newPassword, {
      description: 'Admin UI password hash',
      category: 'auth',
    });

    // Audit log
    await auditLogRepo.log('admin.password_change', { type: 'auth', id: 'admin' }, {
      actor: getAdminUser(req),
    });

    logger.info('Admin password changed via admin API');

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to change admin password', { error });
    res.status(500).json({ error: 'Failed to change password' });
  }
});
