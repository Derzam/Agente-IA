import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Send,
  Bot,
  UserCheck,
  Lock,
  Phone,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { ConversationStatusBadge } from '@/components/common/StatusBadge';
import { OutboxStatusBadge } from '@/components/operations/OutboxStatusBadge';
import { VersionConflictNotice } from '@/components/common/VersionConflictNotice';
import { ApiErrorBanner } from '@/components/common/ApiErrorBanner';
import { conversationService } from '@/services/conversationService';
import { orderService } from '@/services/orderService';
import { ConversationSummary, ChatMessage, Order } from '@/types/viewModels';
import type { HandoffReason } from '@agente-ia/shared';
import { useSession } from '@/auth/SessionContext';
import { usePolling } from '@/hooks/usePolling';
import { VersionConflictError, NetworkError, NormalizedApiError } from '@/api/types';
import { newIdempotencyKey, USE_MOCK_DATA } from '@/services/apiClient';
import { NavItemKey } from '@/components/layout/Sidebar';
import { reconcileConversationMessages } from './messageReconciliation';

const CANONICAL_REASONS: { id: HandoffReason; label: string }[] = [
  { id: 'explicit_request', label: 'Solicitud explícita del cliente' },
  { id: 'misunderstanding', label: 'La IA no entiende la petición' },
  { id: 'complaint', label: 'Reclamo o insatisfacción' },
  { id: 'payment_issue', label: 'Problema con el método de pago' },
  { id: 'system_failure', label: 'Falla técnica o del sistema' },
];

interface ConversationsViewProps {
  initialConversationId?: string;
  onNavigateToOrder?: (orderId: string) => void;
  onNavigate?: (view: NavItemKey) => void;
}

export const ConversationsView: React.FC<ConversationsViewProps> = ({
  initialConversationId,
  onNavigateToOrder,
}) => {
  const { user } = useSession();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string>('');
  const selectedConvIdRef = useRef('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'waiting' | 'human' | 'bot'>('all');
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  // Scroll & view preservation refs
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // Handoff Request Modal State
  const [isHandoffModalOpen, setIsHandoffModalOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<HandoffReason>('explicit_request');
  const [handoffContext, setHandoffContext] = useState('');

  // Retain keys on network error
  const retainedMessageKeysRef = useRef<Map<string, string>>(new Map());

  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom < 80;
  };

  const loadConversations = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await conversationService.getConversations(undefined, { signal });
      if (signal?.aborted) return;
      setConversations(data);
      setActionError(null);
      return data;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setActionError(err);
      }
      if (signal) throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (convId: string, signal?: AbortSignal, latestConversation?: ConversationSummary) => {
    if (!convId) return;
    try {
      const pollInitiatedAt = Date.now();
      const msgs = await conversationService.getMessages(convId, { signal });
      if (signal?.aborted || selectedConvIdRef.current !== convId) return;
      setMessages((prev) => {
        const merged = reconcileConversationMessages(prev, msgs, convId, Date.now(), pollInitiatedAt);
        if (
          prev.length === merged.length &&
          prev.every(
            (p, i) =>
              p.id === merged[i].id &&
              p.outboxId === merged[i].outboxId &&
              p.deliveryStatus === merged[i].deliveryStatus &&
              p.failureCode === merged[i].failureCode &&
              p.content === merged[i].content
          )
        ) {
          return prev;
        }
        return merged;
      });

      const conv = latestConversation ?? conversations.find((c) => c.id === convId);
      if (conv?.activeOrderId) {
        const ord = await orderService.getOrderById(conv.activeOrderId, { signal });
        if (!signal?.aborted && selectedConvIdRef.current === convId) setActiveOrder(ord || null);
      } else {
        setActiveOrder(null);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setActionError(err);
      }
      if (signal) throw err;
    }
  }, [conversations]);

  useEffect(() => {
    if (initialConversationId) {
      selectedConvIdRef.current = initialConversationId;
      setSelectedConvId(initialConversationId);
    }
  }, [initialConversationId]);

  // Load once on mount, then poll; errors reach the shared backoff scheduler.
  usePolling({
    callback: async (signal) => {
      const data = await loadConversations(signal);
      if (signal.aborted || !data) return;
      const targetId = selectedConvId || initialConversationId || data[0]?.id;
      if (targetId) {
        if (!selectedConvId) {
          selectedConvIdRef.current = targetId;
          setSelectedConvId(targetId);
        }
        await loadMessages(targetId, signal, data.find((c) => c.id === targetId));
      }
    },
    intervalMs: 8000,
  });

  // Preserve scroll on message update if already near bottom
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el && isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSelectConversation = (convId: string) => {
    selectedConvIdRef.current = convId;
    setSelectedConvId(convId);
    setMessages([]);
    setActiveOrder(null);
    isNearBottomRef.current = true;
    loadMessages(convId);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !selectedConvId) return;

    setConflictError(null);
    setActionError(null);

    const currentConv = conversations.find((c) => c.id === selectedConvId);
    const textToSend = inputText.trim();
    const gestureKey = `msg-${selectedConvId}-${Date.now()}`;
    const keyToUse = retainedMessageKeysRef.current.get(gestureKey) || newIdempotencyKey();

    const lastPersistedMsg = [...messages].reverse().find((m) => m.deliveryStatus !== 'queued');
    const anchorMessageId = lastPersistedMsg?.id || null;

    try {
      const newMsg = await conversationService.sendMessage(
        selectedConvId,
        textToSend,
        currentConv?.version || 1,
        isInternalNote,
        keyToUse,
        undefined,
        anchorMessageId
      );
      retainedMessageKeysRef.current.delete(gestureKey);
      if (messagesContainerRef.current) {
        const el = messagesContainerRef.current;
        isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }
      setMessages((prev) => [...prev, newMsg]);
      setInputText('');

      // If staff sends a message while pending, auto-takeover
      if (currentConv?.status === 'human_pending' && !isInternalNote) {
        await handleTakeover();
      }
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadConversations();
        await loadMessages(selectedConvId);
      } else if (err instanceof NetworkError) {
        retainedMessageKeysRef.current.set(gestureKey, keyToUse);
        setActionError(err);
      } else {
        const errCode = (err instanceof NormalizedApiError ? err.code : err?.code) || '';
        const errMsg = String(err?.message || '');
        if (errCode === 'WINDOW_CLOSED' || errMsg.includes('WINDOW_CLOSED')) {
          setActionError(new Error('La ventana de 24 horas de Meta WhatsApp ha expirado. Espera a que el cliente envíe un mensaje nuevo para poder responderle.'));
        } else if (errCode === 'HANDOFF_REQUIRED' || errMsg.includes('HANDOFF_REQUIRED')) {
          setActionError(new Error('Se requiere tomar el control de la conversación (Handoff activo) antes de poder enviar mensajes.'));
        } else {
          setActionError(err);
        }
      }
    }
  };

  const handleConfirmHandoff = async () => {
    if (!selectedConvId) return;
    setConflictError(null);
    setActionError(null);

    const currentConv = conversations.find((c) => c.id === selectedConvId);
    const operatorUserId = user?.id;
    if (!operatorUserId) {
      setActionError(new Error('La sesión no contiene un usuario válido. Vuelve a iniciar sesión antes de tomar el control.'));
      return;
    }

    try {
      const handoff = await conversationService.requestHandoff(
        selectedConvId,
        selectedReason,
        currentConv?.version || 1,
        handoffContext.trim() || null
      );
      const updated = await conversationService.takeoverConversation(
        selectedConvId,
        operatorUserId,
        handoff.id,
        currentConv?.version || 1,
        handoff.version
      );
      setConversations((prev) => prev.map((c) => (c.id === selectedConvId ? updated : c)));
      loadMessages(selectedConvId);
      setIsHandoffModalOpen(false);
      setHandoffContext('');
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadConversations();
      } else {
        setActionError(err);
      }
    }
  };

  const handleTakeover = async () => {
    if (!selectedConvId) return;
    setConflictError(null);
    setActionError(null);

    const currentConv = conversations.find((c) => c.id === selectedConvId);
    const operatorUserId = user?.id;
    if (!operatorUserId) {
      setActionError(new Error('La sesión no contiene un usuario válido. Vuelve a iniciar sesión antes de tomar el control.'));
      return;
    }

    try {
      const updated = await conversationService.takeoverConversation(
        selectedConvId,
        operatorUserId,
        currentConv?.handoffId,
        currentConv?.version || 1,
        currentConv?.handoffVersion
      );
      setConversations((prev) => prev.map((c) => (c.id === selectedConvId ? updated : c)));
      loadMessages(selectedConvId);
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadConversations();
      } else {
        setActionError(err);
      }
    }
  };

  const handleReturnToBot = async () => {
    if (!selectedConvId) return;
    setConflictError(null);
    setActionError(null);

    const currentConv = conversations.find((c) => c.id === selectedConvId);

    try {
      const updated = await conversationService.returnToBot(
        selectedConvId,
        currentConv?.handoffId,
        currentConv?.handoffVersion
      );
      setConversations((prev) => prev.map((c) => (c.id === selectedConvId ? updated : c)));
      loadMessages(selectedConvId);
    } catch (err: any) {
      if (err instanceof VersionConflictError) {
        setConflictError(err.message);
        await loadConversations();
      } else {
        setActionError(err);
      }
    }
  };

  const handleApplyCannedResponse = (text: string) => {
    setInputText(text);
  };

  const currentConv = conversations.find((c) => c.id === selectedConvId);

  const filteredConversations = conversations.filter((c) => {
    const matchesSearch =
      c.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.customerPhone.includes(searchQuery) ||
      c.lastMessageSnippet.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (filterTab === 'waiting') return c.status === 'human_pending';
    if (filterTab === 'human') return c.status === 'human_active';
    if (filterTab === 'bot') return c.status === 'bot_active';
    return true;
  });

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col md:flex-row overflow-hidden bg-slate-100">
      {/* LEFT PANEL: CONVERSATION LIST */}
      <div className="w-full md:w-80 lg:w-96 bg-white border-r border-slate-200 flex flex-col shrink-0">
        {/* Search & Tabs */}
        <div className="p-3 border-b border-slate-200 space-y-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre o celular..."
            className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
          />
          <div className="grid grid-cols-4 gap-1 bg-slate-100 p-1 rounded-lg text-[11px] font-semibold">
            <button
              onClick={() => setFilterTab('all')}
              className={`py-1 rounded text-center transition-all ${
                filterTab === 'all' ? 'bg-white shadow-2xs text-slate-900 font-bold' : 'text-slate-600'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setFilterTab('waiting')}
              className={`py-1 rounded text-center transition-all flex items-center justify-center gap-1 ${
                filterTab === 'waiting'
                  ? 'bg-rose-600 text-white shadow-2xs font-bold'
                  : 'text-rose-700 hover:bg-rose-50'
              }`}
            >
              <span>Espera</span>
              {conversations.filter((c) => c.status === 'human_pending').length > 0 && (
                <span className="w-2 h-2 rounded-full bg-rose-300 animate-ping" />
              )}
            </button>
            <button
              onClick={() => setFilterTab('human')}
              className={`py-1 rounded text-center transition-all ${
                filterTab === 'human' ? 'bg-white shadow-2xs text-slate-900 font-bold' : 'text-slate-600'
              }`}
            >
              Humano
            </button>
            <button
              onClick={() => setFilterTab('bot')}
              className={`py-1 rounded text-center transition-all ${
                filterTab === 'bot' ? 'bg-white shadow-2xs text-slate-900 font-bold' : 'text-slate-600'
              }`}
            >
              Bot IA
            </button>
          </div>
        </div>

        {/* Conversation Items */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="text-center py-12 px-4 text-xs text-slate-400">
              No hay conversaciones en esta vista.
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                className={`p-3.5 cursor-pointer transition-all hover:bg-slate-50 flex items-start gap-3 relative ${
                  conv.id === selectedConvId ? 'bg-orange-50/70 border-r-4 border-orange-500' : ''
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center font-bold text-slate-700 text-xs shrink-0">
                  {conv.customerName.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-bold text-slate-800 text-xs truncate">
                      {conv.customerName}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {conv.lastMessageTime?.slice(11, 16)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <ConversationStatusBadge status={conv.status} size="sm" />
                    {conv.assignedOperatorName && (
                      <span className="text-[10px] text-slate-500 truncate">
                        • {conv.assignedOperatorName}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 truncate">{conv.lastMessageSnippet}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* CENTER PANEL: ACTIVE CHAT THREAD */}
      <div className="flex-1 flex flex-col bg-white min-w-0">
        {conflictError && (
          <div className="p-3">
            <VersionConflictNotice
              message={conflictError}
              onRefresh={() => {
                setConflictError(null);
                loadConversations();
                if (selectedConvId) loadMessages(selectedConvId);
              }}
            />
          </div>
        )}

        {actionError ? (
          <div className="p-3">
            <ApiErrorBanner
              error={actionError}
              onRetry={() => {
                setActionError(null);
                loadConversations();
                if (selectedConvId) loadMessages(selectedConvId);
              }}
            />
          </div>
        ) : null}

        {currentConv ? (
          <>
            {/* Chat Topbar */}
            <div className="h-16 px-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-700 font-bold text-xs flex items-center justify-center border border-orange-200 shrink-0">
                  {currentConv.customerName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-sm truncate">
                      {currentConv.customerName}
                    </h3>
                    <ConversationStatusBadge status={currentConv.status} size="sm" />
                  </div>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {currentConv.customerPhone}
                  </p>
                </div>
              </div>

              {/* Action Controls for Handoff */}
              <div className="flex items-center gap-2">
                {currentConv.status === 'human_pending' && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleTakeover}
                    leftIcon={<UserCheck className="w-4 h-4" />}
                  >
                    Tomar control
                  </Button>
                )}
                {currentConv.status === 'bot_active' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsHandoffModalOpen(true)}
                    leftIcon={<UserCheck className="w-4 h-4" />}
                  >
                    Solicitar Handoff
                  </Button>
                )}
                {currentConv.status === 'human_active' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleReturnToBot}
                    leftIcon={<Bot className="w-4 h-4" />}
                  >
                    Devolver a Bot
                  </Button>
                )}
              </div>
            </div>

            {/* Prominent Handoff Priority Notice */}
            {currentConv.status === 'human_pending' && (
              <div
                role="alert"
                className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 flex items-center justify-between gap-2 text-xs text-rose-900"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    <strong>Automatización suspendida. Pendiente de atención humana.</strong> Los mensajes de IA no continuarán hasta que el operador tome el control.
                  </span>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleTakeover}
                  leftIcon={<UserCheck className="w-3.5 h-3.5" />}
                  className="shrink-0"
                >
                  Tomar control
                </Button>
              </div>
            )}

            {currentConv.status === 'human_active' && (
              <div
                role="status"
                className="px-4 py-2 bg-purple-50 border-b border-purple-200 flex items-center justify-between gap-2 text-xs text-purple-900"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <UserCheck className="w-4 h-4 text-purple-600 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    <strong>Conversación bajo control humano.</strong> Automatización de IA suspendida; el operador controla la conversación.
                  </span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleReturnToBot}
                  leftIcon={<Bot className="w-3.5 h-3.5" />}
                  className="shrink-0"
                >
                  Devolver a Bot
                </Button>
              </div>
            )}

            {/* Messages Scroll Container */}
            <div
              ref={messagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50"
            >
              {messages.map((msg) => {
                const isCustomer = msg.sender === 'customer';
                const isBot = msg.sender === 'bot';

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      isCustomer ? 'items-start' : 'items-end'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl p-3.5 shadow-2xs text-xs space-y-1 ${
                        msg.isInternalNote
                          ? 'bg-amber-100 border border-amber-300 text-amber-900'
                          : isCustomer
                          ? 'bg-white border border-slate-200 text-slate-800'
                          : isBot
                          ? 'bg-orange-50 border border-orange-200 text-slate-800'
                          : 'bg-orange-600 text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px] opacity-75 font-semibold">
                        <span>
                          {msg.isInternalNote ? '📝 Nota interna' : msg.senderName || msg.sender}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span>{msg.timestamp.slice(11, 16)}</span>
                          {!isCustomer && !msg.isInternalNote && (
                            <OutboxStatusBadge
                              status={msg.deliveryStatus}
                              failureCode={msg.failureCode}
                              compact
                            />
                          )}
                        </div>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Canned Responses */}
            <div className="px-4 py-2 border-t border-slate-200 bg-white flex items-center gap-1.5 overflow-x-auto text-[11px]">
              <span className="text-slate-400 font-bold uppercase text-[10px] shrink-0">
                Respuestas:
              </span>
              <button
                onClick={() =>
                  handleApplyCannedResponse(
                    '¡Hola! Soy parte del equipo humano. Con mucho gusto te asisto directamente.'
                  )
                }
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 whitespace-nowrap"
              >
                👋 Saludo Operador
              </button>
              <button
                onClick={() =>
                  handleApplyCannedResponse(
                    'Tu pedido ya se encuentra en cocina y saldrá en unos 15 minutos 🛵.'
                  )
                }
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 whitespace-nowrap"
              >
                ⏱️ Tiempo de entrega
              </button>
              <button
                onClick={() =>
                  handleApplyCannedResponse(
                    'Por favor confírmanos tu dirección exacta y referencia para agilizar el despacho.'
                  )
                }
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 whitespace-nowrap"
              >
                📍 Solicitar ubicación
              </button>
            </div>

            {/* Input Message Form */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-200 bg-white">
              {USE_MOCK_DATA && (
                <div className="flex items-center gap-2 mb-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isInternalNote}
                      onChange={(e) => setIsInternalNote(e.target.checked)}
                      className="rounded text-orange-600 focus:ring-orange-500"
                    />
                    <Lock className="w-3.5 h-3.5 text-amber-600" />
                    <span>Guardar como nota interna privada (no se envía a WhatsApp)</span>
                  </label>
                </div>
              )}

              {currentConv.status !== 'human_active' && !isInternalNote && (
                <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-xs text-amber-800">
                  <span>Debes tomar el control de la conversación para responder al cliente por WhatsApp.</span>
                  {currentConv.status === 'human_pending' ? (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={handleTakeover}
                      leftIcon={<UserCheck className="w-3.5 h-3.5" />}
                    >
                      Tomar control
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsHandoffModalOpen(true)}
                      leftIcon={<UserCheck className="w-3.5 h-3.5" />}
                    >
                      Solicitar Handoff
                    </Button>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputText}
                  disabled={currentConv.status !== 'human_active' && !isInternalNote}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    currentConv.status !== 'human_active' && !isInternalNote
                      ? 'Debes tomar el control de la conversación para responder...'
                      : isInternalNote
                      ? 'Escribe una nota interna para el equipo...'
                      : 'Escribe un mensaje para responder al cliente...'
                  }
                  className={`flex-1 text-xs px-3.5 py-2.5 border rounded-xl focus:outline-none focus:ring-2 ${
                    currentConv.status !== 'human_active' && !isInternalNote
                      ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                      : isInternalNote
                      ? 'bg-amber-50 border-amber-300 focus:ring-amber-500'
                      : 'bg-slate-50 border-slate-200 focus:ring-orange-500'
                  }`}
                />
                <Button
                  type="submit"
                  variant={isInternalNote ? 'secondary' : 'primary'}
                  size="sm"
                  disabled={!inputText.trim() || (currentConv.status !== 'human_active' && !isInternalNote)}
                  rightIcon={<Send className="w-4 h-4" />}
                >
                  {isInternalNote ? 'Guardar Nota' : 'Enviar'}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
            Selecciona una conversación para comenzar
          </div>
        )}
      </div>

      {/* RIGHT PANEL: CONTEXTUAL ORDER & CUSTOMER DATA */}
      {currentConv && (
        <div className="hidden xl:flex w-80 bg-white border-l border-slate-200 flex-col p-4 space-y-4 shrink-0 overflow-y-auto">
          <div>
            <h4 className="font-bold text-xs uppercase text-slate-400 tracking-wider mb-2">
              Contexto del Cliente
            </h4>
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
              <p className="font-bold text-slate-900">{currentConv.customerName}</p>
              <p className="text-slate-600">{currentConv.customerPhone}</p>
              <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500 space-y-1">
                <p>Canal: WhatsApp Cloud API</p>
                <p>Atención: {currentConv.status}</p>
              </div>
            </div>
          </div>

          {/* Handoff Status Card if active or pending */}
          {(currentConv.status === 'human_pending' || currentConv.status === 'human_active' || currentConv.handoffId) && (
            <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-200 space-y-1.5 text-xs text-amber-900">
              <h5 className="font-bold text-[11px] uppercase tracking-wide text-amber-800">
                Estado de Handoff Humano
              </h5>
              <div className="space-y-1 text-[11px]">
                <p>
                  <span className="font-semibold">Estado:</span>{' '}
                  <span className="capitalize">{currentConv.handoffStatus || (currentConv.status === 'human_pending' ? 'Pendiente' : 'Activo')}</span>
                </p>
                <p>
                  <span className="font-semibold">Motivo:</span>{' '}
                  <span>
                    {CANONICAL_REASONS.find((r) => r.id === currentConv.handoffReason)?.label || currentConv.handoffReason || 'Solicitud de intervención'}
                  </span>
                </p>
                <p>
                  <span className="font-semibold">Operador:</span>{' '}
                  <span>{currentConv.assignedOperatorName || 'Sin asignar'}</span>
                </p>
              </div>
            </div>
          )}

          {activeOrder && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-xs uppercase text-slate-400 tracking-wider">
                  Pedido Asociado
                </h4>
                {onNavigateToOrder && (
                  <button
                    onClick={() => onNavigateToOrder(activeOrder.id)}
                    className="text-[11px] text-orange-600 font-semibold hover:underline flex items-center gap-0.5"
                  >
                    <span>Ver pedido</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-900">{activeOrder.orderNumber}</span>
                  <span className="font-bold text-orange-600">${activeOrder.total.toFixed(2)}</span>
                </div>
                <div className="space-y-1 text-slate-600 text-[11px]">
                  {activeOrder.items.map((it) => (
                    <div key={it.id} className="flex justify-between">
                      <span>{it.quantity}x {it.name}</span>
                      <span>${it.subtotal.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* HANDOFF CREATION MODAL */}
      <Modal
        isOpen={isHandoffModalOpen}
        onClose={() => setIsHandoffModalOpen(false)}
        title="Solicitar Handoff a Operador Humano"
        maxWidth="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsHandoffModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmHandoff}
              leftIcon={<UserCheck className="w-4 h-4" />}
            >
              Iniciar Handoff & Tomar Control
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs sm:text-sm">
          <p className="text-slate-600">
            Pausará las respuestas automáticas del bot de WhatsApp para la conversación con{' '}
            <span className="font-bold text-slate-900">{currentConv?.customerName}</span>.
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Motivo canónico del Handoff (Requerido):
            </label>
            <select
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value as HandoffReason)}
              className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-orange-500 focus:outline-none"
            >
              {CANONICAL_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} ({r.id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Contexto o notas del operador (opcional):
            </label>
            <textarea
              rows={2}
              value={handoffContext}
              onChange={(e) => setHandoffContext(e.target.value)}
              placeholder="ej. El cliente tiene dudas sobre ingredientes específicos..."
              className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-orange-500 focus:outline-none"
            />
          </div>

          <p className="text-[11px] text-slate-400 italic">
            Esta acción se registrará formalmente mediante POST /conversations/{currentConv?.id}/handoffs.
          </p>
        </div>
      </Modal>
    </div>
  );
};
