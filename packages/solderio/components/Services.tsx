import Image from "next/image";
import { ArrowUpRight } from "lucide-react";

const services = [
  {
    number: "01",
    title: "Residential Solar",
    description:
      "Full home solar installations from panel selection through commissioning. Includes battery storage, smart monitoring, and utility interconnection.",
    image:
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80",
    alt: "Residential solar panels installed on a modern home roof",
  },
  {
    number: "02",
    title: "Commercial Solar",
    description:
      "Scalable rooftop and ground-mount systems for warehouses, office buildings, retail centers, and industrial facilities with demand management.",
    image:
      "https://images.unsplash.com/photo-1466611653911-95081537e5b7?w=800&q=80",
    alt: "Commercial solar farm with large-scale panels",
  },
  {
    number: "03",
    title: "Battery Storage",
    description:
      "Pair your solar system with high-capacity lithium iron phosphate battery banks for energy independence, backup power, and time-of-use optimization.",
    image:
      "https://images.unsplash.com/photo-1624397640148-949b1732bb0a?w=800&q=80",
    alt: "Battery energy storage units in a modern installation",
  },
  {
    number: "04",
    title: "EV Charging",
    description:
      "Solar-powered EV charging stations for homes and commercial fleets. Charge your vehicle with 100% clean energy generated on-site.",
    image:
      "https://images.unsplash.com/photo-1593941707882-a5bba14938c7?w=800&q=80",
    alt: "Electric vehicle charging station powered by solar",
  },
];

export default function Services() {
  return (
    <section id="solutions" className="py-28 md:py-40 px-6 md:px-10 max-w-7xl mx-auto">
      <p className="text-xs tracking-[0.3em] uppercase text-primary mb-4">
        What We Offer
      </p>
      <h2 className="font-display text-4xl md:text-6xl uppercase text-foreground leading-none mb-16 md:mb-20">
        Essential Solutions
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 md:gap-8">
        {services.map(({ number, title, description, image, alt }) => (
          <article
            key={number}
            className="group relative bg-surface border border-border overflow-hidden hover:border-primary/40 transition-colors duration-300"
          >
            {/* Image */}
            <div className="relative h-56 md:h-64 overflow-hidden">
              <Image
                src={image}
                alt={alt}
                fill
                className="object-cover object-center transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-background/40" />
              {/* Number badge */}
              <span className="absolute top-4 left-4 font-display text-5xl text-foreground/20 leading-none select-none">
                {number}
              </span>
            </div>

            {/* Content */}
            <div className="p-6 md:p-8">
              <div className="flex items-start justify-between gap-4">
                <h3 className="font-display text-2xl md:text-3xl uppercase text-foreground tracking-wide">
                  {title}
                </h3>
                <ArrowUpRight
                  size={20}
                  className="text-muted group-hover:text-primary transition-colors shrink-0 mt-1"
                />
              </div>
              <p className="mt-3 text-muted text-sm leading-relaxed">
                {description}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
