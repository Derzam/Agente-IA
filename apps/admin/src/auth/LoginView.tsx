import React, { useState } from 'react';
import { useSession } from './SessionContext';
import { ShieldCheck, LogIn, AlertCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/common/Button';

export const LoginView: React.FC = () => {
  const { signIn, isSessionExpired, clearExpiredNotice } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Por favor ingresa tu correo y contraseña.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await signIn({ email, password });
      clearExpiredNotice();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al iniciar sesión. Verifica tus credenciales.');
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
          <p className="text-sm text-slate-500">
            Ingreso al panel de supervisión y gestión
          </p>
        </div>

        {isSessionExpired && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Tu sesión ha expirado</p>
              <p>Por favor vuelve a ingresar tus credenciales para continuar.</p>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-xs text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="email">
              Correo Electrónico
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@negocio.com"
              required
              className="w-full text-sm px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

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
              className="w-full text-sm px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full justify-center py-2.5"
            isLoading={isSubmitting}
            leftIcon={<LogIn className="w-4 h-4" />}
          >
            Iniciar Sesión
          </Button>
        </form>

        <div className="text-center">
          <p className="text-xs text-slate-400">
            Autenticación segura respaldada por Supabase Auth
          </p>
        </div>
      </div>
    </div>
  );
};
