"use client";

import Image from "next/image";

export default function CTA() {
  return (
    <section id="contact" className="relative overflow-hidden">
      {/* Background */}
      <Image
        src="https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=1920&q=85"
        alt="Aerial view of a solar installation at sunset"
        fill
        className="object-cover object-center"
      />
      <div className="absolute inset-0 bg-background/80" />

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-10 py-28 md:py-40">
        <div className="max-w-2xl">
          <p className="text-xs tracking-[0.3em] uppercase text-primary mb-6">
            Start Today
          </p>
          <h2 className="font-display text-5xl md:text-7xl lg:text-8xl uppercase text-foreground leading-none mb-8">
            SoldeRio solar systems combine aerospace-grade materials with
            intelligent energy management — designed for those who refuse to
            depend on the grid.
          </h2>
          <p className="text-muted leading-relaxed text-base md:text-lg mb-10 max-w-lg">
            Get a free site assessment and custom energy report. Our team will
            design a system sized exactly for your home or business.
          </p>
          <form
            className="flex flex-col sm:flex-row gap-3 max-w-md"
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              type="email"
              placeholder="your@email.com"
              required
              className="flex-1 px-4 py-3 bg-surface border border-border text-foreground text-sm placeholder:text-muted focus:outline-none focus:border-primary transition-colors"
              aria-label="Email address"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-primary text-background text-sm tracking-widest uppercase font-medium hover:bg-primary/90 transition-colors shrink-0"
            >
              Get Free Quote
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
