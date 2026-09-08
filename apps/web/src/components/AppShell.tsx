import { useQuery } from '@tanstack/react-query';
import { LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';

import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/useAuth';
import { getSupabaseClient } from '@/lib/supabase';
import { applyTheme, readTheme, writeTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/app', label: 'Carteira', end: true },
  { to: '/app/mercado', label: 'Mercado', end: false },
  { to: '/app/renda-fixa', label: 'Renda fixa', end: false },
  { to: '/app/ranking', label: 'Ranking', end: false },
];

const THEMES: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Escuro', Icon: Moon },
  { value: 'system', label: 'Sistema', Icon: Monitor },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
  );

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  // Reaplica quando o sistema muda e a escolha é "Sistema". Sem isto, quem
  // deixa no automático só vê a troca no próximo carregamento.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readTheme() === 'system') applyTheme('system');
    };

    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {THEMES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={`Tema ${label.toLowerCase()}`}
          aria-pressed={theme === value}
          onClick={() => {
            setTheme(value);
            writeTheme(value);
          }}
          className={cn(
            'rounded p-1.5 transition-colors',
            theme === value
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();

  // O link do painel só aparece para admin. A rota também barra, mas um item
  // de menu que sempre leva a "sem permissão" é ruído para todos os outros.
  const admin = useQuery({
    queryKey: ['is-admin'],
    queryFn: async () => {
      const { data } = await getSupabaseClient().rpc('is_admin');
      return data === true;
    },
    staleTime: 10 * 60_000,
  });

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex items-center gap-3 py-3">
            <Link to="/app" aria-label="M8.Invest, início">
              <Logo />
            </Link>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-sm text-muted-foreground lg:inline">{user?.email}</span>
              <ThemeToggle />
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                <LogOut aria-hidden />
                <span className="sr-only sm:not-sr-only">Sair</span>
              </Button>
            </div>
          </div>

          {/* Linha rolável em vez de menu hamburguer: com cinco itens curtos,
              arrastar é mais rápido que abrir e fechar um painel, e não
              depende de JavaScript para funcionar. */}
          <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {item.label}
              </NavLink>
            ))}

            {admin.data === true ? (
              <NavLink to="/app/admin" className={navClass}>
                Admin
              </NavLink>
            ) : null}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {children}

        <footer className="mt-12 space-y-1 text-xs text-muted-foreground">
          <p>
            Simulação com fins educacionais. Cotações com atraso. Não constitui recomendação de
            investimento.
          </p>
          <p className="flex gap-3">
            <Link to="/app/conta" className="underline underline-offset-2 hover:text-foreground">
              Sua conta
            </Link>
            <Link to="/termos" className="underline underline-offset-2 hover:text-foreground">
              Termos e privacidade
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
