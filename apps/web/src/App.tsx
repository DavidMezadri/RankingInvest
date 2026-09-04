import { Loader2 } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { HealthPage } from '@/routes/HealthPage';
import { LoginPage } from '@/routes/LoginPage';
import { NotFoundPage } from '@/routes/NotFoundPage';
import { RequireAuth } from '@/routes/RequireAuth';

/**
 * A área logada é carregada sob demanda, e agora o split paga: o
 * lightweight-charts vive nesta subárvore, e quem só abre o login não baixa
 * a biblioteca de gráfico.
 */
const DashboardPage = lazy(() =>
  import('@/routes/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);
const MarketPage = lazy(() =>
  import('@/routes/MarketPage').then((module) => ({ default: module.MarketPage })),
);
const AssetPage = lazy(() =>
  import('@/routes/AssetPage').then((module) => ({ default: module.AssetPage })),
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
      <Route
        path="/app/mercado"
        element={
          <RequireAuth>
            <Suspense fallback={<RouteFallback />}>
              <MarketPage />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        path="/app/ativo/:ticker"
        element={
          <RequireAuth>
            <Suspense fallback={<RouteFallback />}>
              <AssetPage />
            </Suspense>
          </RequireAuth>
        }
      />

      <Route path="/diagnostico" element={<HealthPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
