import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import About from "@/components/About";
import Features from "@/components/Features";
import Stats from "@/components/Stats";
import Services from "@/components/Services";
import Technology from "@/components/Technology";
import Testimonials from "@/components/Testimonials";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main>
      <Navbar />
      <Hero />
      <About />
      <Stats />
      <Features />
      <Services />
      <Technology />
      <Testimonials />
      <CTA />
      <Footer />
    </main>
  );
}
