/**
 * Auditoria de RLS.
 *
 * Cria dois usuários, faz o primeiro operar, e então tenta — como o segundo e
 * como anônimo — ler e escrever tudo que pertence ao primeiro. Cada tentativa
 * que DEVERIA falhar e não falha é um vazamento.
 *
 * Por que um script e não teste unitário: RLS não é código que se possa
 * chamar isoladamente. A política só existe no Postgres, e a única forma de
 * saber se ela funciona é falar com o banco pela mesma porta que um atacante
 * usaria — a API REST, com um token de outro usuário.
 *
 * Uso:
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... node scripts/rls-audit.mjs
 *
 * Roda com a chave PÚBLICA de propósito. Uma auditoria feita com a secret key
 * passaria em tudo e não provaria nada.
 */

const url = process.env.VITE_SUPABASE_URL?.replace(/\/$/u, '');
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.');
  process.exit(2);
}

const stamp = Date.now().toString(36);
const USERS = {
  alice: { email: `rls-audit-a-${stamp}@m8invest.test`, password: `Audit-${stamp}-Aa1!` },
  bob: { email: `rls-audit-b-${stamp}@m8invest.test`, password: `Audit-${stamp}-Bb1!` },
};

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, { token, method = 'GET', body, prefer } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Resposta que não é JSON: devolve o texto cru, porque a mensagem de erro
    // do PostgREST é justamente o que interessa quando isso acontece.
    parsed = text;
  }

  return { status: response.status, body: parsed };
}

async function signUp({ email, password }) {
  const { status, body } = await api('/auth/v1/signup', {
    method: 'POST',
    body: { email, password },
  });

  if (!body?.access_token) {
    throw new Error(`signup falhou (${status}): ${JSON.stringify(body)}`);
  }

  return body.access_token;
}

/** Espera lista vazia: a linha existe, mas a policy não deixa ver. */
function expectEmpty(name, result) {
  const empty = Array.isArray(result.body) && result.body.length === 0;
  record(name, empty, empty ? undefined : `retornou ${JSON.stringify(result.body).slice(0, 90)}`);
}

/** Espera erro de permissão: o grant nem deixa a requisição passar. */
function expectDenied(name, result) {
  const denied = result.status >= 400;
  record(name, denied, denied ? `HTTP ${result.status}` : `PERMITIU (HTTP ${result.status})`);
}

/**
 * Espera que a escrita não altere NADA.
 *
 * O status HTTP não serve de oráculo para escrita barrada por policy: uma
 * policy cuja cláusula USING não casa nenhuma linha devolve 204, o mesmo
 * status de uma escrita bem-sucedida. Testar só o status daria falso alarme
 * aqui — e, pior, falso silêncio se a policy estivesse de fato aberta.
 *
 * Por isso a chamada pede `Prefer: return=representation` e o teste olha as
 * LINHAS devolvidas: array vazio significa que nada foi tocado.
 */
function expectNothingWritten(name, result) {
  if (result.status >= 400) {
    record(name, true, `HTTP ${result.status}`);
    return;
  }

  const rows = Array.isArray(result.body) ? result.body.length : null;
  const untouched = rows === 0;
  record(
    name,
    untouched,
    untouched
      ? `HTTP ${result.status}, 0 linhas afetadas`
      : `ESCREVEU ${String(rows ?? '?')} linha(s)`,
  );
}

async function main() {
  console.log(`Auditoria de RLS em ${url}\n`);

  console.log('Preparando dois usuários…');
  const alice = await signUp(USERS.alice);
  const bob = await signUp(USERS.bob);
  console.log('  ok\n');

  // Alice opera, para existirem linhas dela em todas as tabelas.
  const asset = await api('/rest/v1/assets?select=ticker&is_tradable=eq.true&limit=1', {
    token: alice,
  });
  const ticker = asset.body?.[0]?.ticker;

  if (ticker) {
    await api('/functions/v1/place-order', {
      token: alice,
      method: 'POST',
      body: { ticker, side: 'BUY', quantity: 1 },
    });
  }

  const product = await api(
    '/rest/v1/fixed_income_products?select=id,min_investment&is_active=eq.true&order=min_investment.asc&limit=1',
    { token: alice },
  );

  if (product.body?.[0]) {
    await api('/functions/v1/fixed-income', {
      token: alice,
      method: 'POST',
      body: {
        action: 'APPLY',
        productId: product.body[0].id,
        principal: product.body[0].min_investment,
      },
    });
  }

  const alicePortfolio = await api('/rest/v1/portfolios?select=id', { token: alice });
  const alicePortfolioId = alicePortfolio.body?.[0]?.id;
  record(
    'Alice tem carteira própria (controle positivo)',
    Boolean(alicePortfolioId),
    alicePortfolioId ? undefined : 'sem carteira — o resto do teste não vale',
  );

  console.log('\nLeitura entre usuários — Bob tentando ver dados da Alice:');
  const ownedTables = [
    'portfolios',
    'orders',
    'positions',
    'ledger_entries',
    'fixed_income_investments',
    'portfolio_snapshots',
  ];

  for (const table of ownedTables) {
    // Bob acabou de nascer e não tem posição nem ordem, então qualquer linha
    // que apareça é da Alice.
    const asBob = await api(`/rest/v1/${table}?select=*`, { token: bob });
    // O trigger de cadastro cria carteira E o lançamento de saldo inicial,
    // então essas duas tabelas nascem com uma linha própria. As demais, zero.
    const own = table === 'portfolios' || table === 'ledger_entries' ? 1 : 0;
    const rows = Array.isArray(asBob.body) ? asBob.body.length : -1;
    record(
      `${table}: Bob vê apenas o que é dele`,
      rows === own,
      rows === own ? `${rows} linha(s), esperado ${own}` : `viu ${rows}, esperado ${own}`,
    );
  }

  const bobOnAlice = await api(`/rest/v1/portfolios?select=*&id=eq.${alicePortfolioId}`, {
    token: bob,
  });
  expectEmpty('portfolios: filtro direto pelo id da Alice não retorna nada', bobOnAlice);

  const profilesAsBob = await api('/rest/v1/profiles?select=*', { token: bob });
  record(
    'profiles: Bob vê só o próprio perfil',
    Array.isArray(profilesAsBob.body) && profilesAsBob.body.length === 1,
    `${profilesAsBob.body?.length ?? '?'} linha(s)`,
  );

  console.log('\nEscrita — nenhuma tabela de dinheiro aceita escrita direta:');
  expectNothingWritten(
    'portfolios: UPDATE de saldo pelo dono não altera nada',
    await api(`/rest/v1/portfolios?id=eq.${alicePortfolioId}`, {
      token: alice,
      method: 'PATCH',
      body: { cash_balance: 999999 },
      prefer: 'return=representation',
    }),
  );
  expectDenied(
    'orders: INSERT direto é recusado',
    await api('/rest/v1/orders', {
      token: alice,
      method: 'POST',
      body: { portfolio_id: alicePortfolioId, ticker, side: 'BUY', quantity: 1, status: 'FILLED' },
    }),
  );
  expectDenied(
    'ledger_entries: INSERT direto é recusado',
    await api('/rest/v1/ledger_entries', {
      token: alice,
      method: 'POST',
      body: { portfolio_id: alicePortfolioId, kind: 'DEPOSIT', amount: 1000, description: 'x' },
    }),
  );
  expectDenied(
    'positions: INSERT direto é recusado',
    await api('/rest/v1/positions', {
      token: alice,
      method: 'POST',
      body: { portfolio_id: alicePortfolioId, ticker, quantity: 100, avg_price: 1 },
    }),
  );
  expectNothingWritten(
    'profiles: promover-se a admin não altera nada',
    await api('/rest/v1/profiles', {
      token: alice,
      method: 'PATCH',
      body: { is_admin: true },
      prefer: 'return=representation',
    }),
  );
  expectNothingWritten(
    'assets: usuário comum não altera o catálogo',
    await api(`/rest/v1/assets?ticker=eq.${ticker}`, {
      token: alice,
      method: 'PATCH',
      body: { is_tradable: false },
      prefer: 'return=representation',
    }),
  );
  expectNothingWritten(
    'quotes: usuário comum não escreve preço',
    await api(`/rest/v1/quotes?ticker=eq.${ticker}`, {
      token: alice,
      method: 'PATCH',
      body: { price: 0.01 },
      prefer: 'return=representation',
    }),
  );

  console.log('\nRPCs privilegiadas — não devem ser chamáveis pelo cliente:');
  expectDenied(
    'execute_order_tx: não exposta',
    await api('/rest/v1/rpc/execute_order_tx', {
      token: alice,
      method: 'POST',
      body: {
        p_user_id: alicePortfolioId,
        p_ticker: ticker,
        p_side: 'BUY',
        p_quantity: 1,
        p_reference_price: 0.01,
        p_executed_price: 0.01,
        p_gross_amount: 0.01,
        p_fee_amount: 0,
        p_tax_amount: 0,
        p_net_amount: -0.01,
        p_realized_pnl: null,
        p_new_avg_price: 0.01,
      },
    }),
  );
  expectDenied(
    'apply_fixed_income_tx: não exposta',
    await api('/rest/v1/rpc/apply_fixed_income_tx', {
      token: alice,
      method: 'POST',
      body: { p_user_id: alicePortfolioId, p_product_id: alicePortfolioId, p_principal: 1 },
    }),
  );
  expectDenied(
    'open_season: usuário comum recebe NOT_ADMIN',
    await api('/rest/v1/rpc/open_season', {
      token: alice,
      method: 'POST',
      body: { p_name: 'Invasao', p_initial_cash: 1000000 },
    }),
  );

  const overview = await api('/rest/v1/rpc/admin_overview', { token: alice, method: 'POST' });
  record(
    'admin_overview: devolve nulo para quem não é admin',
    overview.body === null,
    overview.body === null ? undefined : `retornou ${JSON.stringify(overview.body).slice(0, 60)}`,
  );

  console.log('\nAnônimo — sem token, nada de dados de usuário:');
  for (const table of [...ownedTables, 'profiles', 'leaderboard', 'sync_runs']) {
    expectDenied(`${table}: anônimo é recusado`, await api(`/rest/v1/${table}?select=*`));
  }

  console.log('\nDados públicos de mercado continuam legíveis por quem está logado:');
  const quotes = await api('/rest/v1/quotes?select=ticker,price&limit=1', { token: bob });
  record(
    'quotes: leitura autenticada funciona (controle positivo)',
    Array.isArray(quotes.body) && quotes.body.length === 1,
    `${quotes.body?.length ?? '?'} linha(s)`,
  );

  console.log('\nDireitos do titular:');
  const exported = await api('/rest/v1/rpc/export_my_data', { token: alice, method: 'POST' });
  const hasOwnData = exported.body?.account?.email === USERS.alice.email;
  record('export_my_data: devolve os dados do chamador', hasOwnData);
  record(
    'export_my_data: não expõe o campo is_admin',
    exported.body?.profile !== undefined && !('is_admin' in (exported.body.profile ?? {})),
  );

  const deleted = await api('/rest/v1/rpc/delete_my_account', { token: bob, method: 'POST' });
  record(
    'delete_my_account: aceita a chamada do próprio usuário',
    deleted.status < 400,
    `HTTP ${deleted.status}`,
  );

  const afterDelete = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: USERS.bob,
  });
  record(
    'delete_my_account: login do Bob deixa de funcionar',
    afterDelete.status >= 400,
    `HTTP ${afterDelete.status}`,
  );

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(
    `${String(results.length - failed.length)}/${String(results.length)} verificações passaram`,
  );

  if (failed.length > 0) {
    console.log('\nFALHAS:');
    for (const item of failed) console.log(`  ✗ ${item.name} — ${item.detail ?? ''}`);
  }

  console.log(`\nUsuário de auditoria remanescente: ${USERS.alice.email}`);
  console.log('Apague-o em Authentication → Users.');

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nAuditoria abortada:', error.message);
  process.exit(2);
});
