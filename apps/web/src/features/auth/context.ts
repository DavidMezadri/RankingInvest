import type { Session, User } from '@supabase/supabase-js';
import { createContext } from 'react';

export type AuthState = {
  session: Session | null;
  user: User | null;
  /** Verdadeiro até a sessão persistida ser restaurada do storage. */
  loading: boolean;
  signOut: () => Promise<void>;
};

/**
 * Fica em arquivo próprio para o provider e o hook poderem morar em módulos
 * separados — o `react-refresh/only-export-components` reclama de arquivo que
 * exporta componente e não-componente ao mesmo tempo.
 */
export const AuthContext = createContext<AuthState | null>(null);
