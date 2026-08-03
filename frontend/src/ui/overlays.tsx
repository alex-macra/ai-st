import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, ChevronDown, Info, LogOut, User, X } from 'lucide-react';
import { cx } from './utils';

export type PopoverSide = 'top' | 'bottom' | 'left' | 'right';
export type PopoverRole = 'dialog' | 'tooltip';

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  side?: PopoverSide;
  label?: string;
  className?: string;
  openOnHover?: boolean;
  hoverDelayMs?: number;
  role?: PopoverRole;
}

export function Popover({
  trigger,
  children,
  side = 'bottom',
  label = 'Popover',
  className,
  openOnHover = false,
  hoverDelayMs = 300,
  role = 'dialog',
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const panelId = useId();

  const clearTimers = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 8;
    if (side === 'top') setPosition({ top: rect.top - gap, left: rect.left + rect.width / 2 });
    if (side === 'bottom')
      setPosition({ top: rect.bottom + gap, left: rect.left + rect.width / 2 });
    if (side === 'left') setPosition({ top: rect.top + rect.height / 2, left: rect.left - gap });
    if (side === 'right') setPosition({ top: rect.top + rect.height / 2, left: rect.right + gap });
  }, [side]);

  const openNow = useCallback(() => {
    clearTimers();
    updatePosition();
    setOpen(true);
  }, [clearTimers, updatePosition]);

  const closeSoon = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('pointerdown', handlePointer);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('pointerdown', handlePointer);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => clearTimers, [clearTimers]);

  const transform =
    side === 'top'
      ? 'translate(-50%, -100%)'
      : side === 'bottom'
        ? 'translate(-50%, 0)'
        : side === 'left'
          ? 'translate(-100%, -50%)'
          : 'translate(0, -50%)';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={role === 'dialog' ? open : undefined}
        aria-controls={role === 'dialog' && open ? panelId : undefined}
        aria-describedby={role === 'tooltip' && open ? panelId : undefined}
        aria-haspopup={role === 'dialog' ? 'dialog' : undefined}
        onClick={() => {
          clearTimers();
          if (open) setOpen(false);
          else openNow();
        }}
        onFocus={() => {
          if (!openOnHover) return;
          openTimer.current = window.setTimeout(openNow, hoverDelayMs);
        }}
        onBlur={() => {
          if (openOnHover) closeSoon();
        }}
        onMouseEnter={() => {
          if (!openOnHover) return;
          window.clearTimeout(closeTimer.current);
          openTimer.current = window.setTimeout(openNow, hoverDelayMs);
        }}
        onMouseLeave={() => {
          if (openOnHover) closeSoon();
        }}
        className="focus-ring inline-flex rounded"
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role={role}
            aria-label={label}
            onMouseEnter={() => window.clearTimeout(closeTimer.current)}
            onMouseLeave={() => {
              if (openOnHover) closeSoon();
            }}
            style={{ position: 'fixed', top: position.top, left: position.left, transform }}
            className={cx(
              'z-[80] max-w-[calc(100vw-2rem)] rounded-xl border border-ui-border bg-ui-bg-raised p-3 text-ui-text shadow-xl',
              className,
            )}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

type ToastType = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}
interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => undefined });
let nextToastId = 0;

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback(
    (id: number) => setItems((current) => current.filter((item) => item.id !== id)),
    [],
  );
  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++nextToastId;
      setItems((current) => [...current, { id, message, type }]);
      window.setTimeout(() => dismiss(id), 3_500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2"
      >
        {items.map((item) => {
          const Icon =
            item.type === 'success' ? CheckCircle2 : item.type === 'error' ? AlertCircle : Info;
          return (
            <div
              key={item.id}
              role={item.type === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex max-w-xs items-center gap-2 rounded-lg border border-ui-border bg-ui-bg-raised px-3 py-2.5 shadow-lg"
            >
              <Icon
                aria-hidden="true"
                size={14}
                className={cx(
                  'shrink-0',
                  item.type === 'success'
                    ? 'text-green-500'
                    : item.type === 'error'
                      ? 'text-red-500'
                      : 'text-blue-500',
                )}
              />
              <span className="flex-1 text-xs text-ui-text-muted">{item.message}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(item.id)}
                className="focus-ring rounded text-ui-text-subtle hover:text-ui-text"
              >
                <X aria-hidden="true" size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export interface AccountMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  hidden?: boolean;
}

export interface AccountPanelProps {
  label: string;
  description?: string;
  items: AccountMenuItem[];
  onSignOut: () => void;
  signOutLabel?: string;
  ariaLabel?: string;
  testIdPrefix?: string;
  className?: string;
}

export function AccountPanel({
  label,
  description,
  items,
  onSignOut,
  signOutLabel = 'Sign out',
  ariaLabel = 'Account menu',
  testIdPrefix = 'account',
  className,
}: AccountPanelProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const visibleItems = items.filter((item) => !item.hidden);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(),
    );
    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const entries = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (entries.length === 0) return;
    const current = entries.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? entries.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1) % entries.length
            : (current - 1 + entries.length) % entries.length;
    entries[next]?.focus();
  };

  return (
    <div ref={rootRef} className={cx('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        data-testid={`${testIdPrefix}-trigger`}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="focus-ring inline-flex items-center gap-1 rounded-xl p-2 text-ui-text-muted hover:bg-ui-bg-muted hover:text-ui-text"
      >
        <User aria-hidden="true" size={16} />
        <ChevronDown aria-hidden="true" size={13} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={moveFocus}
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-ui-border bg-ui-bg-raised py-1 shadow-xl"
        >
          <div className="border-b border-ui-border px-3 py-2">
            <p className="truncate text-sm font-medium text-ui-text">{label}</p>
            {description && <p className="truncate text-xs text-ui-text-subtle">{description}</p>}
          </div>
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="focus-ring flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ui-text-muted hover:bg-ui-bg-muted hover:text-ui-text"
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="focus-ring flex w-full items-center gap-2 border-t border-ui-border px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            <LogOut aria-hidden="true" size={14} />
            {signOutLabel}
          </button>
        </div>
      )}
    </div>
  );
}
