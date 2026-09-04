import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import App from '@/App';
import { AuthProvider } from '@/features/auth/AuthProvider';
import '@/index.css';
import { envResult } from '@/lib/env';
import { queryClient } from '@/lib/query-client';
import { HealthPage } from '@/routes/HealthPage';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Elemento #root não encontrado — index.html foi alterado?');
}

// A checagem de ambiente precisa ficar ACIMA do AuthProvider: é ele quem cria
// o client do Supabase, e sem URL e chave válidas isso lança. Dentro do App
// seria tarde — o provider já teria quebrado.
const tree = envResult.ok ? (
  // QueryClientProvider por fora do AuthProvider: o provider limpa o cache na
  // troca de usuário, então depende do queryClient já existir.
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
) : (
  <QueryClientProvider client={queryClient}>
    <HealthPage />
  </QueryClientProvider>
);

createRoot(rootElement).render(<StrictMode>{tree}</StrictMode>);
