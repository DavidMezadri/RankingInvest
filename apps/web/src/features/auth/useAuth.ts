import { useContext } from 'react';

import { AuthContext, type AuthState } from '@/features/auth/context';

export function useAuth(): AuthState {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  }

  return context;
}
