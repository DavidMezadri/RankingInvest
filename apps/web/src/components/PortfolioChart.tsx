import { AreaSeries, ColorType, createChart, type AreaData, type Time } from 'lightweight-charts';
import { useEffect, useRef } from 'react';

export type EquityPoint = { date: string; value: number };

/**
 * Curva de patrimônio.
 *
 * Usa lightweight-charts, o mesmo do gráfico de candles, em vez de trazer
 * recharts só para uma série de área: uma dependência a menos no bundle e um
 * comportamento de zoom e crosshair consistente entre as duas telas.
 *
 * A cor segue o resultado do período — verde se terminou acima do primeiro
 * ponto, vermelho se abaixo. O valor em si aparece sempre no cartão de
 * patrimônio ao lado, com sinal explícito: a cor aqui reforça, não informa
 * sozinha.
 */
const PALETTE = {
  dark: {
    gain: '#3ec98f',
    loss: '#f4704f',
    text: 'rgba(255,255,255,0.45)',
    grid: 'rgba(255,255,255,0.07)',
  },
  light: { gain: '#159463', loss: '#d4462a', text: 'rgba(0,0,0,0.45)', grid: 'rgba(0,0,0,0.07)' },
} as const;

export function PortfolioChart({ points }: { points: readonly EquityPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || points.length < 2) return;

    const isDark = document.documentElement.classList.contains('dark');
    const colors = isDark ? PALETTE.dark : PALETTE.light;

    const first = points[0]?.value ?? 0;
    const last = points[points.length - 1]?.value ?? 0;
    const line = last >= first ? colors.gain : colors.loss;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: colors.text,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: false },
      handleScale: false,
      handleScroll: false,
      crosshair: { mode: 0 },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: line,
      topColor: `${line}55`,
      bottomColor: `${line}00`,
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    const data: AreaData<Time>[] = points.map((point) => ({
      time: point.date,
      value: point.value,
    }));

    series.setData(data);
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [points]);

  // Um único ponto não é uma curva. Desenhar o gráfico com um dado só sugere
  // uma linha reta onde não há informação — melhor dizer o que falta.
  if (points.length < 2) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        A curva aparece a partir do segundo fechamento. O primeiro snapshot foi gravado
        {points.length === 1 ? ' hoje' : ''}.
      </p>
    );
  }

  return <div ref={containerRef} className="h-[240px] w-full" />;
}
