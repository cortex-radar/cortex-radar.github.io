import React from 'react';
import { cn } from '../../lib/utils';

/**
 * Smoked-Obsidian Panel (.stitch/DESIGN.md Section 2 & 4)
 * Zinc-950/85 glass + 1px directional specular top-edge highlight + whisper border.
 */
export const ObsidianPanel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('cockpit-obsidian rounded-xl text-zinc-100', className)}
    {...props}
  />
));
ObsidianPanel.displayName = 'ObsidianPanel';

/**
 * Tactile Aerospace Instrument Button (shadcn/ui variant pattern, zero neon outer-glow)
 */
interface InstrumentButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'accent' | 'ghost' | 'danger';
  size?: 'xs' | 'sm' | 'icon';
  active?: boolean;
}

export const InstrumentButton = React.forwardRef<HTMLButtonElement, InstrumentButtonProps>(
  ({ className, variant = 'default', size = 'sm', active = false, type = 'button', ...props }, ref) => {
    const variantClasses =
      variant === 'accent' || active
        ? 'bg-teal-500/15 hover:bg-teal-500/22 text-teal-200 border-teal-400/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]'
        : variant === 'danger'
        ? 'bg-rose-500/14 hover:bg-rose-500/22 text-rose-200 border-rose-400/35 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]'
        : variant === 'ghost'
        ? 'bg-transparent hover:bg-zinc-800/70 text-zinc-400 hover:text-zinc-100 border-transparent'
        : 'bg-zinc-900/85 hover:bg-zinc-800/90 text-zinc-200 border-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.07)]';

    const sizeClasses =
      size === 'xs'
        ? 'h-6 px-2 text-[10.5px] rounded-md gap-1'
        : size === 'icon'
        ? 'h-7 w-7 p-0 rounded-md justify-center'
        : 'h-7 px-2.5 text-[11px] rounded-md gap-1.5';

    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center font-mono font-medium border transition-colors duration-100 cursor-pointer select-none',
          'active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400/80 disabled:opacity-45 disabled:pointer-events-none',
          variantClasses,
          sizeClasses,
          className
        )}
        {...props}
      />
    );
  }
);
InstrumentButton.displayName = 'InstrumentButton';

/**
 * Accessible Radix/shadcn-ui Switch (`role="switch"`, `aria-checked`)
 */
interface CockpitSwitchProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

export const CockpitSwitch: React.FC<CockpitSwitchProps> = ({
  checked,
  onCheckedChange,
  disabled,
  label,
  className,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onCheckedChange(!checked)}
    className={cn(
      'relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400/80 disabled:opacity-45 disabled:cursor-not-allowed',
      checked
        ? 'bg-teal-500/30 border-teal-400/55'
        : 'bg-zinc-900 border-white/10',
      className
    )}
  >
    <span
      className={cn(
        'pointer-events-none block h-3.5 w-3.5 rounded-full transition-transform duration-150 ease-out shadow-sm',
        checked ? 'translate-x-[14px] bg-teal-300' : 'translate-x-[2px] bg-zinc-500'
      )}
    />
  </button>
);

/**
 * Accessible shadcn-ui TabsList + TabsTrigger
 */
export const CockpitTabsList: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div
    role="tablist"
    className={cn(
      'cockpit-well inline-grid p-0.5 rounded-lg font-mono text-[11px]',
      className
    )}
    {...props}
  />
);

interface CockpitTabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected: boolean;
}

export const CockpitTabsTrigger: React.FC<CockpitTabsTriggerProps> = ({
  selected,
  className,
  children,
  ...props
}) => (
  <button
    type="button"
    role="tab"
    aria-selected={selected}
    className={cn(
      'px-2.5 py-1 rounded-[6px] font-mono text-[10.5px] font-medium transition-all duration-150 cursor-pointer select-none',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400/80',
      selected
        ? 'bg-zinc-800/95 text-zinc-100 border border-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]'
        : 'text-zinc-400 hover:text-zinc-200 border border-transparent',
      className
    )}
    {...props}
  >
    {children}
  </button>
);

/**
 * Precision Keycap Badge (`?`, `ESC`, `1–5`)
 */
export const Kbd: React.FC<React.HTMLAttributes<HTMLElement>> = ({
  className,
  children,
  ...props
}) => (
  <kbd
    className={cn(
      'inline-flex items-center justify-center h-[18px] min-w-[18px] px-1.5 rounded-[4px]',
      'bg-zinc-900 text-zinc-300 font-mono text-[9.5px] font-medium leading-none tracking-tight tabular-nums',
      'border border-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_0_rgba(0,0,0,0.65)]',
      className
    )}
    {...props}
  >
    {children}
  </kbd>
);
