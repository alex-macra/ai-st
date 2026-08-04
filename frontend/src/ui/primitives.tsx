// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import {
  forwardRef,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type DragEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, FilePlus2, Info, X } from 'lucide-react';
import { cx } from './utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-ui-accent-solid text-ui-accent-fg hover:bg-ui-accent-solid-hover',
  secondary: 'border border-ui-border bg-ui-bg-muted text-ui-text hover:bg-ui-bg-subtle',
  ghost: 'text-ui-text-muted hover:bg-ui-bg-muted hover:text-ui-text',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 rounded-lg px-3 text-xs',
  md: 'h-9 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-5 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    children,
    className,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'focus-ring inline-flex items-center justify-center font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  );
});

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { error = false, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={error || undefined}
      className={cx(
        'focus-ring w-full rounded-xl border bg-ui-bg-raised px-3 py-2 text-sm text-ui-text placeholder:text-ui-text-subtle disabled:cursor-not-allowed disabled:opacity-50',
        error ? 'border-red-500' : 'border-ui-border hover:border-ui-text-subtle',
        className,
      )}
      {...props}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  autoResize?: boolean;
  maxHeight?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { error = false, autoResize = false, maxHeight, className, style, onInput, value, ...props },
  forwardedRef,
) {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback(() => {
    const element = internalRef.current;
    if (!autoResize || !element) return;
    element.style.height = 'auto';
    const nextHeight = maxHeight ? Math.min(element.scrollHeight, maxHeight) : element.scrollHeight;
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = maxHeight && element.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [autoResize, maxHeight]);

  useLayoutEffect(resize, [resize, value]);

  return (
    <textarea
      ref={(element) => {
        internalRef.current = element;
        if (typeof forwardedRef === 'function') forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      }}
      value={value}
      aria-invalid={error || undefined}
      onInput={(event) => {
        resize();
        onInput?.(event);
      }}
      style={{ ...style, ...(maxHeight ? { maxHeight } : {}) }}
      className={cx(
        'focus-ring w-full resize-y rounded-xl border bg-ui-bg-raised px-3 py-2 text-sm text-ui-text placeholder:text-ui-text-subtle disabled:cursor-not-allowed disabled:opacity-50',
        error ? 'border-red-500' : 'border-ui-border hover:border-ui-text-subtle',
        className,
      )}
      {...props}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { error = false, className, children, ...props },
  ref,
) {
  return (
    <span className="relative inline-block w-full">
      <select
        ref={ref}
        aria-invalid={error || undefined}
        className={cx(
          'focus-ring w-full appearance-none rounded-xl border bg-ui-bg-raised px-3 py-2 pr-9 text-sm text-ui-text disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-red-500' : 'border-ui-border hover:border-ui-text-subtle',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        size={14}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ui-text-subtle"
      />
    </span>
  );
});

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const badgeVariants: Record<BadgeVariant, string> = {
  default: 'border-ui-border bg-ui-bg-muted text-ui-text-muted',
  accent: 'border-ui-accent/20 bg-ui-accent/10 text-ui-accent',
  success:
    'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
  danger:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300',
  info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300',
};

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        badgeVariants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md bg-ui-bg-muted px-2 py-0.5 text-xs text-ui-text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

export type AlertVariant = 'info' | 'success' | 'warning' | 'caution' | 'danger';

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const alertStyles: Record<AlertVariant, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200',
  success:
    'border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-200',
  warning:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200',
  caution:
    'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-200',
  danger:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200',
};

export function Alert({ variant = 'info', title, children, onDismiss, className }: AlertProps) {
  const Icon = variant === 'success' ? CheckCircle2 : variant === 'info' ? Info : AlertCircle;
  return (
    <div
      role="alert"
      className={cx('flex gap-3 rounded-xl border p-4 text-sm', alertStyles[variant], className)}
    >
      <Icon aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="mb-1 font-semibold">{title}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="focus-ring shrink-0 rounded opacity-60 hover:opacity-100"
        >
          <X aria-hidden="true" size={14} />
        </button>
      )}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx('flex flex-col items-center justify-center gap-3 py-16 text-center', className)}
    >
      {icon && (
        <div aria-hidden="true" className="mb-1 text-ui-text-subtle opacity-40">
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm font-semibold text-ui-text">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-xs text-sm text-ui-text-muted">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  name: string;
  label?: string;
  orientation?: 'vertical' | 'horizontal';
  error?: string;
  className?: string;
}

export function RadioGroup({
  options,
  value,
  onChange,
  name,
  label,
  orientation = 'vertical',
  error,
  className,
}: RadioGroupProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label ?? name}
      aria-describedby={error ? `${name}-error` : undefined}
      className={className}
    >
      <div
        className={cx('flex gap-3', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap')}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cx(
              'inline-flex cursor-pointer items-center gap-2.5 text-sm',
              option.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <input
              type="radio"
              className="h-4 w-4 accent-teal-600 focus:ring-teal-500"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${name}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export type ProgressTone = 'default' | 'warning' | 'danger';

export interface ProgressProps {
  value?: number;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
  tone?: ProgressTone;
}

export function progressToneFromPercent(percent: number): ProgressTone {
  if (percent >= 95) return 'danger';
  if (percent >= 80) return 'warning';
  return 'default';
}

export function Progress({
  value,
  size = 'md',
  label = 'Progress',
  className,
  tone = 'default',
}: ProgressProps) {
  const indeterminate = value === undefined;
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  const fill =
    tone === 'danger' ? 'bg-red-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-ui-accent';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-valuetext={indeterminate ? 'Loading' : undefined}
      className={cx(
        'w-full overflow-hidden rounded-full bg-ui-bg-subtle',
        size === 'sm' ? 'h-1' : 'h-2',
        className,
      )}
    >
      <div
        className={cx(
          'h-full rounded-full transition-[width]',
          fill,
          indeterminate && 'w-1/3 animate-pulse',
        )}
        style={indeterminate ? undefined : { width: `${clamped}%` }}
      />
    </div>
  );
}

export type FormatRule =
  | {
      kind: 'group';
      groupSize: number;
      separator: string;
      totalChars: number;
      uppercase?: boolean;
      charset?: RegExp;
    }
  | {
      kind: 'custom';
      format: (raw: string) => string;
    };

export interface FormattedInputProps extends Omit<InputProps, 'onChange' | 'value' | 'type'> {
  value: string;
  onChange: (formatted: string) => void;
  rule: FormatRule;
  label?: ReactNode;
  inputClassName?: string;
}

export function applyFormat(raw: string, rule: FormatRule): string {
  if (rule.kind === 'custom') return rule.format(raw);
  const allowed = rule.charset ?? /[A-Z0-9]/i;
  const characters = Array.from(raw)
    .filter((character) => allowed.test(character))
    .map((character) => (rule.uppercase === false ? character : character.toUpperCase()))
    .join('')
    .slice(0, rule.totalChars);
  const groups: string[] = [];
  for (let index = 0; index < characters.length; index += rule.groupSize) {
    groups.push(characters.slice(index, index + rule.groupSize));
  }
  return groups.join(rule.separator);
}

export const LICENSE_KEY_RULE: FormatRule = {
  kind: 'group',
  groupSize: 4,
  separator: '-',
  totalChars: 24,
  uppercase: true,
};

export const FormattedInput = forwardRef<HTMLInputElement, FormattedInputProps>(
  function FormattedInput({ value, onChange, rule, label, inputClassName, id, ...props }, ref) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
      <div>
        {label && (
          <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-ui-text-muted">
            {label}
          </label>
        )}
        <Input
          {...props}
          ref={ref}
          id={inputId}
          value={value}
          onChange={(event) => onChange(applyFormat(event.target.value, rule))}
          className={inputClassName}
        />
      </div>
    );
  },
);

export interface FileDropZoneProps {
  files?: File[];
  onSelect: (files: File[]) => void;
  onClear?: (index?: number) => void;
  accept?: string;
  multiple?: boolean;
  label?: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function FileDropZone({
  files = [],
  onSelect,
  onClear,
  accept,
  multiple = false,
  label = 'Drop a file here',
  description = 'Click to browse or drag and drop',
  icon,
  disabled = false,
  className,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFiles = (next: FileList | File[] | null) => {
    const selected = next ? Array.from(next) : [];
    if (selected.length > 0) onSelect(selected);
    if (inputRef.current) inputRef.current.value = '';
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!disabled) handleFiles(event.dataTransfer.files);
  };
  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      className={cx(
        'rounded-xl border border-dashed border-ui-border bg-ui-bg-raised p-3',
        className,
      )}
    >
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={`Choose ${label}`}
        onChange={(event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files)}
      />
      {files.length === 0 ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="focus-ring flex w-full items-center gap-3 rounded-lg p-2 text-left disabled:opacity-50"
        >
          <span aria-hidden="true">
            {icon ?? <FilePlus2 size={20} className="text-ui-text-subtle" />}
          </span>
          <span>
            <span className="block text-sm font-medium text-ui-text">{label}</span>
            <span className="block text-xs text-ui-text-subtle">{description}</span>
          </span>
        </button>
      ) : (
        <ul className="space-y-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-2 rounded-lg bg-ui-bg-muted px-3 py-2 text-sm"
            >
              <CheckCircle2 aria-hidden="true" size={15} className="shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1 truncate text-ui-text">{file.name}</span>
              {onClear && (
                <button
                  type="button"
                  onClick={() => onClear(multiple ? index : undefined)}
                  aria-label={`Remove ${file.name}`}
                  className="focus-ring rounded p-1 text-ui-text-subtle hover:text-red-600"
                >
                  <X aria-hidden="true" size={14} />
                </button>
              )}
            </li>
          ))}
          <li>
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className="focus-ring rounded px-2 py-1 text-xs text-ui-accent hover:underline disabled:opacity-50"
            >
              {multiple ? 'Add more files' : 'Replace file'}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
