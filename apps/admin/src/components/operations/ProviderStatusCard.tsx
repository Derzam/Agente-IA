import React from 'react';
import { Card, CardHeader, CardBody } from '@/components/common/Card';
import { ProviderStatusBadge, UnifiedProviderStatus } from './ProviderStatusBadge';

interface OperationalMetric {
  label: string;
  value: string | number;
}

interface ProviderStatusCardProps {
  title: string;
  subtitle: string;
  status: UnifiedProviderStatus;
  metrics?: OperationalMetric[];
  notice?: string;
  className?: string;
}

export const ProviderStatusCard: React.FC<ProviderStatusCardProps> = ({
  title,
  subtitle,
  status,
  metrics,
  notice,
  className = '',
}) => {
  return (
    <Card className={`overflow-hidden ${className}`}>
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={<ProviderStatusBadge status={status} />}
      />
      <CardBody className="space-y-4 text-xs sm:text-sm">
        {metrics && metrics.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            {metrics.map((m, idx) => (
              <div key={idx} className="space-y-0.5">
                <span className="text-[11px] font-medium text-slate-500 block truncate">{m.label}</span>
                <span className="font-semibold text-slate-900 block font-mono">{m.value}</span>
              </div>
            ))}
          </div>
        )}

        <div className="text-[11px] text-slate-500 leading-relaxed bg-slate-50/70 p-3 rounded-lg border border-slate-100">
          <p>
            {notice ||
              'Estado obtenido exclusivamente a través de los contratos de la API del backend. El navegador nunca realiza llamadas directas al proveedor.'}
          </p>
        </div>
      </CardBody>
    </Card>
  );
};
