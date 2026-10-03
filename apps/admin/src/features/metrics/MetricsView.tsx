import React, { useEffect, useState } from 'react';
import {
  Bike,
  Store,
  Bot,
  UserCheck,
} from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/common/Card';
import { metricsService } from '@/services/metricsService';
import { HourlySalesData } from '@/types/viewModels';

export const MetricsView: React.FC = () => {
  const [hourlySales, setHourlySales] = useState<HourlySalesData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    setIsLoading(true);
    try {
      const data = await metricsService.getHourlySales();
      setHourlySales(data);
    } finally {
      setIsLoading(false);
    }
  };

  const maxSales = Math.max(...hourlySales.map((h) => h.totalAmount), 1);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <span className="text-xs text-slate-500 font-semibold">Tasa de Autoservicio IA</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-black text-slate-900">84.2%</span>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
              +4.1% vs ayer
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Pedidos tomados por WhatsApp sin requerir intervención del staff.
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <span className="text-xs text-slate-500 font-semibold">Tiempo Medio en Cocina</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-black text-slate-900">18.4 min</span>
            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              Óptimo
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Desde confirmación por WhatsApp hasta salida del plato.
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <span className="text-xs text-slate-500 font-semibold">Tiempo de Espera en Handoff</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-black text-emerald-700">1.8 min</span>
            <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
              SLA &lt; 3 min
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Respuesta promedio del personal al pedir atención humana.
          </p>
        </div>
      </div>

      {/* Hourly Sales Bar Chart */}
      <Card>
        <CardHeader
          title="Demanda y Ventas por Franja Horaria (Hoy)"
          subtitle="Identificación visual de picos de cocina para balancear personal"
        />
        <CardBody>
          {isLoading ? (
            <div className="h-48 bg-slate-50 rounded-xl animate-pulse" />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-7 gap-2 sm:gap-4 items-end h-52 pt-8 px-2 border-b border-slate-200">
                {hourlySales.map((h) => {
                  const heightPercent = Math.round((h.totalAmount / maxSales) * 100);
                  return (
                    <div key={h.hour} className="flex flex-col items-center gap-2 h-full justify-end group">
                      <span className="text-[10px] font-bold text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity">
                        ${h.totalAmount.toFixed(0)}
                      </span>
                      <div
                        className="w-full max-w-[42px] bg-orange-500 hover:bg-orange-600 rounded-t-lg transition-all"
                        style={{ height: `${heightPercent}%` }}
                      />
                      <span className="text-[11px] font-semibold text-slate-500">{h.hour}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-slate-500 px-2">
                <span>Turno Almuerzo (12:00 - 15:00)</span>
                <span>Turno Cena (19:00 - 23:00)</span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Two cards: Fulfillment Channel & Bot Handoff Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Canal de Entrega" subtitle="Preferencia de clientes de WhatsApp hoy" />
          <CardBody className="space-y-4">
            <div>
              <div className="flex justify-between text-xs font-bold text-slate-800 mb-1">
                <span className="flex items-center gap-1.5">
                  <Bike className="w-4 h-4 text-orange-600" /> Delivery a Domicilio
                </span>
                <span>68% (23 pedidos)</span>
              </div>
              <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                <div className="bg-orange-600 h-full rounded-full" style={{ width: '68%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-bold text-slate-800 mb-1">
                <span className="flex items-center gap-1.5">
                  <Store className="w-4 h-4 text-indigo-600" /> Retiro en Local
                </span>
                <span>32% (11 pedidos)</span>
              </div>
              <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                <div className="bg-indigo-600 h-full rounded-full" style={{ width: '32%' }} />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Resolución de Conversaciones" subtitle="Desempeño de la IA vs Humano" />
          <CardBody className="space-y-4">
            <div>
              <div className="flex justify-between text-xs font-bold text-slate-800 mb-1">
                <span className="flex items-center gap-1.5">
                  <Bot className="w-4 h-4 text-sky-600" /> 100% Automatizado por Bot
                </span>
                <span>84% (42 chats)</span>
              </div>
              <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                <div className="bg-sky-500 h-full rounded-full" style={{ width: '84%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-bold text-slate-800 mb-1">
                <span className="flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-purple-600" /> Intervención Humana (Handoff)
                </span>
                <span>16% (8 chats)</span>
              </div>
              <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                <div className="bg-purple-600 h-full rounded-full" style={{ width: '16%' }} />
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};
