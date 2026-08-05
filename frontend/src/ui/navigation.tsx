// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, type ReactNode } from 'react';
import { cx } from './utils';

export interface Tab {
  id: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  children?: ReactNode;
  className?: string;
}

export function Tabs({ tabs, active, onChange, children, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const handleKey = (event: React.KeyboardEvent<HTMLButtonElement>, tab: Tab) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const enabled = tabs.filter((candidate) => !candidate.disabled);
    const current = enabled.findIndex((candidate) => candidate.id === tab.id);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabled.length - 1
          : event.key === 'ArrowRight'
            ? (current + 1) % enabled.length
            : (current - 1 + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    if (!next) return;
    onChange(next.id);
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-tab-id]') ?? [])
      .find((button) => button.dataset['tabId'] === next.id)
      ?.focus();
  };

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        className="flex items-center gap-1 border-b border-ui-border"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-tab-id={tab.id}
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => {
                if (!tab.disabled) onChange(tab.id);
              }}
              onKeyDown={(event) => handleKey(event, tab)}
              className={cx(
                'focus-ring -mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                selected
                  ? 'border-ui-accent text-ui-accent'
                  : 'border-transparent text-ui-text-subtle hover:border-ui-border hover:text-ui-text',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {children && (
        <div id={`panel-${active}`} role="tabpanel" aria-labelledby={`tab-${active}`}>
          {children}
        </div>
      )}
    </div>
  );
}

export type TimelineDotTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface TimelineEvent {
  id: string;
  title: ReactNode;
  timestamp: string | Date;
  actor?: string;
  meta?: ReactNode;
  tone?: TimelineDotTone;
}

export interface TimelineProps {
  events: TimelineEvent[];
  formatTimestamp?: (timestamp: string | Date) => string;
  className?: string;
  emptyLabel?: string;
}

const timelineTone: Record<TimelineDotTone, string> = {
  default: 'bg-ui-border',
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-ui-accent',
};

export function Timeline({
  events,
  formatTimestamp = (timestamp) => new Date(timestamp).toLocaleString(),
  className,
  emptyLabel = 'No events yet.',
}: TimelineProps) {
  if (events.length === 0)
    return <p className={cx('text-xs text-ui-text-subtle', className)}>{emptyLabel}</p>;
  return (
    <ol className={cx('relative ml-1 space-y-4 border-l border-ui-border pl-4', className)}>
      {events.map((event) => (
        <li key={event.id} className="relative text-xs">
          <span
            aria-hidden="true"
            className={cx(
              'absolute -left-[1.27rem] mt-0.5 h-2 w-2 rounded-full',
              timelineTone[event.tone ?? 'default'],
            )}
          />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-ui-text">{event.title}</span>
            <time
              className="text-ui-text-subtle"
              dateTime={
                typeof event.timestamp === 'string'
                  ? event.timestamp
                  : event.timestamp.toISOString()
              }
            >
              {formatTimestamp(event.timestamp)}
            </time>
            {event.actor && <span className="text-ui-text-muted">by {event.actor}</span>}
            {event.meta && <div className="mt-0.5 flex flex-wrap gap-1">{event.meta}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
