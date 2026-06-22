const stats = [
  { value: "500+", label: "Installations Completed" },
  { value: "5–7", label: "Year Avg. Payback Period" },
  { value: "25yr", label: "Performance Warranty" },
  { value: "30M+", label: "kWh Generated Annually" },
];

export default function Stats() {
  return (
    <section className="border-y border-border bg-background">
      <div className="max-w-7xl mx-auto px-6 md:px-10">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border">
          {stats.map(({ value, label }) => (
            <div key={label} className="py-12 px-6 md:px-10 flex flex-col gap-2">
              <span className="font-display text-5xl md:text-6xl lg:text-7xl text-primary uppercase leading-none">
                {value}
              </span>
              <span className="text-xs tracking-[0.2em] uppercase text-muted">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
