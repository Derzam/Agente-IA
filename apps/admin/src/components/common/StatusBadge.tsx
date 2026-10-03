import React from 'react';
import { OrderStatus, ConversationStatus, FulfillmentType } from '@/types/viewModels';
import { Badge } from './Badge';
import {
  Clock,
  Flame,
  Bike,
  Store,
  CheckCircle2,
  XCircle,
  Bot,
  AlertTriangle,
  UserCheck,
} from 'lucide-react';

interface OrderStatusBadgeProps {
  status: OrderStatus;
  size?: 'sm' | 'md';
}

export const OrderStatusBadge: React.FC<OrderStatusBadgeProps> = ({ status, size = 'md' }) => {
  switch (status) {
    case 'confirmed':
      return (
        <Badge variant="amber" size={size} className="animate-pulse">
          <Clock className="w-3.5 h-3.5" />
          <span>Nuevo Pedido</span>
        </Badge>
      );
    case 'preparing':
      return (
        <Badge variant="blue" size={size}>
          <Flame className="w-3.5 h-3.5 text-blue-600" />
          <span>En Cocina</span>
        </Badge>
      );
    case 'out_for_delivery':
      return (
        <Badge variant="indigo" size={size}>
          <Bike className="w-3.5 h-3.5 text-indigo-600" />
          <span>En Camino</span>
        </Badge>
      );
    case 'ready':
      return (
        <Badge variant="indigo" size={size}>
          <Store className="w-3.5 h-3.5 text-indigo-600" />
          <span>Listo en Local</span>
        </Badge>
      );
    case 'delivered':
      return (
        <Badge variant="emerald" size={size}>
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>Entregado</span>
        </Badge>
      );
    case 'cancelled':
      return (
        <Badge variant="rose" size={size}>
          <XCircle className="w-3.5 h-3.5 text-rose-600" />
          <span>Cancelado</span>
        </Badge>
      );
    default:
      return <Badge variant="slate" size={size}>{status}</Badge>;
  }
};

interface ConversationStatusBadgeProps {
  status: ConversationStatus;
  size?: 'sm' | 'md';
}

export const ConversationStatusBadge: React.FC<ConversationStatusBadgeProps> = ({ status, size = 'md' }) => {
  switch (status) {
    case 'bot_active':
      return (
        <Badge variant="sky" size={size}>
          <Bot className="w-3.5 h-3.5 text-sky-600" />
          <span>IA Activa</span>
        </Badge>
      );
    case 'human_pending':
      return (
        <Badge variant="rose" size={size} className="animate-pulse font-bold border-rose-300">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
          <span>Esperando Asesor</span>
        </Badge>
      );
    case 'human_active':
      return (
        <Badge variant="purple" size={size}>
          <UserCheck className="w-3.5 h-3.5 text-purple-600" />
          <span>Atendido por Humano</span>
        </Badge>
      );
    case 'closed':
      return (
        <Badge variant="slate" size={size}>
          <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
          <span>Resuelto</span>
        </Badge>
      );
    default:
      return <Badge variant="slate" size={size}>{status}</Badge>;
  }
};

export const FulfillmentBadge: React.FC<{ type: FulfillmentType; size?: 'sm' | 'md' }> = ({ type, size = 'sm' }) => {
  if (type === 'delivery') {
    return (
      <Badge variant="orange" size={size}>
        <Bike className="w-3.5 h-3.5" />
        <span>Delivery</span>
      </Badge>
    );
  }
  return (
    <Badge variant="slate" size={size}>
      <Store className="w-3.5 h-3.5" />
      <span>Retiro en Local</span>
    </Badge>
  );
};
