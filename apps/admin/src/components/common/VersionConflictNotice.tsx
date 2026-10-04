import React from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from './Button';

interface VersionConflictNoticeProps {
  onRefresh: () => void;
  message?: string;
  className?: string;
}

export const VersionConflictNotice: React.FC<VersionConflictNoticeProps> = ({
  onRefresh,
  message = 'El registro cambió. Actualiza la información antes de continuar.',
  className = '',
}) => {
  return (
    <div
      role="alert"
      className={`p-4 bg-amber-50 border border-amber-300 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs sm:text-sm font-semibold text-amber-900">
            Conflicto de concurrencia detectado
          </p>
          <p className="text-xs text-amber-800 mt-0.5">{message}</p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        leftIcon={<RefreshCw className="w-3.5 h-3.5 text-amber-700" />}
        className="shrink-0 bg-white border-amber-300 text-amber-900 hover:bg-amber-100"
      >
        Actualizar datos
      </Button>
    </div>
  );
};
