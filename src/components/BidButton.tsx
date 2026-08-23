'use client';

interface BidButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: React.ReactNode;
}

export default function BidButton({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  children,
  disabled,
  className = '',
  ...props
}: BidButtonProps) {
  const baseStyles =
    'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 ease-in-out min-h-11 will-change-transform ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:hover:text-primary-foreground disabled:hover:shadow-none ' +
    'active:scale-[0.98] active:shadow-none';

  const variantStyles = {
    primary:
      'bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-md hover:-translate-y-px active:bg-primary active:translate-y-0 active:shadow-none shadow-sm',
    secondary:
      'bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-sm active:bg-secondary active:shadow-none',
    outline:
      'bg-transparent border border-border text-foreground hover:bg-muted hover:border-foreground/10 active:bg-muted/50',
  };

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm gap-1.5',
    md: 'px-4 py-2.5 text-sm gap-2',
    lg: 'px-6 py-3 text-base gap-2',
  };

  const finalDisabled = disabled || isLoading;

  return (
    <button
      type="button"
      disabled={finalDisabled}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} rounded-lg ${className}`}
      aria-busy={isLoading}
      aria-disabled={finalDisabled}
      {...props}
    >
      {isLoading && (
        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
