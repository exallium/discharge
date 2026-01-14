'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Shield, ShieldCheck, ShieldOff } from 'lucide-react';
import { TotpSetupWizard } from './totp-setup-wizard';

interface SecuritySectionProps {
  initialTotpEnabled: boolean;
}

export function SecuritySection({ initialTotpEnabled }: SecuritySectionProps) {
  const router = useRouter();
  const [totpEnabled, setTotpEnabled] = useState(initialTotpEnabled);
  const [backupCodeCount, setBackupCodeCount] = useState(0);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [isDisabling, setIsDisabling] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  // Fetch TOTP status on mount
  useEffect(() => {
    async function fetchStatus() {
      try {
        const response = await fetch('/api/auth/totp/status');
        if (response.ok) {
          const data = await response.json();
          setTotpEnabled(data.enabled);
          setBackupCodeCount(data.backupCodeCount);
        }
      } catch (error) {
        console.error('Failed to fetch TOTP status:', error);
      }
    }
    fetchStatus();
  }, []);

  function handleToggle(checked: boolean) {
    if (checked && !totpEnabled) {
      setShowSetupWizard(true);
    } else if (!checked && totpEnabled) {
      setShowDisableDialog(true);
    }
  }

  function handleSetupComplete() {
    setShowSetupWizard(false);
    setTotpEnabled(true);
    setBackupCodeCount(10);
    router.refresh();
  }

  async function handleDisable() {
    setIsDisabling(true);
    setDisableError(null);

    try {
      const response = await fetch('/api/auth/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to disable 2FA');
      }

      setShowDisableDialog(false);
      setTotpEnabled(false);
      setDisablePassword('');
      router.refresh();
    } catch (error) {
      setDisableError(error instanceof Error ? error.message : 'Failed to disable 2FA');
    } finally {
      setIsDisabling(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security
          </CardTitle>
          <CardDescription>
            Manage two-factor authentication and security settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* TOTP Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                {totpEnabled ? (
                  <ShieldCheck className="h-4 w-4 text-green-600" />
                ) : (
                  <ShieldOff className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">Two-Factor Authentication</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {totpEnabled
                  ? 'Your account is protected with 2FA'
                  : 'Add an extra layer of security using an authenticator app'}
              </p>
            </div>
            <Switch
              checked={totpEnabled}
              onCheckedChange={handleToggle}
            />
          </div>

          {/* TOTP Status when enabled */}
          {totpEnabled && (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Backup codes remaining</span>
                <span className="text-sm font-medium">{backupCodeCount} of 10</span>
              </div>
              {backupCodeCount <= 3 && backupCodeCount > 0 && (
                <p className="text-sm text-amber-600">
                  You&apos;re running low on backup codes. Consider regenerating them.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDisableDialog(true)}
                >
                  Disable 2FA
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Setup Wizard Dialog */}
      <Dialog open={showSetupWizard} onOpenChange={setShowSetupWizard}>
        <DialogContent className="max-w-md">
          <TotpSetupWizard
            onComplete={handleSetupComplete}
            onCancel={() => setShowSetupWizard(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Disable Confirmation Dialog */}
      <Dialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              This will remove the extra security layer from your account.
              Enter your password to confirm.
            </DialogDescription>
          </DialogHeader>

          {disableError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {disableError}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="disable-password">Password</Label>
            <Input
              id="disable-password"
              type="password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Enter your password"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDisableDialog(false);
                setDisablePassword('');
                setDisableError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisable}
              disabled={isDisabling || !disablePassword}
            >
              {isDisabling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Disabling...
                </>
              ) : (
                'Disable 2FA'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
