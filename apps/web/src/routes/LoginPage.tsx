import { DEFAULT_INITIAL_CASH, formatBRL } from '@m8invest/core';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Mail, TrendingUp } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/useAuth';
import { checkSupabaseHealth, getSupabaseClient } from '@/lib/supabase';

type Mode = 'signin' | 'signup' | 'magic';

const credentialsSchema = z.object({
  email: z.string().pipe(z.email({ error: 'Informe um e-mail válido' })),
  password: z.string().min(8, { error: 'A senha precisa de pelo menos 8 caracteres' }),
});

const emailOnlySchema = z.object({
  email: z.string().pipe(z.email({ error: 'Informe um e-mail válido' })),
});

/**
 * O Supabase responde em inglês e com mensagens voltadas a quem integra, não
 * a quem usa. "Invalid login credentials" na tela de um investidor não ajuda.
 */
function translateAuthError(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes('invalid login credentials')) {
    return 'E-mail ou senha incorretos.';
  }
  if (normalized.includes('email not confirmed')) {
    return 'Confirme seu e-mail antes de entrar — o link foi enviado na hora do cadastro.';
  }
  if (normalized.includes('already registered') || normalized.includes('already been registered')) {
    return 'Esse e-mail já tem conta. Use "Entrar".';
  }
  if (normalized.includes('password should be at least')) {
    return 'A senha precisa de pelo menos 8 caracteres.';
  }
  if (normalized.includes('for security purposes') || normalized.includes('rate limit')) {
    return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.';
  }
  if (normalized.includes('signups not allowed')) {
    return 'O cadastro está fechado no momento.';
  }
  if (normalized.includes('provider is not enabled')) {
    return 'Esse provedor de login ainda não está configurado no projeto.';
  }

  return message;
}

const MODE_COPY: Record<Mode, { action: string; hint: string }> = {
  signin: { action: 'Entrar', hint: 'Bem-vindo de volta.' },
  signup: {
    action: 'Criar conta',
    hint: `Você começa com ${formatBRL(DEFAULT_INITIAL_CASH)} fictícios.`,
  },
  magic: { action: 'Enviar link de acesso', hint: 'Sem senha: você recebe um link por e-mail.' },
};

export function LoginPage() {
  const { user, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Esconde o botão do Google quando o provedor não está configurado no
  // projeto, em vez de mostrar um botão que só sabe dar erro.
  const health = useQuery({
    queryKey: ['supabase', 'health'],
    queryFn: checkSupabaseHealth,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const googleEnabled = health.data?.ok === true && health.data.auth.google;

  if (!authLoading && user) {
    return <Navigate to="/app" replace />;
  }

  const redirectTo = `${window.location.origin}/app`;

  async function handleGoogle() {
    setError(null);
    setSubmitting(true);

    const { error: oauthError } = await getSupabaseClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });

    if (oauthError) {
      setError(translateAuthError(oauthError.message));
      setSubmitting(false);
    }
    // Sem else: em caso de sucesso o browser já está navegando para o Google.
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const parsed =
      mode === 'magic'
        ? emailOnlySchema.safeParse({ email })
        : credentialsSchema.safeParse({ email, password });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
      return;
    }

    setSubmitting(true);
    const supabase = getSupabaseClient();

    try {
      if (mode === 'magic') {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo },
        });
        if (otpError) throw otpError;
        setNotice(`Link enviado para ${email}. Ele vale por uma hora.`);
        return;
      }

      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (signUpError) throw signUpError;

        // Sessão nula significa que o projeto exige confirmação de e-mail.
        if (!data.session) {
          setNotice(`Conta criada. Confirme o e-mail enviado para ${email} para entrar.`);
        }
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      // Sucesso: o onAuthStateChange do AuthProvider redireciona.
    } catch (caught) {
      setError(
        caught instanceof Error
          ? translateAuthError(caught.message)
          : 'Não foi possível continuar.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const copy = MODE_COPY[mode];

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 flex items-center justify-center gap-2">
            <TrendingUp className="size-5 text-gain" aria-hidden />
            <span className="text-lg font-semibold tracking-tight">M8.Invest</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{copy.action}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy.hint}</p>
        </div>

        {googleEnabled ? (
          <>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void handleGoogle()}
              disabled={submitting}
            >
              Continuar com Google
            </Button>
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">ou</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@exemplo.com"
            />
          </div>

          {mode === 'magic' ? null : (
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mínimo de 8 caracteres"
              />
            </div>
          )}

          {error ? (
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p role="status" className="flex items-start gap-2 text-sm text-gain">
              <Mail className="mt-0.5 shrink-0" aria-hidden />
              <span>{notice}</span>
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {copy.action}
          </Button>
        </form>

        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
          {mode === 'signin' ? (
            <>
              <p>
                Não tem conta?{' '}
                <Button variant="link" size="sm" onClick={() => setMode('signup')}>
                  Criar agora
                </Button>
              </p>
              <p>
                <Button variant="link" size="sm" onClick={() => setMode('magic')}>
                  Entrar sem senha
                </Button>
              </p>
            </>
          ) : (
            <p>
              <Button variant="link" size="sm" onClick={() => setMode('signin')}>
                Já tenho conta
              </Button>
            </p>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Simulação com fins educacionais. Cotações com atraso. Não constitui recomendação de
          investimento.
        </p>
      </div>
    </div>
  );
}
