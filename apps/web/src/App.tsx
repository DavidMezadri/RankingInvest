import { Loader2 } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { HealthPage } from '@/routes/HealthPage';
import { LoginPage } from '@/routes/LoginPage';
import { NotFoundPage } from '@/routes/NotFoundPage';
import { RequireAuth } from '@/routes/RequireAuth';

/**
 * A área logada é carregada sob demanda. Hoje o ganho é pequeno — o peso está
 * em react, supabase-js e zod, que a tela de login também precisa. O motivo de
 * já estabelecer a fronteira aqui é a Fase 2/3: lightweight-charts e recharts
 * entram nesta subárvore, e aí quem só abre o login não paga por eles.
 */
const DashboardPage = lazy(() =>
  import('@/routes/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);

function RouteFallback() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Carregando" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <Suspense fallback={<RouteFallback />}>
              <DashboardPage />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route path="/diagnostico" element={<HealthPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
