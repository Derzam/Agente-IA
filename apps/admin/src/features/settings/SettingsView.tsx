import React, { useEffect, useState } from 'react';
import {
  Bot,
  Store,
  Bike,
  Save,
  CheckCircle2,
  Plus,
  Trash2,
  Edit2,
  MapPin,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Switch } from '@/components/common/Switch';
import { Card, CardHeader, CardBody } from '@/components/common/Card';
import { Tabs } from '@/components/common/Tabs';
import { Modal } from '@/components/common/Modal';
import { VersionConflictNotice } from '@/components/common/VersionConflictNotice';
import { ApiErrorBanner } from '@/components/common/ApiErrorBanner';
import { BudgetCard } from '@/components/operations';
import { RUNTIME_PRESENTATION } from '@/components/operations/runtimePresentation';
import { settingsService } from '@/services/settingsService';
import { deliveryZoneService } from '@/services/deliveryZoneService';
import { BusinessSettings, DeliveryZone } from '@/types/viewModels';
import { decimalToMinor } from '@/adapters/moneyAdapter';
import { VersionConflictError } from '@/api/types';

export const SettingsView: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'agent' | 'business' | 'delivery'>('business');
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings | null>(null);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [isSavedNotice, setIsSavedNotice] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<Error | null>(null);

  // Delivery Zone Modal State
  const [editingZone, setEditingZone] = useState<DeliveryZone | null>(null);
  const [isZoneModalOpen, setIsZoneModalOpen] = useState(false);
  const [isNewZone, setIsNewZone] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    setConflictError(null);
    setApiError(null);
    try {
      const [biz, zones] = await Promise.all([
        settingsService.getBusinessSettings(),
        deliveryZoneService.getDeliveryZones(),
      ]);
      setBusinessSettings(biz);
      setDeliveryZones(zones);
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
      } else {
        setApiError(err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessSettings) return;
    setConflictError(null);
    setApiError(null);
    try {
      const updated = await settingsService.updateBusinessSettings(businessSettings);
      setBusinessSettings(updated);
      showSavedNotification();
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadSettings();
      } else {
        setApiError(err);
      }
    }
  };

  const showSavedNotification = () => {
    setIsSavedNotice(true);
    setTimeout(() => setIsSavedNotice(false), 3000);
  };

  // ==========================================
  // DELIVERY ZONES ACTIONS
  // ==========================================
  const handleOpenNewZone = () => {
    setEditingZone({
      id: `zone-${Date.now()}`,
      name: '',
      fee: 2.0,
      feeMinor: 200,
      minOrder: 5.0,
      minOrderMinor: 500,
      priority: deliveryZones.length + 1,
      active: true,
      version: 1,
      polygonGeojson: {
        type: 'Polygon',
        coordinates: [
          [
            [-77.035, -12.122],
            [-77.028, -12.12],
            [-77.025, -12.128],
            [-77.033, -12.13],
            [-77.035, -12.122],
          ],
        ],
      },
    });
    setIsNewZone(true);
    setIsZoneModalOpen(true);
  };

  const handleSaveZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingZone) return;
    setConflictError(null);
    setApiError(null);

    try {
      if (isNewZone) {
        const created = await deliveryZoneService.createDeliveryZone({
          name: editingZone.name,
          fee: editingZone.fee,
          feeMinor: decimalToMinor(editingZone.fee),
          minOrder: editingZone.minOrder,
          minOrderMinor: decimalToMinor(editingZone.minOrder),
          priority: editingZone.priority,
          active: editingZone.active,
          polygonGeojson: editingZone.polygonGeojson,
        });
        setDeliveryZones((prev) => [...prev, created].sort((a, b) => a.priority - b.priority));
      } else {
        const updated = await deliveryZoneService.updateDeliveryZone({
          ...editingZone,
          feeMinor: decimalToMinor(editingZone.fee),
          minOrderMinor: decimalToMinor(editingZone.minOrder),
        });
        setDeliveryZones((prev) =>
          prev.map((z) => (z.id === updated.id ? updated : z)).sort((a, b) => a.priority - b.priority)
        );
      }
      setIsZoneModalOpen(false);
      setEditingZone(null);
      showSavedNotification();
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadSettings();
      } else {
        setApiError(err);
      }
    }
  };

  const handleDeleteZone = async (zone: DeliveryZone) => {
    setConflictError(null);
    setApiError(null);
    try {
      await deliveryZoneService.deleteDeliveryZone(zone.id, zone.version || 1);
      setDeliveryZones((prev) => prev.filter((z) => z.id !== zone.id));
      showSavedNotification();
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadSettings();
      } else {
        setApiError(err);
      }
    }
  };

  const handleToggleZoneActive = async (zone: DeliveryZone) => {
    setConflictError(null);
    setApiError(null);
    try {
      const updated = await deliveryZoneService.toggleActive(zone.id, !zone.active, zone.version || 1);
      setDeliveryZones((prev) =>
        prev.map((z) => (z.id === updated.id ? updated : z)).sort((a, b) => a.priority - b.priority)
      );
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadSettings();
      } else {
        setApiError(err);
      }
    }
  };

  if (isLoading || !businessSettings) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-64 bg-white rounded-xl border border-slate-200 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Conflict Notice */}
      {conflictError && (
        <VersionConflictNotice
          message={conflictError}
          onRefresh={loadSettings}
        />
      )}

      {/* API Error Banner */}
      {apiError && (
        <ApiErrorBanner
          error={apiError}
          onRetry={loadSettings}
        />
      )}

      {/* Sub Tabs */}
      <Tabs
        tabs={[
          { id: 'business', label: 'Configuración & Horarios', icon: <Store className="w-4 h-4 text-orange-600" /> },
          { id: 'delivery', label: 'Zonas de Entrega', icon: <Bike className="w-4 h-4 text-indigo-600" /> },
          { id: 'agent', label: 'Asistente IA WhatsApp', icon: <Bot className="w-4 h-4 text-sky-600" /> },
        ]}
        activeTab={activeSubTab}
        onChange={(tabId) => setActiveSubTab(tabId as any)}
      />

      {isSavedNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-800 text-xs font-bold flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          Configuración guardada correctamente en el sistema.
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 1: BUSINESS & HOURS                   */}
      {/* ========================================== */}
      {activeSubTab === 'business' && (
        <Card className="max-w-4xl">
          <CardHeader
            title="Configuración General del Negocio"
            subtitle="Reglas operativas, canales de atención y horarios oficiales para pedidos"
          />
          <CardBody>
            <form onSubmit={handleSaveBusiness} className="space-y-6 text-xs sm:text-sm">
              {/* Canonical Channel & Operational Switches */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <Switch
                  checked={businessSettings.isAcceptingOrders}
                  onChange={(checked) =>
                    setBusinessSettings({ ...businessSettings, isAcceptingOrders: checked })
                  }
                  label="Recepción de Pedidos Abierta (Master)"
                  description="Si se desactiva, el negocio cierra temporalmente para nuevos pedidos."
                  size="md"
                />

                <Switch
                  checked={businessSettings.aiEnabled}
                  onChange={(checked) =>
                    setBusinessSettings({ ...businessSettings, aiEnabled: checked })
                  }
                  label="Automatización de IA permitida por el negocio"
                  description="Autorización comercial del negocio para atender pedidos vía IA. La disponibilidad técnica de OpenAI y el worker se supervisa de forma independiente."
                  size="md"
                />

                <Switch
                  checked={businessSettings.deliveryEnabled}
                  onChange={(checked) =>
                    setBusinessSettings({ ...businessSettings, deliveryEnabled: checked })
                  }
                  label="Servicio a Domicilio (Delivery)"
                  description="Habilita la opción de entrega a domicilio para clientes."
                  size="sm"
                />

                <Switch
                  checked={businessSettings.pickupEnabled}
                  onChange={(checked) =>
                    setBusinessSettings({ ...businessSettings, pickupEnabled: checked })
                  }
                  label="Retiro en Tienda (Pickup)"
                  description="Habilita que los clientes recojan sus pedidos en el local."
                  size="sm"
                />
              </div>

              {/* Order Parameters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Pedido Mínimo ($ USD):
                  </label>
                  <input
                    type="number"
                    step="0.50"
                    min="0"
                    value={businessSettings.minOrder}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setBusinessSettings({
                        ...businessSettings,
                        minOrder: val,
                        minOrderMinor: decimalToMinor(val),
                      });
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Valor canónico: {businessSettings.minOrderMinor} minor units (centavos).
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    TTL de Sesión de Chat (minutos):
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="1440"
                    value={businessSettings.sessionTtlMinutes}
                    onChange={(e) =>
                      setBusinessSettings({
                        ...businessSettings,
                        sessionTtlMinutes: parseInt(e.target.value, 10) || 60,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Tiempo de inactividad antes de expirar una conversación de WhatsApp.
                  </p>
                </div>
              </div>

              {/* Explicit tax policy */}
              <div className="p-4 border border-slate-200 rounded-xl bg-white space-y-3">
                <div>
                  <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">
                    Política fiscal
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Debe configurarse explícitamente. El sistema no infiere IVA ni otra tasa por país.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Tratamiento del impuesto
                    </label>
                    <select
                      value={businessSettings.taxPolicy?.mode || 'unconfigured'}
                      onChange={(e) => {
                        const mode = e.target.value;
                        setBusinessSettings({
                          ...businessSettings,
                          taxPolicy:
                            mode === 'unconfigured'
                              ? null
                              : mode === 'none'
                              ? { mode: 'none', rateBps: 0, rounding: 'per_line_half_up' }
                              : {
                                  mode: 'exclusive',
                                  rateBps:
                                    businessSettings.taxPolicy?.mode === 'exclusive'
                                      ? businessSettings.taxPolicy.rateBps
                                      : 0,
                                  rounding: 'per_line_half_up',
                                },
                        });
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    >
                      <option value="unconfigured">Sin configurar</option>
                      <option value="none">Sin impuesto (0%)</option>
                      <option value="exclusive">Tasa explícita</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Tasa (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      disabled={businessSettings.taxPolicy?.mode !== 'exclusive'}
                      value={
                        businessSettings.taxPolicy?.mode === 'exclusive'
                          ? businessSettings.taxPolicy.rateBps / 100
                          : 0
                      }
                      onChange={(e) => {
                        const percent = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                        setBusinessSettings({
                          ...businessSettings,
                          taxPolicy: {
                            mode: 'exclusive',
                            rateBps: Math.round(percent * 100),
                            rounding: 'per_line_half_up',
                          },
                        });
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg disabled:bg-slate-100 disabled:text-slate-400 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Se guarda como puntos base y el cálculo lo realiza exclusivamente el backend.
                    </p>
                  </div>
                </div>

                {businessSettings.taxPolicy == null ? (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    ⚠️ <strong>Política fiscal sin configurar:</strong> Las cotizaciones permanecerán bloqueadas por el backend hasta definir una política fiscal explícita.
                  </div>
                ) : businessSettings.taxPolicy.mode === 'none' ? (
                  <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    Política activa: sin impuesto (0%).
                  </div>
                ) : (
                  <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3">
                    Política activa: tasa explícita de {(businessSettings.taxPolicy.rateBps / 100).toFixed(2)}%.
                  </div>
                )}
              </div>

              {/* Hours Matrix */}
              <div>
                <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider mb-3">
                  Horario de Atención Semanal
                </h4>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                  {businessSettings.hours.map((h, idx) => (
                    <div key={h.dayOfWeek} className="p-3 flex items-center justify-between gap-4">
                      <div className="w-24 font-bold text-slate-800 text-xs">{h.dayName}</div>
                      <Switch
                        checked={h.isOpen}
                        onChange={(open) => {
                          const updatedHours = [...businessSettings.hours];
                          updatedHours[idx].isOpen = open;
                          setBusinessSettings({ ...businessSettings, hours: updatedHours });
                        }}
                        label={h.isOpen ? 'Abierto' : 'Cerrado'}
                        size="sm"
                      />
                      {h.isOpen ? (
                        <div className="flex items-center gap-2 text-xs">
                          <input
                            type="time"
                            value={h.openTime}
                            onChange={(e) => {
                              const updatedHours = [...businessSettings.hours];
                              updatedHours[idx].openTime = e.target.value;
                              setBusinessSettings({ ...businessSettings, hours: updatedHours });
                            }}
                            className="px-2 py-1 border border-slate-200 rounded bg-white"
                          />
                          <span>a</span>
                          <input
                            type="time"
                            value={h.closeTime}
                            onChange={(e) => {
                              const updatedHours = [...businessSettings.hours];
                              updatedHours[idx].closeTime = e.target.value;
                              setBusinessSettings({ ...businessSettings, hours: updatedHours });
                            }}
                            className="px-2 py-1 border border-slate-200 rounded bg-white"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No disponible para pedidos</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
                <span className="text-xs text-slate-400">
                  Versión actual: {businessSettings.version ?? 1}
                </span>
                <Button variant="primary" size="md" type="submit" leftIcon={<Save className="w-4 h-4" />}>
                  Guardar Configuración
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* ========================================== */}
      {/* TAB 2: DELIVERY ZONES                     */}
      {/* ========================================== */}
      {activeSubTab === 'delivery' && (
        <div className="space-y-6 max-w-5xl">
          <Card>
            <CardHeader
              title="Zonas de Entrega & Tarifas Oficiales"
              subtitle="Administración de polígonos GeoJSON, tarifas por zona y prioridades de cobertura"
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleOpenNewZone}
                  leftIcon={<Plus className="w-4 h-4" />}
                >
                  Nueva Zona de Entrega
                </Button>
              }
            />
            <CardBody>
              {deliveryZones.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                  <MapPin className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                  <p className="font-bold text-sm text-slate-600">No hay zonas de entrega configuradas</p>
                  <p className="mt-1">Agregue zonas con tarifas y pedidos mínimos para calcular el costo de envío.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {deliveryZones.map((zone) => (
                    <div
                      key={zone.id}
                      className="p-4 bg-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs hover:bg-slate-50 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                            Prioridad: {zone.priority}
                          </span>
                          <h4 className="font-bold text-slate-900 text-sm">{zone.name}</h4>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              zone.active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {zone.active ? 'Activa' : 'Inactiva'}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 text-slate-500 pt-1">
                          <span>
                            Tarifa de Envío: <strong className="text-slate-800">${zone.fee.toFixed(2)}</strong> ({zone.feeMinor} minor)
                          </span>
                          <span>
                            Pedido Mínimo: <strong className="text-slate-800">${zone.minOrder.toFixed(2)}</strong> ({zone.minOrderMinor} minor)
                          </span>
                        </div>

                        {zone.polygonGeojson && (
                          <div className="pt-1 text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                            <span className="font-semibold text-slate-500">GeoJSON:</span>
                            <span>{zone.polygonGeojson.coordinates[0]?.length || 0} vértices poligonales registrados</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Switch
                          checked={zone.active}
                          onChange={() => handleToggleZoneActive(zone)}
                          size="sm"
                        />

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingZone({ ...zone });
                            setIsNewZone(false);
                            setIsZoneModalOpen(true);
                          }}
                          leftIcon={<Edit2 className="w-3.5 h-3.5 text-slate-500" />}
                        >
                          Editar
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteZone(zone)}
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 3: AI & WHATSAPP INFRASTRUCTURE STATUS */}
      {/* ========================================== */}
      {activeSubTab === 'agent' && (
        <div className="max-w-4xl space-y-6">
          <div className="p-4 bg-sky-50 border border-sky-200 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-sky-900 font-bold text-sm">
              <Bot className="w-5 h-5 text-sky-600" />
              <span>Autorización del Negocio: {businessSettings?.aiEnabled ? 'Permitida' : 'Deshabilitada'}</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              La propiedad <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-900 font-mono">ai_enabled</code> representa
              exclusivamente la autorización comercial del negocio, no la disponibilidad técnica de OpenAI o Meta.
              El runtime se supervisa de manera independiente mediante los contratos del backend.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader
                title="OpenAI Responses API"
                subtitle="Estado operativo no publicado por la API administrativa"
              />
              <CardBody className="space-y-2 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Sin estado de runtime verificable desde el panel</p>
                <p>
                  {RUNTIME_PRESENTATION.openai.detail}
                </p>
                <p className="text-[11px] text-slate-500">
                  El panel no infiere configuración ni disponibilidad a partir de <code>ai_enabled</code>.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Meta WhatsApp Cloud API"
                subtitle="Estado operativo no publicado por la API administrativa"
              />
              <CardBody className="space-y-2 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Sandbox externo aún no verificado desde el panel</p>
                <p>
                  {RUNTIME_PRESENTATION.meta.detail}
                </p>
                <p className="text-[11px] text-slate-500">
                  Los estados de entrega de mensajes sí se muestran cuando el backend los persiste en cada mensaje.
                </p>
              </CardBody>
            </Card>
          </div>

          <BudgetCard />

          <div className="p-3.5 bg-slate-100 rounded-xl border border-slate-200 text-slate-600 text-xs">
            <strong>Gobernanza de Seguridad:</strong> Este panel nunca solicita ni almacena API keys de OpenAI, tokens de Meta WhatsApp, prompts completos del sistema ni instrucciones privadas.
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* DELIVERY ZONE MODAL                        */}
      {/* ========================================== */}
      <Modal
        isOpen={isZoneModalOpen}
        onClose={() => setIsZoneModalOpen(false)}
        title={isNewZone ? 'Crear Nueva Zona de Entrega' : `Editar Zona "${editingZone?.name}"`}
        maxWidth="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsZoneModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveZone}>
              Guardar Zona
            </Button>
          </div>
        }
      >
        {editingZone && (
          <form onSubmit={handleSaveZone} className="space-y-4 text-xs sm:text-sm">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nombre de la Zona:</label>
              <input
                type="text"
                value={editingZone.name}
                onChange={(e) => setEditingZone({ ...editingZone, name: e.target.value })}
                placeholder="ej. Zona Centro, Miraflores, Norte Express..."
                required
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tarifa Envío ($):</label>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  value={editingZone.fee}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setEditingZone({
                      ...editingZone,
                      fee: val,
                      feeMinor: decimalToMinor(val),
                    });
                  }}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Pedido Mín. ($):</label>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  value={editingZone.minOrder}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setEditingZone({
                      ...editingZone,
                      minOrder: val,
                      minOrderMinor: decimalToMinor(val),
                    });
                  }}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Prioridad:</label>
                <input
                  type="number"
                  min="1"
                  value={editingZone.priority}
                  onChange={(e) =>
                    setEditingZone({ ...editingZone, priority: parseInt(e.target.value, 10) || 1 })
                  }
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <Switch
                checked={editingZone.active}
                onChange={(active) => setEditingZone({ ...editingZone, active })}
                label="Zona Activa"
                description="Si se desactiva, los pedidos hacia esta zona serán rechazados."
              />
            </div>

            {/* Structured Coordinates Placeholder */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Polígono de Cobertura (GeoJSON Estructurado):
              </label>
              <textarea
                rows={4}
                value={JSON.stringify(editingZone.polygonGeojson, null, 2)}
                readOnly
                className="w-full px-3 py-2 font-mono text-[11px] bg-slate-50 border border-slate-200 rounded-lg text-slate-600 focus:outline-none"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                El polígono GeoJSON define los límites geográficos exactos validados por el backend en el checkout.
              </p>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
