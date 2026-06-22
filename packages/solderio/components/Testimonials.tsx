const testimonials = [
  {
    quote:
      "SoldeRio cut our warehouse energy bill by 68% in the first year. The installation was seamless and the monitoring dashboard is incredible.",
    name: "Maria Torres",
    role: "Operations Director, NovaBuild Industries",
  },
  {
    quote:
      "We went from dreading the electricity bill to actually looking forward to seeing our production numbers. SoldeRio made going solar completely painless.",
    name: "James Keller",
    role: "Homeowner, Phoenix AZ",
  },
  {
    quote:
      "The commercial system at our distribution center paid for itself in under 6 years. SoldeRio's team handled everything from permits to interconnection.",
    name: "Sandra Liu",
    role: "CFO, Meridian Logistics",
  },
];

export default function Testimonials() {
  return (
    <section
      id="testimonials"
      className="bg-surface py-28 md:py-40 px-6 md:px-10"
    >
      <div className="max-w-7xl mx-auto">
        <p className="text-xs tracking-[0.3em] uppercase text-primary mb-4">
          What Clients Say
        </p>
        <h2 className="font-display text-4xl md:text-6xl uppercase text-foreground leading-none mb-16 md:mb-20">
          Real Results,
          <br />
          Real Savings.
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border">
          {testimonials.map(({ quote, name, role }) => (
            <blockquote
              key={name}
              className="bg-surface p-8 md:p-10 flex flex-col gap-6"
            >
              <span className="font-display text-6xl text-primary/40 leading-none select-none">
                &ldquo;
              </span>
              <p className="text-foreground leading-relaxed text-base flex-1">
                {quote}
              </p>
              <footer>
                <p className="text-sm font-medium text-foreground">{name}</p>
                <p className="text-xs tracking-wide text-muted mt-1">{role}</p>
              </footer>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}
