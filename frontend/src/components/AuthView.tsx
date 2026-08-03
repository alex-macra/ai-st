import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { Button, Input, DarkModeToggle, FormattedInput, LICENSE_KEY_RULE } from '../ui';
import { activate, requestOtp, verifyOtp } from '../api';
import type { User } from '../shared/types';

type Mode = 'choice' | 'activate' | 'login' | 'verify';

interface Props {
  onAuth: (user: User) => void;
  isDark: boolean;
  onToggleDark: () => void;
}

export function AuthView({ onAuth, isDark, onToggleDark }: Props) {
  const [mode, setMode] = useState<Mode>('choice');
  const [pendingEmail, setPendingEmail] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const activateChoiceRef = useRef<HTMLButtonElement>(null);
  const loginChoiceRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<'activate' | 'login' | null>(null);

  useEffect(() => {
    if (mode !== 'choice') return;
    if (returnFocusRef.current === 'activate') activateChoiceRef.current?.focus();
    if (returnFocusRef.current === 'login') loginChoiceRef.current?.focus();
    returnFocusRef.current = null;
  }, [mode]);

  async function handleActivate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const user = await activate((fd.get('email') as string).trim(), licenseKey.trim());
      setLicenseKey('');
      onAuth(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const email = (fd.get('email') as string).trim();
    try {
      await requestOtp(email);
      setPendingEmail(email);
      setMode('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const user = await verifyOtp(pendingEmail, (fd.get('code') as string).trim());
      onAuth(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  function back() {
    returnFocusRef.current = mode === 'activate' ? 'activate' : 'login';
    setError(null);
    setMode('choice');
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-900 px-4 py-2.5">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <Activity size={16} className="text-teal-600 dark:text-teal-400" />
            <span className="text-sm font-semibold tracking-tight">AI-ST</span>
          </div>
          <DarkModeToggle dark={isDark} onToggle={onToggleDark} />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          {mode === 'choice' && (
            <div className="space-y-4">
              <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                AI-ST Sleep Study Review Assistant
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Sign in to access your cases.
              </p>
              <div className="space-y-2 pt-2">
                <button
                  ref={activateChoiceRef}
                  onClick={() => {
                    setError(null);
                    setMode('activate');
                  }}
                  className="focus-ring w-full rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-4 py-3 text-left text-sm font-medium text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors"
                >
                  Activate with license key
                  <span className="block text-xs font-normal text-teal-700 dark:text-teal-300 mt-0.5">
                    First time? Enter your license key to create an account.
                  </span>
                </button>
                <button
                  ref={loginChoiceRef}
                  onClick={() => {
                    setError(null);
                    setMode('login');
                  }}
                  className="focus-ring w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-left text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Sign in
                  <span className="block text-xs font-normal text-slate-600 dark:text-slate-300 mt-0.5">
                    Already have an account? We'll send a code to your email.
                  </span>
                </button>
              </div>
            </div>
          )}

          {mode === 'activate' && (
            <form
              onSubmit={(e) => {
                void handleActivate(e);
              }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={back}
                  className="inline-flex min-h-6 items-center text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100 text-xs"
                >
                  ← Back
                </button>
                <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Activate account
                </h1>
              </div>
              <div className="space-y-3">
                <div>
                  <label
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
                    htmlFor="act-email"
                  >
                    Email
                  </label>
                  <Input
                    id="act-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus
                    placeholder="clinician@example.org"
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
                    htmlFor="act-key"
                  >
                    License key
                  </label>
                  <FormattedInput
                    id="act-key"
                    name="licenseKey"
                    value={licenseKey}
                    onChange={setLicenseKey}
                    rule={LICENSE_KEY_RULE}
                    required
                    autoComplete="off"
                    placeholder="AIST-XXXX-XXXX-XXXX-XXXX-XXXX"
                    inputClassName="font-mono"
                  />
                </div>
              </div>
              {error && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
              <Button type="submit" loading={loading} className="w-full">
                {loading ? 'Activating…' : 'Activate'}
              </Button>
            </form>
          )}

          {mode === 'login' && (
            <form
              onSubmit={(e) => {
                void handleLogin(e);
              }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={back}
                  className="inline-flex min-h-6 items-center text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100 text-xs"
                >
                  ← Back
                </button>
                <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Sign in
                </h1>
              </div>
              <div>
                <label
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
                  htmlFor="login-email"
                >
                  Email
                </label>
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  placeholder="clinician@example.org"
                />
              </div>
              {error && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
              <Button type="submit" loading={loading} className="w-full">
                {loading ? 'Sending code…' : 'Send sign-in code'}
              </Button>
            </form>
          )}

          {mode === 'verify' && (
            <form
              onSubmit={(e) => {
                void handleVerify(e);
              }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('login');
                  }}
                  className="inline-flex min-h-6 items-center text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100 text-xs"
                >
                  ← Back
                </button>
                <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Enter code
                </h1>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                A 6-digit code was sent to{' '}
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {pendingEmail}
                </span>
                .
              </p>
              <div>
                <label
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
                  htmlFor="otp-code"
                >
                  Code
                </label>
                <Input
                  id="otp-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="000000"
                  className="font-mono tracking-widest"
                />
              </div>
              {error && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
              <Button type="submit" loading={loading} className="w-full">
                {loading ? 'Verifying…' : 'Verify'}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
