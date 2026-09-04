import { z } from 'zod';

/**
 * Variáveis do frontend. Tudo com prefixo `VITE_` entra no bundle e é
 * público — o que protege os dados é RLS no Postgres, não segredo de chave.
 *
 * O token da brapi e a service_role key NÃO moram aqui em nenhuma hipótese:
 * são secrets de Edge Function.
 */
const envSchema = z.object({
  VITE_SUPABASE_URL: z.url({ error: 'VITE_SUPABASE_URL precisa ser uma URL válida' }),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .min(20, { error: 'VITE_SUPABASE_ANON_KEY parece vazia ou truncada' }),
});

export type Env = z.infer<typeof envSchema>;

export type EnvResult = { ok: true; env: Env } | { ok: false; issues: readonly string[] };

function readEnv(): EnvResult {
  const parsed = envSchema.safeParse(import.meta.env);

  if (parsed.success) {
    return { ok: true, env: parsed.data };
  }

  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  };
}

/**
 * Resultado da validação, não um throw: com o ambiente incompleto o app
 * renderiza uma tela de configuração em vez de uma página branca.
 */
export const envResult: EnvResult = readEnv();
