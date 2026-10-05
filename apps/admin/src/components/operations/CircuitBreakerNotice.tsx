import React from 'react';
import { ZapOff } from 'lucide-react';

interface CircuitBreakerNoticeProps {
  message?: string;
  className?: string;
}

export const CircuitBreakerNotice: React.FC<CircuitBreakerNoticeProps> = ({
  message,
  className = '',
}) => {
  return (
    <div
      role="alert"
      className={`p-4 bg-purple-50 border border-purple-300 rounded-xl flex items-start gap-3 text-purple-950 ${className}`}
    >
      <ZapOff className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="space-y-1">
        <h4 className="font-bold text-xs sm:text-sm flex items-center gap-1.5">
          <span>Servicio de IA temporalmente suspendido.</span>
        </h4>
        <p className="text-xs text-purple-800 leading-relaxed">
          {message ||
            'El circuito de protección se encuentra abierto para evitar fallos en cascada o sobreconsumo de cuotas con el proveedor de IA. Las conversaciones deben ser gestionadas por operadores humanos hasta que el circuito se restablezca automáticamente.'}
        </p>
        <p className="text-[11px] text-purple-600 font-medium">
          El panel no realizará reintentos automáticos continuos para respetar la estabilidad del sistema.
        </p>
      </div>
    </div>
  );
};
