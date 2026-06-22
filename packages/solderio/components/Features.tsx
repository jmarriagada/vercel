import { Sun, Zap, Shield, TrendingUp, Wifi, Leaf } from "lucide-react";

const features = [
  {
    icon: Sun,
    title: "High-Efficiency Panels",
    description:
      "22%+ efficiency monocrystalline cells that outperform standard panels in all light conditions.",
  },
  {
    icon: Zap,
    title: "Smart Energy Management",
    description:
      "AI-powered inverters and energy management systems that optimize output in real time.",
  },
  {
    icon: Shield,
    title: "25-Year Warranty",
    description:
      "Industry-leading performance guarantees backed by a full 25-year product and output warranty.",
  },
  {
    icon: TrendingUp,
    title: "ROI in 5–7 Years",
    description:
      "Residential and commercial installations typically pay for themselves within 5 to 7 years.",
  },
  {
    icon: Wifi,
    title: "Remote Monitoring",
    description:
      "Track your energy production, savings, and system health from anywhere via our app.",
  },
  {
    icon: Leaf,
    title: "Carbon Neutral",
    description:
      "Every SoldeRio installation offsets an average of 4 tons of CO₂ emissions per year.",
  },
];

export default function Features() {
  return (
    <section className="bg-surface py-28 md:py-40 px-6 md:px-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
          <div>
            <p className="text-xs tracking-[0.3em] uppercase text-primary mb-4">
              Core Technology
            </p>
            <h2 className="font-display text-4xl md:text-6xl uppercase text-foreground leading-none">
              Technology Meets
              <br />
              Sustainability.
            </h2>
          </div>
          <p className="text-muted max-w-sm leading-relaxed md:text-right text-sm">
            Every SoldeRio system combines state-of-the-art photovoltaic
            technology with intelligent software — delivering maximum yield with
            minimum maintenance.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
          {features.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="bg-surface p-8 md:p-10 group hover:bg-background transition-colors duration-300"
            >
              <Icon
                size={28}
                className="text-primary mb-6 group-hover:scale-110 transition-transform duration-200"
              />
              <h3 className="font-display text-xl md:text-2xl uppercase text-foreground mb-3 tracking-wide">
                {title}
              </h3>
              <p className="text-muted text-sm leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
