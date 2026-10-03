import React, { useEffect, useState } from 'react';
import {
  Users,
  Search,
  Phone,
  MapPin,
  Star,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Drawer } from '@/components/common/Drawer';
import { EmptyState } from '@/components/common/EmptyState';
import { customerService } from '@/services/customerService';
import { Customer } from '@agente-ia/shared';

interface CustomersViewProps {
  onNavigateToChat?: (customerPhone: string) => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({ onNavigateToChat }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setIsLoading(true);
    try {
      const data = await customerService.getCustomers();
      setCustomers(data);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery)
  );

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header and Search */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
        <div className="relative max-w-md w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre o celular WhatsApp..."
            className="w-full text-xs sm:text-sm pl-9 pr-4 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <p className="text-xs text-slate-500 font-medium text-right">
          Total Clientes Registrados: <span className="font-bold text-slate-900">{customers.length}</span>
        </p>
      </div>

      {/* Customers Table */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 bg-slate-50 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filteredCustomers.length === 0 ? (
        <EmptyState
          icon={<Users className="w-8 h-8 text-slate-400" />}
          title="No se encontraron clientes"
          description="Intente con otro nombre o número telefónico."
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200">
                <tr>
                  <th className="p-4">Cliente</th>
                  <th className="p-4">Celular WhatsApp</th>
                  <th className="p-4">Pedidos Realizados</th>
                  <th className="p-4">Gasto Total (LTV)</th>
                  <th className="p-4">Última Compra</th>
                  <th className="p-4 text-right">Ficha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCustomers.map((cust) => (
                  <tr
                    key={cust.id}
                    onClick={() => setSelectedCustomer(cust)}
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                  >
                    <td className="p-4 font-semibold text-slate-900 flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs">
                        {cust.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <span>{cust.name}</span>
                        {cust.isVip && (
                          <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                            <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                            VIP
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-xs font-mono text-slate-600">{cust.phone}</td>
                    <td className="p-4 font-semibold text-slate-800">{cust.totalOrdersCount} órdenes</td>
                    <td className="p-4 font-bold text-emerald-700">${cust.totalSpent.toFixed(2)}</td>
                    <td className="p-4 text-xs text-slate-500">
                      {cust.lastInteractionAt.slice(0, 10)}
                    </td>
                    <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedCustomer(cust)}>
                        Ver Perfil
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Customer Drawer */}
      <Drawer
        isOpen={!!selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        title={selectedCustomer?.name || 'Ficha de Cliente'}
        subtitle={selectedCustomer?.phone}
        footer={
          selectedCustomer && onNavigateToChat && (
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={() => {
                onNavigateToChat(selectedCustomer.phone);
                setSelectedCustomer(null);
              }}
              leftIcon={<Phone className="w-4 h-4" />}
            >
              Abrir Conversación en WhatsApp
            </Button>
          )
        }
      >
        {selectedCustomer && (
          <div className="space-y-6 text-xs sm:text-sm">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <span className="text-xs text-slate-500">Total Pedidos</span>
                <p className="text-xl font-bold text-slate-900 mt-0.5">
                  {selectedCustomer.totalOrdersCount}
                </p>
              </div>
              <div className="bg-emerald-50/60 p-3.5 rounded-xl border border-emerald-200">
                <span className="text-xs text-emerald-700 font-semibold">Total Consumido</span>
                <p className="text-xl font-bold text-emerald-800 mt-0.5">
                  ${selectedCustomer.totalSpent.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Delivery Address */}
            {selectedCustomer.defaultDeliveryAddress && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                <h5 className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                  <MapPin className="w-4 h-4 text-orange-600" />
                  Dirección Habitual de Entrega
                </h5>
                <p className="text-slate-700 text-xs">
                  {selectedCustomer.defaultDeliveryAddress.street}{' '}
                  {selectedCustomer.defaultDeliveryAddress.number || ''},{' '}
                  {selectedCustomer.defaultDeliveryAddress.apartmentOrFloor || ''}
                </p>
                {selectedCustomer.defaultDeliveryAddress.reference && (
                  <p className="text-slate-500 text-[11px] italic">
                    Ref: {selectedCustomer.defaultDeliveryAddress.reference}
                  </p>
                )}
              </div>
            )}

            {/* Notes */}
            {selectedCustomer.notes && (
              <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 text-amber-900 space-y-1">
                <h5 className="font-bold text-xs">Notas de Servicio & Preferencias:</h5>
                <p className="text-xs leading-relaxed italic">{selectedCustomer.notes}</p>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
};
