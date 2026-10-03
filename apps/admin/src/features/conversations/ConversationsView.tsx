import React, { useEffect, useState } from 'react';
import {
  Send,
  Bot,
  UserCheck,
  Lock,
  Phone,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { ConversationStatusBadge } from '@/components/common/StatusBadge';
import { conversationService } from '@/services/conversationService';
import { orderService } from '@/services/orderService';
import { ConversationSummary, ChatMessage, Order } from '@agente-ia/shared';
import { NavItemKey } from '@/components/layout/Sidebar';

interface ConversationsViewProps {
  initialConversationId?: string;
  onNavigateToOrder?: (orderId: string) => void;
  onNavigate?: (view: NavItemKey) => void;
}

export const ConversationsView: React.FC<ConversationsViewProps> = ({
  initialConversationId,
  onNavigateToOrder,
}) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'waiting' | 'human' | 'bot'>('all');
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    setIsLoading(true);
    try {
      const data = await conversationService.getConversations();
      setConversations(data);
      const targetId = initialConversationId || (data.length > 0 ? data[0].id : '');
      if (targetId) {
        setSelectedConvId(targetId);
        loadMessages(targetId);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const loadMessages = async (convId: string) => {
    const msgs = await conversationService.getMessages(convId);
    setMessages(msgs);

    const conv = conversations.find((c) => c.id === convId);
    if (conv?.activeOrderId) {
      const ord = await orderService.getOrderById(conv.activeOrderId);
      setActiveOrder(ord || null);
    } else {
      setActiveOrder(null);
    }
  };

  const handleSelectConversation = (convId: string) => {
    setSelectedConvId(convId);
    loadMessages(convId);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !selectedConvId) return;

    const newMsg = await conversationService.sendMessage(
      selectedConvId,
      inputText.trim(),
      'staff',
      isInternalNote
    );
    setMessages((prev) => [...prev, newMsg]);
    setInputText('');

    // If staff sends a public message, auto-takeover if it was waiting
    const currentConv = conversations.find((c) => c.id === selectedConvId);
    if (currentConv?.status === 'human_pending' && !isInternalNote) {
      await handleTakeover();
    }
  };

  const handleTakeover = async () => {
    if (!selectedConvId) return;
    const updated = await conversationService.takeoverConversation(selectedConvId, 'Operador en Turno');
    setConversations((prev) => prev.map((c) => (c.id === selectedConvId ? updated : c)));
  };

  const handleReturnToBot = async () => {
    if (!selectedConvId) return;
    const updated = await conversationService.returnToBot(selectedConvId);
    setConversations((prev) => prev.map((c) => (c.id === selectedConvId ? updated : c)));
    loadMessages(selectedConvId);
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
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 bg-slate-50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No hay conversaciones en esta pestaña.
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = conv.id === selectedConvId;
              const isWaiting = conv.status === 'human_pending';
              return (
                <div
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`p-3.5 cursor-pointer transition-colors flex items-start gap-3 relative ${
                    isSelected ? 'bg-orange-50/70 border-r-4 border-orange-600' : 'hover:bg-slate-50'
                  } ${isWaiting ? 'bg-rose-50/40' : ''}`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-xs ${
                      isWaiting
                        ? 'bg-rose-100 text-rose-800 ring-2 ring-rose-400 animate-pulse'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {conv.customerName.slice(0, 2).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <h4 className="font-semibold text-slate-900 text-xs sm:text-sm truncate">
                        {conv.customerName}
                      </h4>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {conv.lastMessageTime.slice(11, 16)}
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 line-clamp-1 mb-1.5">{conv.lastMessageSnippet}</p>

                    <div className="flex items-center justify-between">
                      <ConversationStatusBadge status={conv.status} size="sm" />
                      {conv.unreadCount > 0 && (
                        <span className="w-5 h-5 rounded-full bg-orange-600 text-white text-[10px] font-bold flex items-center justify-center shadow-xs">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* MIDDLE PANEL: LIVE CHAT TIMELINE */}
      {currentConv ? (
        <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
          {/* Chat Header */}
          <div className="h-16 bg-white border-b border-slate-200 px-4 flex items-center justify-between shadow-2xs shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-800 flex items-center justify-center font-bold text-xs">
                {currentConv.customerName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-slate-900">{currentConv.customerName}</h3>
                  <ConversationStatusBadge status={currentConv.status} size="sm" />
                </div>
                <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-slate-400" />
                  <span>{currentConv.customerPhone}</span>
                </p>
              </div>
            </div>

            {/* Takeover & Bot Controls */}
            <div className="flex items-center gap-2">
              {currentConv.status === 'human_pending' && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleTakeover}
                  leftIcon={<UserCheck className="w-4 h-4" />}
                >
                  Tomar Control Ahora
                </Button>
              )}
              {currentConv.status === 'bot_active' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTakeover}
                  leftIcon={<UserCheck className="w-4 h-4 text-orange-600" />}
                >
                  Pausar IA & Atender
                </Button>
              )}
              {currentConv.status === 'human_active' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleReturnToBot}
                  leftIcon={<Bot className="w-4 h-4 text-sky-600" />}
                >
                  Devolver a IA 🤖
                </Button>
              )}
            </div>
          </div>

          {/* Timeline Messages Stream */}
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4">
            {messages.map((msg) => {
              if (msg.isInternalNote) {
                return (
                  <div
                    key={msg.id}
                    className="max-w-md mx-auto my-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 shadow-2xs"
                  >
                    <div className="flex items-center gap-1.5 font-bold mb-1 text-amber-800">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Nota Interna de Cocina/Staff ({msg.senderName}):</span>
                    </div>
                    <p>{msg.content}</p>
                    <span className="text-[10px] text-amber-600/80 block text-right mt-1">
                      {msg.timestamp.slice(11, 16)}
                    </span>
                  </div>
                );
              }

              const isCustomer = msg.sender === 'customer';
              const isBot = msg.sender === 'bot';
              const isStaff = msg.sender === 'staff';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isCustomer ? 'items-start' : 'items-end'}`}
                >
                  {/* Sender Tag */}
                  <div className="text-[10px] font-semibold text-slate-400 mb-1 flex items-center gap-1 px-1">
                    {isCustomer && <span>Cliente (WhatsApp)</span>}
                    {isBot && (
                      <span className="text-sky-600 flex items-center gap-1">
                        <Bot className="w-3 h-3" /> Max (Asistente IA)
                      </span>
                    )}
                    {isStaff && (
                      <span className="text-purple-600 flex items-center gap-1">
                        <UserCheck className="w-3 h-3" /> {msg.senderName || 'Operador'}
                      </span>
                    )}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`max-w-md p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-2xs ${
                      isCustomer
                        ? 'bg-white border border-slate-200 text-slate-800 rounded-tl-xs'
                        : isBot
                        ? 'bg-sky-50 border border-sky-200 text-sky-950 rounded-tr-xs'
                        : 'bg-purple-600 text-white rounded-tr-xs'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <span
                      className={`text-[10px] block text-right mt-1.5 ${
                        isStaff ? 'text-purple-200' : 'text-slate-400'
                      }`}
                    >
                      {msg.timestamp.slice(11, 16)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Canned Responses Bar */}
          <div className="bg-slate-100 border-t border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto text-xs shrink-0">
            <span className="text-slate-500 font-semibold text-[11px] whitespace-nowrap">
              Respuestas Rápidas:
            </span>
            <button
              onClick={() =>
                handleApplyCannedResponse(
                  'Hola, disculpa la demora. Ya verificamos con cocina y tu pedido está saliendo en 10 minutos.'
                )
              }
              className="px-2.5 py-1 rounded bg-white hover:bg-slate-200 border border-slate-200 text-slate-700 whitespace-nowrap transition-colors"
            >
              /demora
            </button>
            <button
              onClick={() =>
                handleApplyCannedResponse(
                  'Pago verificado exitosamente. Tu pedido ya está en preparación con prioridad.'
                )
              }
              className="px-2.5 py-1 rounded bg-white hover:bg-slate-200 border border-slate-200 text-slate-700 whitespace-nowrap transition-colors"
            >
              /pago_confirmado
            </button>
            <button
              onClick={() =>
                handleApplyCannedResponse(
                  'El motorizado ya llegó a tu dirección. Por favor sal o atiende a la puerta.'
                )
              }
              className="px-2.5 py-1 rounded bg-white hover:bg-slate-200 border border-slate-200 text-slate-700 whitespace-nowrap transition-colors"
            >
              /repartidor_en_puerta
            </button>
          </div>

          {/* Input & Send Area */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 bg-white border-t border-slate-200 flex flex-col gap-2 shrink-0"
          >
            <div className="flex items-center justify-between text-xs px-1">
              <label className="flex items-center gap-2 text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isInternalNote}
                  onChange={(e) => setIsInternalNote(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-amber-500"
                />
                <span className={`font-semibold ${isInternalNote ? 'text-amber-700' : ''}`}>
                  {isInternalNote ? '🔒 Nota Interna de Cocina (No se envía a WhatsApp)' : 'Enviar mensaje por WhatsApp'}
                </span>
              </label>
            </div>

            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  isInternalNote
                    ? 'Escribe una nota interna para el equipo...'
                    : 'Escribe una respuesta para enviar a WhatsApp...'
                }
                className="flex-1 text-xs sm:text-sm px-3.5 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
              <Button
                type="submit"
                variant={isInternalNote ? 'secondary' : 'primary'}
                size="md"
                disabled={!inputText.trim()}
                rightIcon={<Send className="w-4 h-4" />}
              >
                Enviar
              </Button>
            </div>
          </form>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-8 text-center text-slate-400 text-sm">
          Seleccione una conversación para abrir el chat en vivo.
        </div>
      )}

      {/* RIGHT PANEL: CUSTOMER & ACTIVE ORDER CARD (DESKTOP) */}
      {currentConv && (
        <div className="hidden lg:block w-72 bg-white border-l border-slate-200 p-4 space-y-4 shrink-0 overflow-y-auto">
          <div>
            <h4 className="font-bold text-xs uppercase text-slate-400 tracking-wider mb-2">
              Ficha del Cliente
            </h4>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-2">
              <p className="font-bold text-slate-900 text-sm">{currentConv.customerName}</p>
              <p className="text-slate-500">{currentConv.customerPhone}</p>
              <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-600">
                <p>Historial: 8 pedidos completados</p>
                <p className="font-semibold text-emerald-700 mt-0.5">Cliente Frecuente (VIP)</p>
              </div>
            </div>
          </div>

          {/* Active Order in Course */}
          {activeOrder && (
            <div>
              <h4 className="font-bold text-xs uppercase text-slate-400 tracking-wider mb-2">
                Pedido Activo en Curso
              </h4>
              <div className="bg-orange-50/50 p-3.5 rounded-xl border border-orange-200 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-orange-950">{activeOrder.orderNumber}</span>
                  <span className="font-bold text-slate-900">${activeOrder.total.toFixed(2)}</span>
                </div>
                <p className="text-slate-600 text-[11px]">
                  {activeOrder.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                </p>
                {onNavigateToOrder && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 text-xs"
                    onClick={() => onNavigateToOrder(activeOrder.id)}
                    rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                  >
                    Ver en Cocina
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
