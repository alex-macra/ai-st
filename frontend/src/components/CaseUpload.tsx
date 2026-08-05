// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { Upload, FileText, Image, ChevronDown, ChevronUp, Paperclip } from 'lucide-react';
import {
  useToast,
  Button,
  RadioGroup,
  Progress,
  Alert,
  FileDropZone,
  type RadioOption,
} from '../ui';
import { uploadCase, type DeploymentConfig } from '../api';
import { DemoPanel } from './DemoPanel';

interface Props {
  onUploaded: (caseId: string) => void;
  config: DeploymentConfig | null;
  /** The generated recording endpoint is intentionally limited to this principal. */
  isDemoUser?: boolean;
}

type Cohort = 'adult' | 'pediatric';

const COHORT_OPTIONS: RadioOption[] = [
  { value: 'pediatric', label: 'Pediatric' },
  { value: 'adult', label: 'Adult' },
];

const UPLOAD_STEPS = [
  'Sending files to server…',
  'Running signal quality checks…',
  'Detecting candidate events…',
  'Building case package…',
];

export function CaseUpload({ onUploaded, config, isDemoUser = false }: Props) {
  const [edf, setEdf] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [cohort, setCohort] = useState<Cohort>('pediatric');
  const [uploading, setUploading] = useState(false);
  const [uploadStepIdx, setUploadStepIdx] = useState(0);
  const [showOptional, setShowOptional] = useState(false);
  const { toast } = useToast();

  const optionalFileCount = (pdf ? 1 : 0) + screenshots.length;

  const hasAnyFile = edf !== null || pdf !== null || screenshots.length > 0;

  // Advances the progress caption while an upload runs. The reset to step 0
  // belongs to handleSubmit, which is what starts an upload -- doing it here
  // would set state synchronously on every render where uploading is false.
  useEffect(() => {
    if (!uploading) return;
    const id = setInterval(() => {
      setUploadStepIdx((i) => Math.min(i + 1, UPLOAD_STEPS.length - 1));
    }, 2500);
    return () => clearInterval(id);
  }, [uploading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasAnyFile) return;
    setUploadStepIdx(0);
    setUploading(true);
    try {
      const result = await uploadCase(
        edf,
        pdf ?? undefined,
        screenshots.length > 0 ? screenshots : undefined,
        cohort,
      );
      onUploaded(result.caseId);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }

  function handleDemoStudy(file: File) {
    setEdf(file);
    // The generated recording has adult breathing parameters, so the adult
    // reference set is the one that applies to it.
    setCohort('adult');
    toast('Demo study loaded — press Upload & Process to run it', 'success');
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {config?.demoMode && isDemoUser && (
        <DemoPanel config={config} onLoadStudy={handleDemoStudy} />
      )}

      {config && !config.analysisAvailable && (
        <Alert variant="warning" title="Analysis is not configured">
          Upload and preprocessing work, so you can see signal quality, detected events, and the
          evidence package. Drafting a report needs a model: set <code>OPENAI_API_KEY</code>, or set{' '}
          <code>SOMNOSCRIBE_DEMO_MODE=true</code> to run the offline demo model.
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="card p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Upload Sleep Study</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Upload an EDF recording to begin. PDF report and screenshots are optional.
          </p>
        </div>

        <fieldset className="space-y-3">
          <legend className="section-label">Patient Cohort</legend>
          <RadioGroup
            name="cohort"
            value={cohort}
            onChange={(v) => setCohort(v as Cohort)}
            orientation="horizontal"
            options={COHORT_OPTIONS}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            This determines which reference data is used for analysis.
          </p>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="section-label">Study Files</legend>
          <div className="grid grid-cols-1 gap-3">
            <FileDropZone
              icon={<FileText size={20} className="text-slate-400" />}
              label="EDF Recording"
              accept=".edf"
              files={edf ? [edf] : []}
              onSelect={(files) => {
                const f = files[0];
                if (f) setEdf(f);
              }}
              onClear={() => setEdf(null)}
            />

            <button
              type="button"
              onClick={() => setShowOptional((v) => !v)}
              className="focus-ring flex min-h-6 items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors self-start"
              aria-expanded={showOptional}
            >
              <Paperclip size={14} />
              {showOptional ? 'Hide supporting files' : 'Add supporting files (PDF / screenshots)'}
              {!showOptional && optionalFileCount > 0 && (
                <span className="ml-1 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full px-1.5 py-0.5 font-medium">
                  {optionalFileCount}
                </span>
              )}
              {showOptional ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showOptional && (
              <div className="grid grid-cols-1 gap-3 pl-1 border-l-2 border-slate-200 dark:border-slate-700">
                <FileDropZone
                  icon={<FileText size={20} className="text-slate-400" />}
                  label="PDF Report"
                  accept=".pdf"
                  files={pdf ? [pdf] : []}
                  onSelect={(files) => {
                    const f = files[0];
                    if (f) setPdf(f);
                  }}
                  onClear={() => setPdf(null)}
                />

                <FileDropZone
                  icon={<Image size={20} className="text-slate-400" />}
                  label="Screenshots"
                  accept="image/*"
                  multiple
                  files={screenshots}
                  onSelect={(files) => setScreenshots((prev) => [...prev, ...files])}
                  onClear={(idx) => setScreenshots((prev) => prev.filter((_, i) => i !== idx))}
                />
              </div>
            )}
          </div>
        </fieldset>

        {!hasAnyFile && (
          <Alert variant="warning">Select at least one file to enable the upload button.</Alert>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={!hasAnyFile}
          loading={uploading}
          icon={<Upload size={14} />}
        >
          {uploading ? 'Processing…' : 'Upload & Process'}
        </Button>

        {uploading && (
          <div className="space-y-2">
            <Progress
              size="sm"
              value={((uploadStepIdx + 1) / UPLOAD_STEPS.length) * 100}
              label="Upload progress"
            />
            <p className="text-xs text-center text-slate-500 dark:text-slate-400">
              {UPLOAD_STEPS[uploadStepIdx]}
            </p>
          </div>
        )}
      </form>
    </div>
  );
}
