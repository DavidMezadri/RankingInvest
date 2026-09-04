import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { envResult } from '@/lib/env';

let client: SupabaseClient | null = null;

/**
 * Cliente único do Supabase. Criado sob demanda para que o app consiga
 * renderizar a tela de configuração quando as variáveis não estão setadas.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!envResult.ok) {
    throw new Error('Supabase não configurado: verifique o arquivo .env.local');
  }

  client ??= createClient(envResult.env.VITE_SUPABASE_URL, envResult.env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      // PKCE é o fluxo correto para OAuth em SPA: sem client secret e sem
      // token exposto na URL.
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return client;
}

export type SupabasePing = {
  ok: boolean;
  status: number;
  detail: string;
};

/**
 * Verifica URL + anon key sem depender de nenhuma tabela existir.
 * `GET /rest/v1/` devolve o schema OpenAPI quando a chave é aceita.
 */
export async function pingSupabase(): Promise<SupabasePing> {
  if (!envResult.ok) {
    return { ok: false, status: 0, detail: 'Variáveis de ambiente ausentes' };
  }

  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = envResult.env;

  try {
    const response = await fetch(`${url.replace(/\/$/u, '')}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });

    return {
      ok: response.ok,
      status: response.status,
      detail: response.ok ? 'REST respondeu e aceitou a anon key' : response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: error instanceof Error ? error.message : 'Falha de rede',
    };
  }
}
