// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthView } from '../components/AuthView';
import type { DeploymentConfig } from '../api';
import type { AuthenticatedUser } from '@contracts/types';

vi.mock('../api', () => ({
  activate: vi.fn(),
  demoSignIn: vi.fn(),
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

import { activate, demoSignIn } from '../api';

const activateMock = vi.mocked(activate);
const demoSignInMock = vi.mocked(demoSignIn);

const standardConfig: DeploymentConfig = {
  llmMode: 'openai',
  analysisAvailable: true,
  demoMode: false,
};

const demoConfig: DeploymentConfig = {
  llmMode: 'demo',
  analysisAvailable: true,
  demoMode: true,
};

const authenticatedUser: AuthenticatedUser = {
  id: 'user-1',
  email: 'reviewer@example.test',
  organizationId: null,
  tier: 'starter',
  isAdmin: false,
  tokenBudget: 0,
};

function renderAuth(config: DeploymentConfig, onAuth = vi.fn()) {
  render(<AuthView onAuth={onAuth} isDark={false} onToggleDark={vi.fn()} config={config} />);
  return onAuth;
}

describe('<AuthView />', () => {
  beforeEach(() => {
    activateMock.mockReset();
    demoSignInMock.mockReset();
  });

  it('formats new SOMNO keys and preserves legacy AIST keys in activation', async () => {
    activateMock.mockResolvedValue(authenticatedUser);
    const user = userEvent.setup();
    renderAuth(standardConfig);

    await user.click(screen.getByRole('button', { name: /activate with license key/i }));
    await user.type(screen.getByLabelText('Email'), 'reviewer@example.test');
    const licenseKey = screen.getByLabelText('License key');

    await user.type(licenseKey, 'somnoabcd1234efab5678cdef');
    expect(licenseKey).toHaveValue('SOMNO-ABCD-1234-EFAB-5678-CDEF');

    await user.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() =>
      expect(activateMock).toHaveBeenCalledWith(
        'reviewer@example.test',
        'SOMNO-ABCD-1234-EFAB-5678-CDEF',
      ),
    );

    await user.clear(licenseKey);
    await user.type(licenseKey, 'aist1234abcd5678efab9999');
    expect(licenseKey).toHaveValue('AIST-1234-ABCD-5678-EFAB-9999');
  });

  it('announces a demo sign-in failure from the choice screen', async () => {
    demoSignInMock.mockRejectedValueOnce(
      new Error('Demo sign-in is not enabled on this deployment.'),
    );
    const user = userEvent.setup();
    const onAuth = renderAuth(demoConfig);

    await user.click(screen.getByRole('button', { name: /continue as demo user/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Demo sign-in is not enabled on this deployment.',
    );
    expect(onAuth).not.toHaveBeenCalled();
  });
});
