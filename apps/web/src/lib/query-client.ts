import { QueryClient } from '@tanstack/react-query';

/**
 * Defaults pensados para o custo do free tier: cotação já vem com atraso de
 * ~15 min, então revalidar a cada foco de janela só gasta requisição sem
 * trazer informação nova.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      // Ordem não se repete sozinha: uma retry automática poderia duplicar
      // uma compra que na verdade já foi executada.
      retry: 0,
    },
  },
});
