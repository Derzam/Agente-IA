import React, { useEffect, useState } from 'react';
import {
  Bot,
  Store,
  Bike,
  Sparkles,
  Send,
  Save,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Switch } from '@/components/common/Switch';
import { Card, CardHeader, CardBody } from '@/components/common/Card';
import { Tabs } from '@/components/common/Tabs';
import { settingsService } from '@/services/settingsService';
import { AgentConfig, BusinessSettings, DeliverySettings } from '@/types/viewModels';

export const SettingsView: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'agent' | 'business' | 'delivery'>('agent');
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings | null>(null);
  const [deliverySettings, setDeliverySettings] = useState<DeliverySettings | null>(null);
  const [isSavedNotice, setIsSavedNotice] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Playground state
  const [testInput, setTestInput] = useState('');
  const [testChat, setTestChat] = useState<{ sender: 'user' | 'bot'; text: string; intent?: string }[]>([
    { sender: 'bot', text: '¡Hola! Soy Max en modo de prueba. Escríbeme algo como "Hola", "¿Cuánto cuesta la hamburguesa?" o "Quiero hablar con un humano" para probar mis respuestas.' },
  ]);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const [agent, biz, del] = await Promise.all([
        settingsService.getAgentConfig(),
        settingsService.getBusinessSettings(),
        settingsService.getDeliverySettings(),
      ]);
      setAgentConfig(agent);
      setBusinessSettings(biz);
      setDeliverySettings(del);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentConfig) return;
    await settingsService.updateAgentConfig(agentConfig);
    showSavedNotification();
  };

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessSettings) return;
    await settingsService.updateBusinessSettings(businessSettings);
    showSavedNotification();
  };

  const handleSaveDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliverySettings) return;
    await settingsService.updateDeliverySettings(deliverySettings);
    showSavedNotification();
  };

  const showSavedNotification = () => {
    setIsSavedNotice(true);
    setTimeout(() => setIsSavedNotice(false), 3000);
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testInput.trim()) return;

    const userText = testInput.trim();
    setTestChat((prev) => [...prev, { sender: 'user', text: userText }]);
    setTestInput('');

    const res = await settingsService.testAgentPrompt(userText);
    setTestChat((prev) => [...prev, { sender: 'bot', text: res.reply, intent: res.intent }]);
  };

  if (isLoading || !agentConfig || !businessSettings || !deliverySettings) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-64 bg-white rounded-xl border border-slate-200 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Sub Tabs */}
      <Tabs
        tabs={[
          { id: 'agent', label: 'Asistente IA de WhatsApp', icon: <Bot className="w-4 h-4 text-sky-600" /> },
          { id: 'business', label: 'Datos del Local & Horarios', icon: <Store className="w-4 h-4 text-orange-600" /> },
          { id: 'delivery', label: 'Zonas y Tarifas de Delivery', icon: <Bike className="w-4 h-4 text-indigo-600" /> },
        ]}
        activeTab={activeSubTab}
        onChange={(tabId) => setActiveSubTab(tabId as any)}
      />

      {isSavedNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-800 text-xs font-bold flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          Configuración actualizada y sincronizada con éxito.
        </div>
      )}

      {/* TAB 1: AGENT SETTINGS & PLAYGROUND */}
      {activeSubTab === 'agent' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Agent Configuration Form (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            <Card>
              <CardHeader
                title="Personalidad & Reglas del Asistente Virtual"
                subtitle="Ajusta cómo responde la IA a los clientes de WhatsApp sin tocar código backend"
              />
              <CardBody>
                <form onSubmit={handleSaveAgent} className="space-y-5 text-xs sm:text-sm">
                  {/* Master Switch */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-slate-900">Activar Asistente de IA en WhatsApp</p>
                      <p className="text-xs text-slate-500">
                        Si se apaga, todos los mensajes entrantes requerirán atención humana manual.
                      </p>
                    </div>
                    <Switch
                      checked={agentConfig.isEnabled}
                      onChange={(checked) => setAgentConfig({ ...agentConfig, isEnabled: checked })}
                    />
                  </div>

                  {/* Name and Tone */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Nombre del Asistente:
                      </label>
                      <input
                        type="text"
                        value={agentConfig.assistantName}
                        onChange={(e) =>
                          setAgentConfig({ ...agentConfig, assistantName: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Tono de Voz:</label>
                      <select
                        value={agentConfig.tone}
                        onChange={(e) =>
                          setAgentConfig({ ...agentConfig, tone: e.target.value as any })
                        }
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                      >
                        <option value="friendly_casual">Amigable, cálido y cercano (Recomendado)</option>
                        <option value="formal_polite">Formal, sobrio y educado</option>
                        <option value="energetic_youthful">Enérgico, divertido y juvenil</option>
                      </select>
                    </div>
                  </div>

                  {/* Welcome Greeting */}
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Saludo Inicial de Bienvenida:
                    </label>
                    <textarea
                      rows={2}
                      value={agentConfig.welcomeGreeting}
                      onChange={(e) =>
                        setAgentConfig({ ...agentConfig, welcomeGreeting: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    />
                  </div>

                  {/* Outside Hours Message */}
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Mensaje Fuera de Horario / Local Cerrado:
                    </label>
                    <textarea
                      rows={2}
                      value={agentConfig.outsideHoursMessage}
                      onChange={(e) =>
                        setAgentConfig({ ...agentConfig, outsideHoursMessage: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    />
                  </div>

                  {/* Handoff Message */}
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Mensaje al Transferir a Humano:
                    </label>
                    <textarea
                      rows={2}
                      value={agentConfig.handoffToHumanMessage}
                      onChange={(e) =>
                        setAgentConfig({ ...agentConfig, handoffToHumanMessage: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    />
                  </div>

                  {/* Handoff Keywords */}
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Palabras Clave de Transferencia Inmediata:
                    </label>
                    <input
                      type="text"
                      value={agentConfig.handoffKeywords.join(', ')}
                      onChange={(e) =>
                        setAgentConfig({
                          ...agentConfig,
                          handoffKeywords: e.target.value.split(',').map((s) => s.trim()),
                        })
                      }
                      placeholder="humano, persona, asesor, queja, reclamo"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Separadas por comas. Si un cliente escribe cualquiera de estas palabras, la IA pausará y transferirá.
                    </p>
                  </div>

                  {/* System Directives */}
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Directivas de Venta & Negocio para la IA:
                    </label>
                    <textarea
                      rows={3}
                      value={agentConfig.systemDirectives}
                      onChange={(e) =>
                        setAgentConfig({ ...agentConfig, systemDirectives: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
                    />
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex justify-end">
                    <Button variant="primary" size="md" type="submit" leftIcon={<Save className="w-4 h-4" />}>
                      Guardar Configuración de IA
                    </Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          </div>

          {/* Interactive Playground Simulator (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <Card className="h-full flex flex-col">
              <CardHeader
                title={
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-orange-500" />
                    <span>Simulador de Pruebas</span>
                  </div>
                }
                subtitle="Chatea con el asistente en tiempo real sin enviar WhatsApp"
              />
              <CardBody className="p-3 flex-1 flex flex-col justify-between bg-slate-50">
                {/* Messages Timeline */}
                <div className="space-y-3 overflow-y-auto max-h-[440px] p-2 flex-1">
                  {testChat.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed ${
                          msg.sender === 'user'
                            ? 'bg-orange-600 text-white rounded-tr-xs'
                            : 'bg-white border border-slate-200 text-slate-800 rounded-tl-xs shadow-2xs'
                        }`}
                      >
                        <p>{msg.text}</p>
                      </div>
                      {msg.intent && (
                        <span className="text-[10px] text-slate-400 mt-1 px-1">
                          Intención: <code className="bg-slate-200/80 px-1 py-0.5 rounded text-slate-700">{msg.intent}</code>
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Input for testing */}
                <form onSubmit={handleSendTestMessage} className="mt-3 pt-3 border-t border-slate-200 flex gap-2">
                  <input
                    type="text"
                    value={testInput}
                    onChange={(e) => setTestInput(e.target.value)}
                    placeholder="Escribe un mensaje de prueba..."
                    className="flex-1 text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <Button type="submit" variant="primary" size="sm" disabled={!testInput.trim()}>
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </form>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: BUSINESS & HOURS */}
      {activeSubTab === 'business' && (
        <Card className="max-w-3xl">
          <CardHeader title="Información General & Horarios de Atención" />
          <CardBody>
            <form onSubmit={handleSaveBusiness} className="space-y-6 text-xs sm:text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nombre Comercial:</label>
                  <input
                    type="text"
                    value={businessSettings.name}
                    onChange={(e) =>
                      setBusinessSettings({ ...businessSettings, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Teléfono de Soporte:</label>
                  <input
                    type="text"
                    value={businessSettings.supportPhone}
                    onChange={(e) =>
                      setBusinessSettings({ ...businessSettings, supportPhone: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Dirección del Local:</label>
                <input
                  type="text"
                  value={businessSettings.address}
                  onChange={(e) =>
                    setBusinessSettings({ ...businessSettings, address: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500"
                />
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

              <div className="pt-3 border-t border-slate-100 flex justify-end">
                <Button variant="primary" size="md" type="submit" leftIcon={<Save className="w-4 h-4" />}>
                  Guardar Horarios
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* TAB 3: DELIVERY SETTINGS */}
      {activeSubTab === 'delivery' && (
        <Card className="max-w-2xl">
          <CardHeader
            title="Parámetros de Reparto & Cobertura"
            subtitle="Define el radio de acción y cómo calcula el backend el costo de envío para la IA"
          />
          <CardBody>
            <form onSubmit={handleSaveDelivery} className="space-y-4 text-xs sm:text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Radio Máximo de Cobertura (km):
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={deliverySettings.maxCoverageRadiusKm}
                    onChange={(e) =>
                      setDeliverySettings({
                        ...deliverySettings,
                        maxCoverageRadiusKm: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Más allá de esta distancia, la IA activa el Flujo O (fuera de zona).</p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Costo Base de Envío ($ USD):
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    value={deliverySettings.baseDeliveryFee}
                    onChange={(e) =>
                      setDeliverySettings({
                        ...deliverySettings,
                        baseDeliveryFee: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tiempo Estimado de Cocina (min):
                  </label>
                  <input
                    type="number"
                    value={deliverySettings.estimatedPrepTimeMin}
                    onChange={(e) =>
                      setDeliverySettings({
                        ...deliverySettings,
                        estimatedPrepTimeMin: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tiempo de Reparto en Ruta (min):
                  </label>
                  <input
                    type="number"
                    value={deliverySettings.estimatedTransitTimeMin}
                    onChange={(e) =>
                      setDeliverySettings({
                        ...deliverySettings,
                        estimatedTransitTimeMin: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end">
                <Button variant="primary" size="md" type="submit" leftIcon={<Save className="w-4 h-4" />}>
                  Guardar Configuración de Delivery
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
};
