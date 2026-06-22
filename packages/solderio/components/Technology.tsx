import Image from "next/image";

export default function Technology() {
  return (
    <section
      id="technology"
      className="relative min-h-[70vh] overflow-hidden flex items-center"
    >
      {/* Background image */}
      <Image
        src="https://images.unsplash.com/photo-1497440001374-f26997328c1b?w=1920&q=85"
        alt="Close-up of solar panel cells showing photovoltaic technology"
        fill
        className="object-cover object-center"
      />
      <div className="absolute inset-0 bg-background/75" />

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-10 py-28 md:py-40 w-full">
        <div className="max-w-3xl">
          <p className="text-xs tracking-[0.3em] uppercase text-primary mb-6">
            Our Technology
          </p>
          <h2 className="font-display text-5xl md:text-7xl lg:text-8xl uppercase text-foreground leading-none mb-10">
            Precision Meets
            <br />
            Power.
          </h2>
          <p className="text-muted leading-relaxed text-base md:text-lg max-w-xl mb-10">
            SoldeRio panels use cutting-edge N-type TOPCon cell architecture —
            offering superior bifaciality, lower temperature coefficients, and
            industry-leading efficiency. Our intelligent inverters learn your
            energy consumption patterns and maximize self-consumption
            automatically, keeping your grid costs near zero.
          </p>

          {/* Spec list */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 border-t border-border pt-10">
            {[
              { label: "Panel Efficiency", value: "22.4%" },
              { label: "System Uptime", value: "99.8%" },
              { label: "Temp. Coefficient", value: "-0.26%/°C" },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="font-display text-3xl md:text-4xl text-primary uppercase">
                  {value}
                </p>
                <p className="text-xs tracking-[0.2em] uppercase text-muted mt-1">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
