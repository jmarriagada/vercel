import Image from "next/image";
import { ArrowDown } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative h-screen min-h-[600px] overflow-hidden">
      {/* Background image */}
      <Image
        src="https://images.unsplash.com/photo-1509391366360-2e959784a276?w=1920&q=85"
        alt="Solar panels on a rooftop under a vibrant sky"
        fill
        priority
        className="object-cover object-center"
      />

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-background/60" />

      {/* Large brand name overlay — EVASION style */}
      <div className="absolute inset-x-0 bottom-0 overflow-hidden pointer-events-none select-none">
        <p
          className="font-display text-[20vw] leading-none tracking-tighter text-foreground/10 whitespace-nowrap uppercase"
          aria-hidden="true"
        >
          SOLDERIO
        </p>
      </div>

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col">
        {/* Top tagline */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-6">
            <p className="text-xs tracking-[0.3em] uppercase text-muted mb-4">
              Residential &amp; Commercial
            </p>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl uppercase tracking-wide text-foreground text-balance leading-none">
              Power Your World.
              <br />
              <span className="text-primary">Own the Sun.</span>
            </h1>
            <p className="mt-6 text-base md:text-lg text-muted max-w-md mx-auto leading-relaxed">
              Lightweight, durable, and engineered for maximum energy yield.
              Built for homes and businesses that refuse to compromise.
            </p>
            <div className="mt-8 flex items-center justify-center gap-4">
              <a
                href="#solutions"
                className="px-8 py-3 bg-primary text-background text-sm tracking-widest uppercase font-medium hover:bg-primary/90 transition-colors"
              >
                Explore Solutions
              </a>
              <a
                href="#contact"
                className="px-8 py-3 border border-foreground/30 text-foreground text-sm tracking-widest uppercase font-medium hover:border-foreground transition-colors"
              >
                Get a Quote
              </a>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="flex justify-center pb-8">
          <a
            href="#about"
            aria-label="Scroll to next section"
            className="flex flex-col items-center gap-2 text-muted hover:text-foreground transition-colors"
          >
            <span className="text-xs tracking-[0.3em] uppercase">Scroll</span>
            <ArrowDown size={16} className="animate-bounce" />
          </a>
        </div>
      </div>
    </section>
  );
}
