import { Route, Routes } from 'react-router';

import { HealthPage } from '@/routes/HealthPage';
import { NotFoundPage } from '@/routes/NotFoundPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HealthPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
