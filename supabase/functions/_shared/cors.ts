/**
 * CORS para as funções chamadas pelo NAVEGADOR.
 *
 * `place-order` e `fixed-income` são invocadas pelo frontend, então o browser
 * manda um preflight `OPTIONS` antes de cada POST — porque a requisição leva
 * cabeçalhos que não são simples (`authorization`, `apikey`). Sem responder a
 * esse OPTIONS com os cabeçalhos abaixo, o POST nunca sai, e o erro que chega
 * na tela é um genérico "Failed to send a request to the Edge Function", que
 * não diz nada sobre a causa.
 *
 * `sync-quotes` e `close-day` NÃO usam isto: quem as chama é o pg_net, de
 * dentro do Postgres, e servidor não faz preflight. Adicionar CORS onde não é
 * necessário só sugere que aquela função é chamável do navegador.
 *
 * `Allow-Origin: *` é seguro aqui porque a autenticação é por cabeçalho
 * `Authorization`, não por cookie. Um site malicioso consegue emitir a
 * requisição, mas não consegue ler o token do nosso localStorage para
 * assiná-la — então não existe o vetor de CSRF que justificaria restringir a
 * origem. Restringir daria uma lista de domínios a manter em cada deploy
 * novo, em troca de nenhuma proteção real.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** Responde ao preflight. Devolve `null` quando não é OPTIONS. */
export function handlePreflight(request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Resposta JSON com os cabeçalhos de CORS já aplicados. */
export function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
