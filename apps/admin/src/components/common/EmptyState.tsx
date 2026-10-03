import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div className={`flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-xl bg-white border border-dashed border-slate-200 ${className}`}>
      {icon && <div className="p-3.5 rounded-full bg-slate-50 text-slate-400 mb-4">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      <p className="text-xs sm:text-sm text-slate-500 max-w-sm mt-1 mb-5">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
};
