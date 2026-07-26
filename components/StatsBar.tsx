"use client";

import { useEffect, useState } from "react";
import { useInView } from "./useInView";

interface Stat {
  target: number;
  render: (value: number) => string;
  label: string;
  source: string;
}

const STATS: Stat[] = [
  {
    target: 49,
    render: (v) => `${Math.round(v)}%`,
    label: "of UK adults affected by drug shortages",
    source: "Community Pharmacy England, 2024",
  },
  {
    target: 98,
    render: (v) => `${Math.round(v)}%`,
    label: "of pharmacies see patients searching daily",
    source: "CPE pressures survey",
  },
  {
    target: 1900,
    render: (v) => Math.round(v).toLocaleString("en-GB"),
    label: "supply notifications issued in 2024",
    source: "DHSC / SSPs",
  },
];

function useCountUp(target: number, start: boolean, durationMs = 1500): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!start) return;
    let frame: number;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / durationMs, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setValue(target * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
      else setValue(target);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, start, durationMs]);

  return value;
}

function StatCell({ stat, start }: { stat: Stat; start: boolean }) {
  const value = useCountUp(stat.target, start);
  return (
    <div className="px-2 py-6 sm:px-8">
      <p className="figure text-[2.7rem] leading-none text-teal">
        {stat.render(value)}
      </p>
      <p className="mt-2.5 text-[15px] leading-snug text-ink">{stat.label}</p>
      <p className="mt-2 font-mono text-[12px] tracking-tight text-muted">
        {stat.source}
      </p>
    </div>
  );
}

export default function StatsBar() {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);

  return (
    <section className="border-y border-line bg-surface">
      <div
        ref={ref}
        className="shell grid divide-y divide-line py-2 sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        {STATS.map((stat) => (
          <StatCell key={stat.label} stat={stat} start={inView} />
        ))}
      </div>
    </section>
  );
}
