import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    // O bundle vai para um CDN estático na Netlify; sourcemap facilita debugar
    // erro de produção sem expor código-fonte de servidor (não existe nenhum).
    sourcemap: true,

    // ~595 kB minificados / ~173 kB gzip, quase tudo em react-dom,
    // supabase-js e zod — dependências que a tela de login também precisa,
    // então dividir não reduz o primeiro carregamento. O limite fica acima do
    // patamar atual para o aviso voltar a significar algo: se disparar de
    // novo, é porque entrou peso novo de verdade. Orçamento de bundle é
    // assunto da Fase 8.
    chunkSizeWarningLimit: 650,
  },
});
