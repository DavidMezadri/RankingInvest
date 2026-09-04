import { cn } from '@/lib/utils';

/**
 * Anel de segmentos coloridos da marca, em SVG inline.
 *
 * Cores fixas em hex, e não em token de tema: identidade de marca não muda
 * entre claro e escuro. O que acompanha o tema é o wordmark ao lado, que herda
 * `currentColor`.
 *
 * Os segmentos são arcos de um mesmo círculo, posicionados por
 * `stroke-dasharray` e `stroke-dashoffset` em vez de paths calculados — assim
 * mexer num ângulo é trocar um número, não recalcular coordenadas.
 */

const CIRCUMFERENCE = 2 * Math.PI * 40;

type Segment = { color: string; start: number; length: number };

/**
 * Ângulos em graus, no sentido horário a partir da ponta superior do vão.
 *
 * As duas extremidades vivem separadas do meio porque recebem tratamento
 * diferente: só elas têm ponta arredondada, e a ordem de desenho importa. A
 * ponta redonda transborda meio traço para cada lado, então o segmento final é
 * desenhado ANTES dos vizinhos, para que a sobra que invade o meio do anel
 * fique coberta. Sobra apenas o arredondamento voltado para o vão, que é o
 * pretendido.
 */
const START_SEGMENT: Segment = { color: '#29A183', start: 0, length: 45 };

const MIDDLE_SEGMENTS: readonly Segment[] = [
  { color: '#3A73B8', start: 45, length: 45 },
  { color: '#4E96D1', start: 90, length: 50 },
  { color: '#F5B335', start: 140, length: 55 },
  { color: '#F2A03C', start: 195, length: 35 },
  { color: '#EE8B33', start: 230, length: 30 },
];

const END_SEGMENT: Segment = { color: '#E15025', start: 260, length: 25 };

function Arc({ segment, rounded }: { segment: Segment; rounded?: boolean }) {
  return (
    <circle
      cx="50"
      cy="50"
      r="40"
      stroke={segment.color}
      strokeLinecap={rounded ? 'round' : 'butt'}
      strokeDasharray={`${((CIRCUMFERENCE * segment.length) / 360).toFixed(3)} ${CIRCUMFERENCE.toFixed(3)}`}
      strokeDashoffset={((-CIRCUMFERENCE * segment.start) / 360).toFixed(3)}
    />
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('size-6', className)}
      role="img"
      aria-label="M8.Invest"
    >
      {/* rotate(-150) põe o início do anel às 10 horas, deixando o vão à esquerda. */}
      <g transform="rotate(-150 50 50)" fill="none" strokeWidth={11}>
        <Arc segment={END_SEGMENT} rounded />
        <Arc segment={START_SEGMENT} rounded />
        {MIDDLE_SEGMENTS.map((segment) => (
          <Arc key={segment.color} segment={segment} />
        ))}
      </g>
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight">M8.Invest</span>
    </span>
  );
}
