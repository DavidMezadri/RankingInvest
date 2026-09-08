import { formatDateTime } from '@m8invest/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/useAuth';
import { fetchLeaderboard, updateDisplayName } from '@/features/leaderboard/api';
import { getSupabaseClient } from '@/lib/supabase';

const DELETE_PHRASE = 'EXCLUIR';

export function AccountPage() {
  const { user, signOut } = useAuth();
  const [nameText, setNameText] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['leaderboard'], queryFn: fetchLeaderboard });
  const currentName = profile.data?.profile?.display_name ?? '';

  const rename = useMutation({
    mutationFn: () => updateDisplayName(nameText),
    onSuccess: async () => {
      setSaved(true);
      setError(null);
      await queryClient.invalidateQueries();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const exportData = useMutation({
    mutationFn: async () => {
      const { data, error: rpcError } = await getSupabaseClient().rpc('export_my_data');
      if (rpcError) throw new Error(rpcError.message);

      // Download direto no navegador, e não e-mail nem link temporário: o
      // dado não sai do par navegador-banco, então não há cópia em trânsito
      // para vazar nem link para alguém interceptar.
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `m8invest-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(href);
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error: rpcError } = await getSupabaseClient().rpc('delete_my_account');
      if (rpcError) throw new Error(rpcError.message);
      await signOut();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sua conta</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user?.email}
          {user?.created_at ? ` · cadastrado em ${formatDateTime(user.created_at)}` : ''}
        </p>
      </div>

      {error ? (
        <p role="alert" className="mb-5 rounded-lg border border-loss/40 bg-loss-muted p-3 text-sm">
          {error}
        </p>
      ) : null}

      <section className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Nome no ranking</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          É o nome que os outros usuários veem. Se você nunca trocou, ele foi criado a partir do seu
          e-mail no primeiro acesso.
        </p>

        <div className="mt-3 flex max-w-sm flex-col gap-2 sm:flex-row">
          <Input
            value={nameText || currentName}
            onChange={(event) => {
              setNameText(event.target.value);
              setSaved(false);
            }}
            maxLength={40}
            aria-label="Nome no ranking"
          />
          <Button
            size="sm"
            disabled={rename.isPending}
            onClick={() => {
              rename.mutate();
            }}
          >
            {rename.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Salvar
          </Button>
        </div>
        {saved ? <p className="mt-2 text-xs text-gain">Nome atualizado.</p> : null}
      </section>

      <section className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Exportar meus dados</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Baixa um JSON com tudo que o serviço guarda sobre você: e-mail, perfil, carteiras, ordens,
          posições, extrato, aplicações de renda fixa e histórico de patrimônio.
        </p>
        <Button
          variant="outline"
          className="mt-3"
          disabled={exportData.isPending}
          onClick={() => {
            exportData.mutate();
          }}
        >
          {exportData.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Download aria-hidden />
          )}
          Baixar JSON
        </Button>
      </section>

      <section className="rounded-lg border border-loss/40 bg-loss-muted p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <TriangleAlert className="size-4 text-loss" aria-hidden />
          Excluir a conta
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Apaga definitivamente o perfil, as carteiras, as ordens, o extrato, as aplicações e o
          histórico. Não há backup recuperável — se quiser guardar o registro, exporte antes.
        </p>

        {/* Confirmação por digitação, e não caixa de seleção: escrever a
            palavra exige ler a frase, e é a única barreira que sobrevive ao
            clique automático de quem decidiu antes de entender. */}
        <div className="mt-3 max-w-sm space-y-1.5">
          <Label htmlFor="confirm">
            Digite <span className="font-mono">{DELETE_PHRASE}</span> para liberar o botão
          </Label>
          <Input
            id="confirm"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={DELETE_PHRASE}
            autoComplete="off"
          />
        </div>

        <Button
          className="mt-3 bg-loss text-loss-foreground hover:bg-loss/90"
          disabled={confirmText.trim().toUpperCase() !== DELETE_PHRASE || remove.isPending}
          onClick={() => {
            remove.mutate();
          }}
        >
          {remove.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Trash2 aria-hidden />
          )}
          Excluir definitivamente
        </Button>
      </section>
    </AppShell>
  );
}
