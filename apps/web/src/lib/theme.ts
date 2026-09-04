export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'm8invest.theme';

/**
 * Tema do usuário.
 *
 * A classe `dark` é aplicada no `<html>` por um script inline no index.html,
 * ANTES do primeiro paint — sem isso, quem escolheu claro veria um flash
 * escuro em cada carregamento, porque o React só monta depois do CSS.
 *
 * O acesso ao localStorage é envolvido em try/catch: em janela privada, ou
 * com armazenamento de site bloqueado, o próprio getter lança. Preferência de
 * tema não é motivo para a tela inteira cair.
 */
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Sem acesso ao armazenamento: cai no padrão.
  }
  return 'system';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);

  // A classe é o mecanismo: o index.css declara `@custom-variant dark` sobre
  // ela. O atributo `data-theme` acompanha só como informação — permite ao
  // CSS distinguir escolha explícita de "seguir o sistema" se algum dia
  // precisar, e torna o estado legível no inspetor.
  root.classList.toggle('dark', dark);
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function writeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Não persistiu; o tema vale para esta sessão e pronto.
  }
  applyTheme(theme);
}
