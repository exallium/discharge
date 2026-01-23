'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Copy, Check, Download } from 'lucide-react';

type SetupStep = 'loading' | 'scan' | 'verify' | 'backup' | 'complete';

interface TotpSetupWizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

export function TotpSetupWizard({ onComplete, onCancel }: TotpSetupWizardProps) {
  const [step, setStep] = useState<SetupStep>('loading');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch QR code on mount
  useEffect(() => {
    async function fetchSetup() {
      try {
        const response = await fetch('/api/auth/totp/setup');
        if (!response.ok) {
          throw new Error('Failed to start setup');
        }
        const data = await response.json();
        setQrDataUrl(data.qrDataUrl);
        setSecret(data.secret);
        setStep('scan');
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to start setup');
      }
    }
    fetchSetup();
  }, []);

  async function handleVerify() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/totp/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verifyCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Invalid code');
      }

      setBackupCodes(data.backupCodes);
      setStep('backup');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  }

  function copySecret() {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyBackupCodes() {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadBackupCodes() {
    const content = `Discharge - Backup Codes\n${'='.repeat(30)}\n\nKeep these codes safe. Each code can only be used once.\n\n${backupCodes.join('\n')}\n\nGenerated: ${new Date().toISOString()}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'discharge-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Loading state
  if (step === 'loading') {
    if (error) {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Setup Failed</DialogTitle>
          </DialogHeader>
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              Close
            </Button>
          </DialogFooter>
        </>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Setting up two-factor authentication...</p>
      </div>
    );
  }

  // Step 1: Scan QR code
  if (step === 'scan') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Set Up Two-Factor Authentication</DialogTitle>
          <DialogDescription>
            Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center space-y-4">
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="TOTP QR Code"
              className="w-48 h-48 rounded-lg border"
            />
          )}

          <div className="w-full space-y-2">
            <p className="text-xs text-muted-foreground text-center">
              Or enter this code manually:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-muted px-3 py-2 rounded-md text-center break-all">
                {secret}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={copySecret}
                className="shrink-0"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => setStep('verify')}>
            Continue
          </Button>
        </DialogFooter>
      </>
    );
  }

  // Step 2: Verify code
  if (step === 'verify') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Verify Setup</DialogTitle>
          <DialogDescription>
            Enter the 6-digit code from your authenticator app to verify the setup
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="verify-code">Verification Code</Label>
          <Input
            id="verify-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="text-center text-lg tracking-widest"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setStep('scan')}>
            Back
          </Button>
          <Button
            onClick={handleVerify}
            disabled={isLoading || verifyCode.length !== 6}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              'Verify'
            )}
          </Button>
        </DialogFooter>
      </>
    );
  }

  // Step 3: Save backup codes
  if (step === 'backup') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Save Your Backup Codes</DialogTitle>
          <DialogDescription>
            Store these codes somewhere safe. Each code can only be used once if you lose access to your authenticator app.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-muted p-4 rounded-lg">
            {backupCodes.map((code, i) => (
              <div key={i} className="text-center py-1">
                {code}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={copyBackupCodes}
              className="flex-1"
            >
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadBackupCodes}
              className="flex-1"
            >
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onComplete}>
            I&apos;ve saved my backup codes
          </Button>
        </DialogFooter>
      </>
    );
  }

  return null;
}
