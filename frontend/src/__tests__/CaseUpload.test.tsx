import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../ui';
import { CaseUpload } from '../components/CaseUpload';

function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  return rtlRender(<ToastProvider>{ui}</ToastProvider>, options);
}

vi.mock('../api', () => ({
  uploadCase: vi.fn()
}));

import { uploadCase } from '../api';

const uploadCaseMock = uploadCase as unknown as ReturnType<typeof vi.fn>;

function makeFile(name: string, content = 'x'): File {
  // Pick a MIME type that matches the input's `accept` attribute so user-event
  // doesn't filter the file out: image/* for screenshots, otherwise generic.
  const type = name.endsWith('.png') || name.endsWith('.jpg') ? 'image/png' : 'application/octet-stream';
  return new File([content], name, { type });
}

function getEdfInput(): HTMLInputElement {
  return document.querySelector('input[accept=".edf"]') as HTMLInputElement;
}
function getPdfInput(): HTMLInputElement {
  return document.querySelector('input[accept=".pdf"]') as HTMLInputElement;
}
function getScreenshotsInput(): HTMLInputElement {
  return document.querySelector('input[accept="image/*"]') as HTMLInputElement;
}

async function expandOptional(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /add supporting files/i }));
}

describe('<CaseUpload />', () => {
  beforeEach(() => {
    uploadCaseMock.mockReset();
  });

  it('disables submit and shows hint when no files are picked', () => {
    render(<CaseUpload onUploaded={vi.fn()} />);
    const submit = screen.getByRole('button', { name: /upload & process/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/select at least one file to enable/i)).toBeInTheDocument();
  });

  it('enables submit once an EDF is selected', async () => {
    const user = userEvent.setup();
    render(<CaseUpload onUploaded={vi.fn()} />);
    await user.upload(getEdfInput(), makeFile('study.edf'));
    expect(screen.getByRole('button', { name: /upload & process/i })).toBeEnabled();
    expect(screen.queryByText(/pick at least one file/i)).not.toBeInTheDocument();
  });

  it('enables submit when only screenshots are picked (EDF optional)', async () => {
    const user = userEvent.setup();
    render(<CaseUpload onUploaded={vi.fn()} />);
    await expandOptional(user);
    await user.upload(getScreenshotsInput(), [makeFile('a.png'), makeFile('b.png')]);
    expect(screen.getByRole('button', { name: /upload & process/i })).toBeEnabled();
    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
  });

  it('removes a single screenshot without dropping the others', async () => {
    const user = userEvent.setup();
    render(<CaseUpload onUploaded={vi.fn()} />);
    await expandOptional(user);
    await user.upload(getScreenshotsInput(), [makeFile('a.png'), makeFile('b.png'), makeFile('c.png')]);

    const removeBtn = screen.getByLabelText('Remove b.png');
    await user.click(removeBtn);

    expect(screen.queryByText('b.png')).not.toBeInTheDocument();
    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('c.png')).toBeInTheDocument();
  });

  it('removing the only file disables submit and re-shows the hint', async () => {
    const user = userEvent.setup();
    render(<CaseUpload onUploaded={vi.fn()} />);
    await user.upload(getEdfInput(), makeFile('study.edf'));
    expect(screen.getByRole('button', { name: /upload & process/i })).toBeEnabled();

    // The dropzone shows the EDF name + an X button after selection.
    const removeBtn = screen.getByText('study.edf').parentElement?.querySelector('button') as HTMLButtonElement;
    await user.click(removeBtn);

    expect(screen.getByRole('button', { name: /upload & process/i })).toBeDisabled();
    expect(screen.getByText(/select at least one file to enable/i)).toBeInTheDocument();
  });

  it('calls onUploaded with the new caseId on success', async () => {
    uploadCaseMock.mockResolvedValueOnce({ caseId: 'case-123', studyHash: 'h', name: 'n' });
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    render(<CaseUpload onUploaded={onUploaded} />);
    await user.upload(getEdfInput(), makeFile('study.edf'));
    await user.click(screen.getByRole('button', { name: /upload & process/i }));

    expect(uploadCaseMock).toHaveBeenCalledTimes(1);
    expect(onUploaded).toHaveBeenCalledWith('case-123');
  });

  it('renders the API error message when upload fails', async () => {
    uploadCaseMock.mockRejectedValueOnce(new Error('Preprocessor unreachable'));
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    render(<CaseUpload onUploaded={onUploaded} />);
    await user.upload(getEdfInput(), makeFile('study.edf'));
    await user.click(screen.getByRole('button', { name: /upload & process/i }));

    expect(await screen.findByText('Preprocessor unreachable')).toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('sends EDF + PDF + screenshots together when all are picked', async () => {
    uploadCaseMock.mockResolvedValueOnce({ caseId: 'c', studyHash: 'h', name: 'n' });
    const user = userEvent.setup();
    render(<CaseUpload onUploaded={vi.fn()} />);
    await user.upload(getEdfInput(), makeFile('study.edf'));
    await expandOptional(user);
    await user.upload(getPdfInput(), makeFile('report.pdf'));
    await user.upload(getScreenshotsInput(), [makeFile('a.png')]);
    await user.click(screen.getByRole('button', { name: /upload & process/i }));

    expect(uploadCaseMock).toHaveBeenCalledTimes(1);
    const call = uploadCaseMock.mock.calls[0] as [File, File, File[]];
    expect(call[0].name).toBe('study.edf');
    expect(call[1].name).toBe('report.pdf');
    expect(call[2][0]?.name).toBe('a.png');
  });
});
