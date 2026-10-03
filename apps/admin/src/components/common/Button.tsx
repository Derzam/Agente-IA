import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses =
    'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';

  const sizeClasses = {
    sm: 'text-xs px-3 py-1.5 min-h-[36px] gap-1.5',
    md: 'text-sm px-4 py-2 min-h-[44px] gap-2',
    lg: 'text-base px-6 py-2.5 min-h-[48px] gap-2.5 font-semibold',
  };

  const variantClasses = {
    primary: 'bg-orange-600 hover:bg-orange-700 text-white focus-visible:ring-orange-500 shadow-sm',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-800 focus-visible:ring-slate-400',
    outline: 'border border-slate-300 hover:bg-slate-50 text-slate-700 focus-visible:ring-orange-500 bg-white',
    ghost: 'hover:bg-slate-100 text-slate-700 focus-visible:ring-slate-400',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white focus-visible:ring-rose-500 shadow-sm',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white focus-visible:ring-emerald-500 shadow-sm',
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <svg className="animate-spin h-4 w-4 text-current" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        leftIcon
      )}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
};
