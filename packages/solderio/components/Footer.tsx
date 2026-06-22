const footerLinks = {
  Solutions: ["Residential Solar", "Commercial Solar", "Battery Storage", "EV Charging"],
  Company: ["About Us", "Projects", "Careers", "Press"],
  Support: ["Installation Guide", "Monitoring App", "Warranty", "Contact"],
};

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-background border-t border-border px-6 md:px-10 py-16 md:py-20">
      <div className="max-w-7xl mx-auto">
        {/* Top row */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-12 md:gap-8 mb-16">
          {/* Brand */}
          <div className="md:col-span-2">
            <p className="font-display text-3xl tracking-widest text-foreground uppercase mb-4">
              Solde<span className="text-primary">Rio</span>
            </p>
            <p className="text-muted text-sm leading-relaxed max-w-xs">
              Premium residential and commercial solar energy systems. Built for
              maximum yield, minimum dependence.
            </p>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <p className="text-xs tracking-[0.3em] uppercase text-primary mb-4">
                {category}
              </p>
              <ul className="flex flex-col gap-2">
                {links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-muted text-sm hover:text-foreground transition-colors"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom row */}
        <div className="border-t border-border pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="text-xs text-muted tracking-wide">
            &copy; {year} SoldeRio. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            {["Privacy Policy", "Terms of Service", "Cookie Policy"].map(
              (item) => (
                <a
                  key={item}
                  href="#"
                  className="text-xs text-muted hover:text-foreground transition-colors tracking-wide"
                >
                  {item}
                </a>
              )
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
