import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { AuthContext, type AuthState } from '@/features/auth/context';
import { getSupabaseClient } from '@/lib/supabase';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  // `undefined` marca "primeiro evento, nada a comparar"; `null` é sessão
  // ausente de verdade. Distinguir os dois evita limpar o cache na carga.
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const supabase = getSupabaseClient();
    let active = true;

    // O listener já dispara com INITIAL_SESSION, mas getSession() garante o
    // estado inicial mesmo se o evento não chegar — sem isso, um refresh de
    // token falho deixaria o app preso na tela de carregamento.
    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);

      // Limpa o cache quando a IDENTIDADE muda, e não a cada evento de auth.
      // Trocar de usuário sem limpar mostraria a carteira do anterior por
      // alguns frames — inaceitável num app de dinheiro. Mas reagir a
      // `SIGNED_IN` direto seria pior: esse evento também dispara em
      // renovação de token e em volta de foco na aba, e cada disparo
      // esvaziaria o cache inteiro, provocando refetch em cascata.
      const nextUserId = nextSession?.user.id ?? null;

      if (previousUserId.current !== undefined && previousUserId.current !== nextUserId) {
        queryClient.clear();
      }

      previousUserId.current = nextUserId;
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await getSupabaseClient().auth.signOut();
  }, []);

  const value = useMemo<AuthState>(
    () => ({ session, user: session?.user ?? null, loading, signOut }),
    [session, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
