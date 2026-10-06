import React, { useState } from 'react';
import { useSession } from './SessionContext';
import { ShieldCheck, LogIn, Mail, AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/common/Button';

export const LoginView: React.FC = () => {
  const { signIn, sendMagicLink, isSessionExpired, clearExpiredNotice } = useSession();
  const [mode, setMode] = useState<'magic' | 'password'>('magic');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setErrorMessage('Ingresa tu correo electrónico.');
      return;
    }
    if (mode === 'password' && !password) {
      setErrorMessage('Ingresa tu contraseña.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      if (mode === 'magic') {
        await sendMagicLink(normalizedEmail);
        setSuccessMessage('Enlace enviado. Revisa tu correo y abre el enlace de acceso en este dispositivo.');
      } else {
        await signIn({ email: normalizedEmail, password });
        clearExpiredNotice();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'No se pudo iniciar sesión. Verifica el correo e inténtalo nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-xl mx-auto flex items-center justify-center">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Agente-IA Admin</h1>
          <p className="text-sm text-slate-500">Ingreso al panel de supervisión y gestión</p>
        </div>

        {isSessionExpired && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Tu sesión ha expirado</p>
              <p>Solicita un nuevo enlace o vuelve a ingresar tus credenciales.</p>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-xs text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2.5 text-xs text-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{successMessage}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setMode('magic');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
              mode === 'magic' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            Enlace por correo
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('password');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
              mode === 'password' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            Contraseña
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="email">
              Correo electrónico
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@negocio.com"
              required
              autoComplete="email"
              className="w-full text-sm px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          {mode === 'password' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="w-full text-sm px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full justify-center py-2.5"
            isLoading={isSubmitting}
            leftIcon={mode === 'magic' ? <Mail className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
          >
            {mode === 'magic' ? 'Enviar enlace de acceso' : 'Iniciar sesión'}
          </Button>
        </form>

        <div className="text-center space-y-1">
          <p className="text-xs text-slate-400">Autenticación segura respaldada por Supabase Auth</p>
          {mode === 'magic' && (
            <p className="text-[11px] text-slate-400">
              Solo se aceptan cuentas previamente autorizadas por el negocio.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
