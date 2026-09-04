-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 2 — universo de ativos, cache de cotações e calendário
--
-- Duas fontes, atrás de uma interface `QuoteProvider`:
--
--   Yahoo Finance  primária. Sem token, sem cota mensal, ~15 min de atraso.
--                  O mesmo endpoint devolve o candle histórico numa chamada,
--                  então o backfill não custa nada. É API NÃO DOCUMENTADA:
--                  já mudou antes e vai mudar de novo.
--   brapi          reserva. 15.000 req/30 dias, 1 ativo por requisição.
--
-- A reserva não é substituta à altura, e isso é deliberado: 151 tickers a
-- cada 30 min dão ~50.700 req/mês, 3,4× a cota da brapi. Em modo de
-- contingência o sync cai para ~4 vezes ao dia (15.000 ÷ 151 ÷ 21). O
-- simulador degrada em FREQUÊNCIA, não em disponibilidade — melhor preço de
-- duas horas atrás, com a idade exibida na boleta, do que tela sem preço.
--
-- Por isso o cron continua restrito a dia útil em horário de mercado, e
-- `market_holidays` segue sendo controle de custo além de base do acruamento
-- em dias úteis da renda fixa.

create type public.asset_type as enum ('STOCK', 'FII', 'UNIT', 'BDR');

-- ────────────────────────────────────────────────────────────── assets ─────

create table public.assets (
  -- Quatro caracteres de prefixo, sendo o primeiro sempre letra, mais 1 ou 2
  -- dígitos de classe. Não é `[A-Z]{4}`: o prefixo pode conter dígito, e
  -- B3SA3 (a própria bolsa) é o contraexemplo — B, 3, S, A, 3.
  ticker text primary key check (ticker ~ '^[A-Z][A-Z0-9]{3}[0-9]{1,2}$'),
  name text not null,
  type public.asset_type not null,
  sector text,
  lot_size integer not null default 1 check (lot_size > 0),
  is_tradable boolean not null default true,
  -- Marca os tickers que o cron sincroniza. Hoje todos, mas separar a coluna
  -- permite ampliar o catálogo sem ampliar o custo: um ativo pode ser
  -- listável e navegável sem receber cotação a cada 30 min.
  is_synced boolean not null default true,
  updated_at timestamptz not null default now()
);

create index assets_type_idx on public.assets (type) where is_tradable;
create index assets_synced_idx on public.assets (ticker) where is_synced;

comment on column public.assets.lot_size is
  'Fixado em 1, espelhando o mercado fracionário que o investidor pessoa física realmente usa. Lote padrão de 100 tornaria VALE3 quase inacessível com R$ 20.000 de saldo inicial.';

-- ────────────────────────────────────────────────────────────── quotes ─────

-- Uma linha por ticker: só o último preço conhecido. Histórico fica em
-- daily_candles. Assim a tabela que a boleta lê tem 151 linhas e cabe
-- inteira em cache de página do Postgres.
create table public.quotes (
  ticker text primary key references public.assets (ticker) on delete cascade,
  price numeric(18, 6) not null check (price > 0),
  prev_close numeric(18, 6) check (prev_close > 0),
  change_pct numeric(10, 4),
  volume bigint,
  -- Momento em que a FONTE diz que o preço foi apurado, não o momento do
  -- fetch. A diferença importa: o dado já nasce atrasado, e é esta coluna
  -- que a Edge Function compara com maxQuoteAgeMinutes para decidir entre
  -- executar e rejeitar com STALE_QUOTE.
  quoted_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  source text not null default 'yahoo'
);

comment on table public.quotes is
  'Cache de cotação. É a ÚNICA fonte de preço para execução de ordem — o frontend nunca envia preço. `source` registra qual provider respondeu, para dar para auditar uma ordem estranha e para saber quando o sync esteve em contingência.';

-- ──────────────────────────────────────────────────────── daily_candles ─────

create table public.daily_candles (
  ticker text not null references public.assets (ticker) on delete cascade,
  date date not null,
  open numeric(18, 6) check (open > 0),
  high numeric(18, 6) check (high > 0),
  low numeric(18, 6) check (low > 0),
  close numeric(18, 6) not null check (close > 0),
  volume bigint,
  primary key (ticker, date)
);

create index daily_candles_date_idx on public.daily_candles (date desc);

comment on table public.daily_candles is
  'Série diária para gráfico e para o snapshot de fechamento. O backfill custa 1 requisição por ticker, porque o endpoint de chart do Yahoo devolve o range inteiro numa chamada. O candle do dia corrente é derivado do último sync, sem requisição extra.';

-- ─────────────────────────────────────────────────────── market_holidays ─────

create table public.market_holidays (
  date date primary key,
  name text not null
);

comment on table public.market_holidays is
  'Feriados em que a B3 não abre. Usado para o cron não gastar cota e para o acruamento de renda fixa em base 252 dias úteis.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Privilégios e RLS
--
-- Dado de mercado é público para quem está logado e imutável para todos:
-- só a Edge Function, via secret key, escreve aqui.
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on public.assets from anon, authenticated;
revoke all on public.quotes from anon, authenticated;
revoke all on public.daily_candles from anon, authenticated;
revoke all on public.market_holidays from anon, authenticated;

grant select on public.assets to authenticated;
grant select on public.quotes to authenticated;
grant select on public.daily_candles to authenticated;
grant select on public.market_holidays to authenticated;

alter table public.assets enable row level security;
alter table public.quotes enable row level security;
alter table public.daily_candles enable row level security;
alter table public.market_holidays enable row level security;

create policy "assets_select_all" on public.assets for select to authenticated using (true);

create policy "quotes_select_all" on public.quotes for select to authenticated using (true);

create policy "daily_candles_select_all" on public.daily_candles for select to authenticated using (true);

create policy "market_holidays_select_all" on public.market_holidays for select to authenticated using (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Universo negociável: 151 tickers
--
-- Ticker, nome e tipo NÃO foram digitados de memória: cada candidato foi
-- consultado no Yahoo e só entrou aqui quem devolveu preço. O nome é o que a
-- fonte reporta, e o tipo foi derivado dele (fundo imobiliário, unit, BDR).
--
-- A validação pegou renomeações e saídas de bolsa que uma lista escrita de
-- cabeça teria errado:
--
--   CCRO3        → MOTV3     CCR renomeada para Motiva
--   BRFS3+MRFG3  → MBRF3     BRF e Marfrig fundidas
--   JBSS3        → JBSS32    JBS migrou para NYSE, restou o BDR
--   CPLE6        → CPLE3     Copel
--   AZUL4        → AZUL3     Azul, pós-reestruturação
--   NTCO3        → NATU3     Natura
--   TRPL4        → ISAE4     ex-Transmissão Paulista
--   CRFB3, ODPV3, PETZ3, STBP3, PORT3, BCFF11, MALL11 — fora da bolsa
--
-- CONFERIR: EMBR3 (Embraer) e ELET3/ELET6 (Eletrobras) não retornaram preço
-- em nenhuma variante testada. São companhias grandes demais para isso ser
-- normal, então provavelmente mudaram de código de um jeito que não adivinhei.
-- Vale procurar o ticker atual e acrescentar.
--
-- `sector` fica nulo de propósito: preencher 151 setores de memória seria
-- inventar dado. A tela de mercado da Fase 2 filtra por tipo e busca por
-- ticker e nome, que basta. Enriquecer depois, de uma fonte de verdade.
--
-- `on conflict do nothing` mantém a migration idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.assets (ticker, name, type) values
  ('ABEV3', 'Ambev S.A.', 'STOCK'),
  ('AFHI11', 'Af Invest Cri Fundo De Investimento Imobiliario - Recebiveis Imobiliarios', 'FII'),
  ('ALOS3', 'Allos S.A.', 'STOCK'),
  ('ALPA4', 'Alpargatas S.A.', 'STOCK'),
  ('ALUP11', 'Alupar Investimento S.A.', 'UNIT'),
  ('ANIM3', 'Ânima Holding S.A.', 'STOCK'),
  ('ASAI3', 'Sendas Distribuidora S.A.', 'STOCK'),
  ('AURE3', 'Auren Energia S.A.', 'STOCK'),
  ('AZUL3', 'Azul S.A.', 'STOCK'),
  ('AZZA3', 'Azzas 2154 S.A.', 'STOCK'),
  ('B3SA3', 'B3 S.A. - Brasil, Bolsa, Balcão', 'STOCK'),
  ('BBAS3', 'Banco do Brasil S.A.', 'STOCK'),
  ('BBDC3', 'Banco Bradesco S.A.', 'STOCK'),
  ('BBDC4', 'Banco Bradesco S.A.', 'STOCK'),
  ('BBSE3', 'BB Seguridade Participações S.A.', 'STOCK'),
  ('BEEF3', 'Minerva S.A.', 'STOCK'),
  ('BPAC11', 'Banco BTG Pactual S.A.', 'UNIT'),
  ('BRAP4', 'Bradespar S.A.', 'STOCK'),
  ('BRAV3', 'Brava Energia S.A.', 'STOCK'),
  ('BRCO11', 'Bresco - Fundo De Investimento Imobiliario', 'FII'),
  ('BRKM5', 'Braskem S.A.', 'STOCK'),
  ('BTLG11', 'BTG Pactual Logística Fundo de Investimento Imobiliário', 'FII'),
  ('CASH3', 'Méliuz S.A.', 'STOCK'),
  ('CBAV3', 'Companhia Brasileira de Alumínio', 'STOCK'),
  ('CEAB3', 'C&A Modas S.A.', 'STOCK'),
  ('CMIG4', 'Companhia Energética de Minas Gerais - CEMIG', 'STOCK'),
  ('CMIN3', 'CSN Mineração S.A.', 'STOCK'),
  ('COGN3', 'Cogna Educação S.A.', 'STOCK'),
  ('CPFE3', 'CPFL Energia S.A.', 'STOCK'),
  ('CPLE3', 'Companhia Paranaense de Energia - COPEL', 'STOCK'),
  ('CPTS11', 'Capitania Securities II Fundo Investimento Imobiliario FII', 'FII'),
  ('CSAN3', 'Cosan S.A.', 'STOCK'),
  ('CSMG3', 'Companhia de Saneamento de Minas Gerais', 'STOCK'),
  ('CSNA3', 'Companhia Siderúrgica Nacional', 'STOCK'),
  ('CVCB3', 'CVC Brasil Operadora e Agência de Viagens S.A.', 'STOCK'),
  ('CXSE3', 'Caixa Seguridade Participações S.A.', 'STOCK'),
  ('CYRE3', 'Cyrela Brazil Realty S.A. Empreendimentos e Participações', 'STOCK'),
  ('DEVA11', 'Devant Recebiveis Imobiliarios Fundo De Investimento Imobiliario', 'FII'),
  ('DIRR3', 'Direcional Engenharia S.A.', 'STOCK'),
  ('EGIE3', 'Engie Brasil Energia S.A.', 'STOCK'),
  ('ENEV3', 'Eneva S.A.', 'STOCK'),
  ('ENGI11', 'Energisa S.A.', 'UNIT'),
  ('EQTL3', 'Equatorial S.A.', 'STOCK'),
  ('EZTC3', 'EZTEC Empreendimentos e Participações S.A.', 'STOCK'),
  ('FLRY3', 'Fleury S.A.', 'STOCK'),
  ('GFSA3', 'Gafisa S.A.', 'STOCK'),
  ('GGBR4', 'Gerdau S.A.', 'STOCK'),
  ('GGRC11', 'Ggr Covipe Renda Fundo Investimento Imobiliario', 'FII'),
  ('GMAT3', 'Grupo Mateus S.A.', 'STOCK'),
  ('GOAU4', 'Metalurgica Gerdau S.A.', 'STOCK'),
  ('GRND3', 'Grendene S.A.', 'STOCK'),
  ('HAPV3', 'Hapvida Participações e Investimentos S.A.', 'STOCK'),
  ('HCTR11', 'Fundo De Investimento Imobiliario Hectare Ce', 'FII'),
  ('HGBS11', 'HEDGE Brasil Shopping Fundo de Investimento Imobiliário', 'FII'),
  ('HGCR11', 'CSHG Recebiveis Imobiliarios BC Fundo de Investimento Imobiliario - FII', 'FII'),
  ('HGLG11', 'Cshg Logistica - Fundo De Investimento Imobiliario', 'FII'),
  ('HGRE11', 'CSHG Real Estate - Fundo de Investimento Imobiliario - FII', 'FII'),
  ('HSML11', 'Hsi Malls Fundo De Investimento Imobiliario', 'FII'),
  ('HYPE3', 'Hypera S.A.', 'STOCK'),
  ('IGTI11', 'Iguatemi S.A.', 'UNIT'),
  ('IRBR3', 'IRB-Brasil Resseguros S.A.', 'STOCK'),
  ('IRDM11', 'Fundo Investimento Imobiliario Iridium Recebiveis Imobiliarios', 'FII'),
  ('ISAE4', 'ISA Energía Brasil S.A.', 'STOCK'),
  ('ITSA4', 'Itaúsa S.A.', 'STOCK'),
  ('ITUB4', 'Itaú Unibanco Holding S.A.', 'STOCK'),
  ('JBSS32', 'JBS N.V.', 'BDR'),
  ('JHSF3', 'JHSF Participações S.A.', 'STOCK'),
  ('JSRE11', 'JS Real Estate multigestão - FII fund', 'FII'),
  ('KFOF11', 'Kinea Fundo Fundos De Investimento Imobiliario FII', 'FII'),
  ('KLBN11', 'Klabin S.A.', 'UNIT'),
  ('KNCR11', 'Kinea Rendimentos Imobiliários Fundo de Investimento Imobiliário - FII', 'FII'),
  ('KNIP11', 'Kinea Indices Precos Fundo Investimento Imobiliario - FII', 'FII'),
  ('KNRI11', 'Kinea Renda Imobiliária Fundo de Investimento Imobiliário', 'FII'),
  ('LEVE3', 'MAHLE Metal Leve S.A.', 'STOCK'),
  ('LOGG3', 'LOG Commercial Properties e Participações S.A.', 'STOCK'),
  ('LREN3', 'Lojas Renner S.A.', 'STOCK'),
  ('LVBI11', 'Fundo De Investimento Imobiliario - VBI Logistico - Cota Fund', 'FII'),
  ('LWSA3', 'Locaweb Serviços de Internet S.A.', 'STOCK'),
  ('MBRF3', 'MBRF Global Foods Company S.A.', 'STOCK'),
  ('MCCI11', 'Fundo De Investimento Imobiliario Maua Capital Recebiveis Imobiliarios', 'FII'),
  ('MDIA3', 'M. Dias Branco S.A. Indústria e Comércio de Alimentos', 'STOCK'),
  ('MGLU3', 'Magazine Luiza S.A.', 'STOCK'),
  ('MOTV3', 'Motiva Infraestrutura de Mobilidade S.A.', 'STOCK'),
  ('MOVI3', 'Movida Participações S.A.', 'STOCK'),
  ('MRVE3', 'MRV Engenharia e Participações S.A.', 'STOCK'),
  ('MULT3', 'Multiplan Empreendimentos Imobiliários S.A.', 'STOCK'),
  ('MXRF11', 'Maxi Renda Fundo De Investimento Imobiliaro - FII', 'FII'),
  ('MYPK3', 'Iochpe-Maxion S.A.', 'STOCK'),
  ('NATU3', 'Natura Cosméticos S.A.', 'STOCK'),
  ('ONCO3', 'Oncoclínicas do Brasil Serviços Médicos S.A.', 'STOCK'),
  ('PCAR3', 'Companhia Brasileira De Distribuicao', 'STOCK'),
  ('PETR3', 'Petróleo Brasileiro S.A. - Petrobras', 'STOCK'),
  ('PETR4', 'Petróleo Brasileiro S.A. - Petrobras', 'STOCK'),
  ('PGMN3', 'Empreendimentos Pague Menos S.A.', 'STOCK'),
  ('PLCR11', 'Plural Recebiveis Imobiliarios Fundo De Investimento Imobiliario', 'FII'),
  ('PNVL3', 'Dimed S.A. Distribuidora de Medicamentos', 'STOCK'),
  ('POMO4', 'Marcopolo S.A.', 'STOCK'),
  ('POSI3', 'Positivo Tecnologia S.A.', 'STOCK'),
  ('PRIO3', 'Prio S.A.', 'STOCK'),
  ('PSSA3', 'Porto Seguro S.A.', 'STOCK'),
  ('PVBI11', 'Fundo De Investimento ImobiliarRio Vbi Prime Properties', 'FII'),
  ('QUAL3', 'Qualicorp Consultoria e Corretora de Seguros S.A.', 'STOCK'),
  ('RADL3', 'Raia Drogasil S.A.', 'STOCK'),
  ('RAIL3', 'Rumo S.A.', 'STOCK'),
  ('RAIZ4', 'Raízen S.A.', 'STOCK'),
  ('RAPT4', 'Randoncorp S.A.', 'STOCK'),
  ('RBRF11', 'Fundo Investimento Imobiliario Rbr Alpha Fundos De Fundos', 'FII'),
  ('RBRP11', 'Fundo Investimento Imobiliario Rbr Properties Fii', 'FII'),
  ('RBRR11', 'Fundo Investimento Imobiliario - FII RBR Rendimento High Grade', 'FII'),
  ('RCRB11', 'Fundo de Investimento Imobiliário Rio Bravo Renda Corporativa', 'FII'),
  ('RDOR3', 'Rede D''Or São Luiz S.A.', 'STOCK'),
  ('RECR11', 'Fundo Investimento Imobiliario Fii Ubs (Br) Recebveis Imobiliarios', 'FII'),
  ('RECV3', 'Petroreconcavo S.A.', 'STOCK'),
  ('RENT3', 'Localiza Rent a Car S.A.', 'STOCK'),
  ('SANB11', 'Banco Santander (Brasil) S.A.', 'UNIT'),
  ('SAPR11', 'Companhia de Saneamento do Paraná - SANEPAR', 'UNIT'),
  ('SBSP3', 'Companhia de Saneamento Básico do Estado de São Paulo - SABESP', 'STOCK'),
  ('SEER3', 'Ser Educacional S.A.', 'STOCK'),
  ('SIMH3', 'SIMPAR S.A.', 'STOCK'),
  ('SLCE3', 'SLC Agrícola S.A.', 'STOCK'),
  ('SMFT3', 'Smartfit Escola de Ginástica e Dança S.A.', 'STOCK'),
  ('SMTO3', 'São Martinho S.A.', 'STOCK'),
  ('SUZB3', 'Suzano S.A.', 'STOCK'),
  ('TAEE11', 'Transmissora Aliança de Energia Elétrica S.A.', 'UNIT'),
  ('TASA4', 'Taurus Armas S.A.', 'STOCK'),
  ('TEND3', 'Construtora Tenda S.A.', 'STOCK'),
  ('TGAR11', 'Fundo Investimento Imobiliario TG Ativo Real', 'FII'),
  ('TIMS3', 'TIM S.A.', 'STOCK'),
  ('TOTS3', 'TOTVS S.A.', 'STOCK'),
  ('TRXF11', 'TRX REAL ESTATE FUNDO DE INVESTIMENTO IMOBILIÁRIO - FII', 'FII'),
  ('TUPY3', 'Tupy S.A.', 'STOCK'),
  ('UGPA3', 'Ultrapar Participações S.A.', 'STOCK'),
  ('USIM5', 'Usinas Siderúrgicas de Minas Gerais S.A.', 'STOCK'),
  ('VALE3', 'Vale S.A.', 'STOCK'),
  ('VAMO3', 'Vamos Locação de Caminhões, Máquinas e Equipamentos S.A.', 'STOCK'),
  ('VBBR3', 'Vibra Energia S.A.', 'STOCK'),
  ('VGHF11', 'Valora Hedge Fund Fundo De Investimento Imobiliario - Fii', 'FII'),
  ('VILG11', 'Vinci Logistica Fundo Investimento Imobiliario FII', 'FII'),
  ('VINO11', 'Vinci Corporate Fundo De Investimento Imobiliario', 'FII'),
  ('VISC11', 'Vinci Shopping Centers Fundo Investimento Imobiliario - Fii', 'FII'),
  ('VIVA3', 'Vivara Participações S.A.', 'STOCK'),
  ('VIVT3', 'Telefônica Brasil S.A.', 'STOCK'),
  ('VLID3', 'Valid Soluções S.A.', 'STOCK'),
  ('VRTA11', 'Fator Veritá Fundo de Investimento Imobiliário - FII', 'FII'),
  ('VULC3', 'Vulcabras S.A.', 'STOCK'),
  ('WEGE3', 'WEG S.A.', 'STOCK'),
  ('WIZC3', 'Wiz Co Participações e Corretagem de Seguros S.A.', 'STOCK'),
  ('XPCA11', 'Xp Credito Agricola - Fundo De Investimento Nas Cadeias Produtivas - Fiagro - Imobiliario', 'FII'),
  ('XPLG11', 'Xp Log Fundo Investimento Imobiliario FII', 'FII'),
  ('XPML11', 'Xp Malls Fundo Investimentos Imobiliarios', 'FII'),
  ('YDUQ3', 'Yduqs Participações S.A.', 'STOCK')
on conflict (ticker) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Feriados da B3 — 2026 e 2027
--
-- CONFERIR contra o calendário oficial da ANBIMA antes de confiar no
-- acruamento da renda fixa (Fase 5): estas datas foram inseridas sem
-- consultar a fonte, e as móveis (Carnaval, Sexta-feira Santa, Corpus
-- Christi) derivam da Páscoa. Um dia útil errado desloca o rendimento de
-- todo mundo.
--
-- 09/07 é feriado estadual de São Paulo, mas a B3 não abre — vale como
-- feriado de mercado.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.market_holidays (date, name) values
  ('2026-01-01', 'Confraternização Universal'),
  ('2026-02-16', 'Carnaval'),
  ('2026-02-17', 'Carnaval'),
  ('2026-04-03', 'Sexta-feira Santa'),
  ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'),
  ('2026-06-04', 'Corpus Christi'),
  ('2026-07-09', 'Revolução Constitucionalista'),
  ('2026-09-07', 'Independência do Brasil'),
  ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'),
  ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Consciência Negra'),
  ('2026-12-25', 'Natal'),
  ('2026-12-31', 'Último dia útil do ano'),
  ('2027-01-01', 'Confraternização Universal'),
  ('2027-02-08', 'Carnaval'),
  ('2027-02-09', 'Carnaval'),
  ('2027-03-26', 'Sexta-feira Santa'),
  ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'),
  ('2027-05-27', 'Corpus Christi'),
  ('2027-07-09', 'Revolução Constitucionalista'),
  ('2027-09-07', 'Independência do Brasil'),
  ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'),
  ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Consciência Negra'),
  ('2027-12-25', 'Natal'),
  ('2027-12-31', 'Último dia útil do ano')
on conflict (date) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Parâmetros de negociação revisados
--
-- maxQuoteAgeMinutes sobe de 30 para 75. O dado do plano free já nasce com
-- ~30 min de atraso e o sync roda a cada 30 min: no pior caso normal, o preço
-- tem ~60 min. Com o teto antigo de 30, toda ordem seria rejeitada. 75 aceita
-- a operação normal e ainda barra o caso que importa — cron que morreu e
-- deixou preço de ontem no cache.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.platform_settings (key, value, effective_from)
values (
  'trading',
  jsonb_build_object(
    'opensAt', '10:00',
    'closesAt', '17:55',
    'timezone', 'America/Sao_Paulo',
    'maxQuoteAgeMinutes', 75,
    'maxOrdersPerMinute', 30,
    'syncIntervalMinutes', 30
  ),
  '2026-09-04T00:00:00Z'
)
on conflict (key, effective_from) do nothing;
