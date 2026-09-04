import { useEffect, useState } from 'react';

/**
 * Relógio reativo, em epoch ms.
 *
 * Existe porque chamar `Date.now()` durante o render é impuro: o valor muda
 * entre renders sem que nada tenha mudado de fato, e o que depende dele
 * congela até o próximo render por outro motivo. Numa tela que fica aberta a
 * sessão inteira, isso significa um aviso de "cotação desatualizada" que
 * nunca aparece — ou que aparece e nunca sai.
 *
 * O relógio é lido no inicializador preguiçoso do `useState`, não no corpo do
 * render nem sincronamente dentro do efeito: o inicializador roda uma única
 * vez na montagem, o que mantém o render idempotente e evita o render em
 * cascata que um `setState` imediato no efeito provocaria.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);

  return now;
}
