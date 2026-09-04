import type { Database } from '@m8invest/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { envResult } from '@/lib/env';

/**
 * Client tipado pelo schema real do banco. `npm run db:types` regera os tipos
 * a partir do projeto remoto, então errar nome de coluna ou tipo de retorno
 * numa query passa a ser erro de compilação em vez de bug em produção.
 */
export type Db = SupabaseClient<Database>;

let client: Db | null = null;

/**
 * Cliente único do Supabase. Criado sob demanda para que o app consiga
 * renderizar a tela de configuração quando as variáveis não estão setadas.
 */
export function getSupabaseClient(): Db {
  if (!envResult.ok) {
    throw new Error('Supabase não configurado: verifique o arquivo .env.local');
  }

  client ??= createClient<Database>(
    envResult.env.VITE_SUPABASE_URL,
    envResult.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        // PKCE é o fluxo correto para OAuth em SPA: sem client secret e sem
        // token exposto na URL.
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );

  return client;
}

/**
 * Resposta de `GET /auth/v1/settings`. Só os campos que usamos — o Zod
 * descarta o resto, então um campo novo do Supabase não quebra nada.
 */
const authSettingsSchema = z.object({
  external: z.object({
    email: z.boolean(),
    google: z.boolean(),
    anonymous_users: z.boolean(),
  }),
  disable_signup: z.boolean(),
  mailer_autoconfirm: z.boolean(),
});

export type AuthSettings = {
  /** Cobre e-mail/senha e magic link — o Supabase trata os dois como um provedor. */
  email: boolean;
  google: boolean;
  anonymous: boolean;
  signupsEnabled: boolean;
  /** Falso quando o usuário precisa clicar no link de confirmação antes de entrar. */
  emailConfirmationRequired: boolean;
};

export type SupabaseHealth =
  { ok: true; status: number; auth: AuthSettings } | { ok: false; status: number; detail: string };

/**
 * Verifica URL e publishable key sem depender de nenhuma tabela existir.
 *
 * Usa `/auth/v1/settings` e não `/rest/v1/`: no sistema novo de chaves do
 * Supabase, a raiz do REST responde 401 "Secret API key required" mesmo com
 * uma publishable key válida. O endpoint de settings aceita a publishable,
 * devolve 401 para chave inválida — e de brinde diz quais provedores de login
 * estão configurados, que é exatamente o que falta conferir na Fase 1.
 */
export async function checkSupabaseHealth(): Promise<SupabaseHealth> {
  if (!envResult.ok) {
    return { ok: false, status: 0, detail: 'Variáveis de ambiente ausentes' };
  }

  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key } = envResult.env;

  try {
    const response = await fetch(`${url.replace(/\/$/u, '')}/auth/v1/settings`, {
      headers: { apikey: key },
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        detail:
          response.status === 401
            ? 'Chave rejeitada — confira a publishable key'
            : response.statusText || 'Resposta inesperada',
      };
    }

    const parsed = authSettingsSchema.safeParse(await response.json());

    if (!parsed.success) {
      return {
        ok: false,
        status: response.status,
        detail: 'Resposta em formato inesperado',
      };
    }

    return {
      ok: true,
      status: response.status,
      auth: {
        email: parsed.data.external.email,
        google: parsed.data.external.google,
        anonymous: parsed.data.external.anonymous_users,
        signupsEnabled: !parsed.data.disable_signup,
        emailConfirmationRequired: !parsed.data.mailer_autoconfirm,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: error instanceof Error ? error.message : 'Falha de rede',
    };
  }
}
