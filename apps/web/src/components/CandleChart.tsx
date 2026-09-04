import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type Time,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';

export type Candle = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
};

/**
 * Cores em hex, não em token CSS: o lightweight-charts pinta em canvas e
 * recebe strings de cor cruas, sem passar pelo resolvedor de variáveis do
 * CSS. Ler `getComputedStyle` devolveria `oklch(...)`, que nem todo canvas
 * aceita — então a paleta do gráfico é declarada aqui, alinhada aos tokens
 * --gain e --loss por aproximação visual.
 */
const PALETTE = {
  dark: {
    up: '#3ec98f',
    down: '#f4704f',
    text: 'rgba(255,255,255,0.45)',
    grid: 'rgba(255,255,255,0.07)',
  },
  light: {
    up: '#159463',
    down: '#d4462a',
    text: 'rgba(0,0,0,0.45)',
    grid: 'rgba(0,0,0,0.07)',
  },
} as const;

export function CandleChart({ candles }: { candles: readonly Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isDark = document.documentElement.classList.contains('dark');
    const colors = isDark ? PALETTE.dark : PALETTE.light;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        // Fundo transparente para o card por trás definir a cor e o gráfico
        // acompanhar o tema sem precisar saber qual é.
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: colors.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid, timeVisible: false },
      crosshair: { mode: 0 },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      borderVisible: false,
    });

    const data: CandlestickData<Time>[] = candles.map((candle) => ({
      time: candle.date,
      // Dia sem abertura ou extremos apurados vira um candle achatado no
      // fechamento, em vez de desaparecer e abrir buraco na série.
      open: candle.open ?? candle.close,
      high: candle.high ?? candle.close,
      low: candle.low ?? candle.close,
      close: candle.close,
    }));

    series.setData(data);
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [candles]);

  return <div ref={containerRef} className="h-[320px] w-full" />;
}
