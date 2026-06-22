export default function About() {
  return (
    <section id="about" className="py-28 md:py-40 px-6 md:px-10 max-w-7xl mx-auto">
      {/* Top label */}
      <p className="text-xs tracking-[0.3em] uppercase text-primary mb-6">
        Our Mission
      </p>

      {/* Large heading */}
      <h2 className="font-display text-5xl md:text-7xl lg:text-8xl uppercase text-foreground leading-none text-balance max-w-4xl">
        Meet Residential &amp; Commercial.
      </h2>

      {/* Two-col description */}
      <div className="mt-16 md:mt-20 grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-20">
        <div>
          <p className="text-muted leading-relaxed text-base md:text-lg">
            SoldeRio solar systems are high-performance photovoltaic solutions
            designed for modern homes and businesses — efficient, reliable, and
            engineered for extreme conditions and long-term returns.
          </p>
        </div>
        <div>
          <p className="font-display text-2xl md:text-3xl uppercase text-foreground leading-tight">
            Engineered for Efficiency.
            <br />
            Designed for Independence.
          </p>
        </div>
      </div>

      {/* Feature tags */}
      <div className="mt-16 flex flex-wrap gap-3">
        {[
          "Monocrystalline Panels",
          "Smart Grid Technology",
          "Battery Backup Ready",
          "24/7 Monitoring",
          "Net Metering Certified",
        ].map((tag) => (
          <span
            key={tag}
            className="px-4 py-2 border border-border text-xs tracking-widest uppercase text-muted hover:border-primary hover:text-primary transition-colors cursor-default"
          >
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}
