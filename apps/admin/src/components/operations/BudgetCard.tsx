import React from 'react';
import { Card, CardHeader, CardBody } from '@/components/common/Card';
import { Coins, HelpCircle } from 'lucide-react';
import type { OperationalBudgetSnapshot } from '@/types/viewModels';

interface BudgetCardProps {
  metrics?: OperationalBudgetSnapshot | null;
  className?: string;
}

export const BudgetCard: React.FC<BudgetCardProps> = ({ metrics, className = '' }) => {
  const hasData =
    metrics &&
    (metrics.inputTokens !== undefined ||
      metrics.outputTokens !== undefined ||
      metrics.toolCalls !== undefined ||
      metrics.turns !== undefined ||
      metrics.remainingQuota !== undefined);

  return (
    <Card className={className}>
      <CardHeader
        title="Presupuesto y Consumo de IA"
        subtitle="Métricas operativas del orquestador según telemetría oficial del backend"
        action={
          <span className="p-2 bg-slate-100 rounded-lg text-slate-700" aria-hidden="true">
            <Coins className="w-4 h-4" />
          </span>
        }
      />
      <CardBody className="space-y-4 text-xs sm:text-sm">
        {hasData ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {metrics.inputTokens !== undefined && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="text-[11px] font-medium text-slate-500 block">Tokens de Entrada</span>
                <span className="text-base font-bold text-slate-900 font-mono">
                  {metrics.inputTokens.toLocaleString()}
                </span>
              </div>
            )}
            {metrics.outputTokens !== undefined && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="text-[11px] font-medium text-slate-500 block">Tokens de Salida</span>
                <span className="text-base font-bold text-slate-900 font-mono">
                  {metrics.outputTokens.toLocaleString()}
                </span>
              </div>
            )}
            {metrics.toolCalls !== undefined && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="text-[11px] font-medium text-slate-500 block">Llamadas a Herramientas</span>
                <span className="text-base font-bold text-slate-900 font-mono">
                  {metrics.toolCalls.toLocaleString()}
                </span>
              </div>
            )}
            {metrics.turns !== undefined && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="text-[11px] font-medium text-slate-500 block">Turnos de Conversación</span>
                <span className="text-base font-bold text-slate-900 font-mono">
                  {metrics.turns.toLocaleString()}
                </span>
              </div>
            )}
            {metrics.remainingQuota !== undefined && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="text-[11px] font-medium text-slate-500 block">Cuota Restante</span>
                <span className="text-base font-bold text-slate-900 font-mono">
                  {metrics.remainingQuota.toLocaleString()}
                </span>
              </div>
            )}
            {metrics.limitTokens !== undefined && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <span className="text-[11px] font-medium text-slate-500 block">Límite de Tokens</span>
                <span className="text-base font-bold text-slate-900 font-mono">
                  {metrics.limitTokens.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-2.5 text-slate-600">
            <HelpCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-slate-800">Telemetría de cuotas no publicada por el backend</p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                El backend no ha expuesto aún métricas oficiales de consumo de tokens o presupuesto para este tenant.
                El panel no calcula estimaciones de costos monetarios mediante precios fijos ni simula datos no entregados por el servidor.
              </p>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
};
